import { requestThroughManagedProxy } from '../故障切换/受限代理传输.mjs';

const testURL = 'https://www.gstatic.com/generate_204';
const delayPath = name => '/proxies/' + encodeURIComponent(name) + '/delay?url=' + encodeURIComponent(testURL) + '&timeout=5000';
export async function 诊断代理连接({ api, route, probe = requestThroughManagedProxy }) {
  const { proxies = {} } = await api('/proxies');
  let observed, connection, settled = false, reachable = false;
  const started = Date.now();
  const request = probe({ url: new URL(testURL), method: 'GET', headers: { 'accept-encoding': 'identity' }, bytes: Buffer.alloc(0), route, timeout: 10_000, onConnection: value => { connection = value; } })
    .then(result => { reachable = result.status >= 200 && result.status < 400; }).catch(() => {}).finally(() => { settled = true; });
  do {
    try { observed = (await api('/connections')).connections?.find(item => connection ? Number(item.metadata?.sourcePort) === connection.sourcePort && item.metadata?.destinationIP === connection.destinationIP : item.metadata?.host === 'www.gstatic.com'); } catch { /* 核心旧版没有连接观测接口时不伪造实际节点。 */ }
    if (observed || settled) break;
    await new Promise(done => setTimeout(done, 50));
  } while (!settled);
  await request;
  const name = observed?.chains?.find(item => !proxies[item]?.all && proxies[item]);
  const currentNode = { name: name || '未确认实际节点', latencyMs: reachable ? Date.now() - started : null, testedAt: Date.now(),
    ...(reachable ? {} : { error: '连接超时或不可用' }), routeSource: name ? 'connection' : 'unconfirmed' };
  return { reachable, node: currentNode.name, delay: currentNode.latencyMs, currentNode };
}

export async function 检测全部代理节点({ api, route, probe }) {
  const { proxies = {} } = await api('/proxies');
  const builtIn = /^(?:DIRECT|REJECT(?:-DROP)?|PASS(?:-RULE)?|COMPATIBLE)$/i;
  const nodes = Object.entries(proxies).filter(([name, item]) => !item.all && !builtIn.test(name) && !builtIn.test(item.type));
  const results = new Array(nodes.length), deadline = Date.now() + 60_000; let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(6, nodes.length) }, async () => {
    while (cursor < nodes.length) {
      const slot = cursor++, [name] = nodes[slot]; let latencyMs = null;
      if (Date.now() < deadline) try { const data = await api(delayPath(name)); if (data.delay > 0) latencyMs = data.delay; } catch { /* 单节点失败仍交付其他节点结果。 */ }
      results[slot] = { name, latencyMs, error: latencyMs === null ? '超时或不可用' : null };
    }
  }));
  return { ...(await 诊断代理连接({ api, route, probe })), delayResults: results };
}
