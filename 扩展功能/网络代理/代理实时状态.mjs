// 只读取本机核心已有的连接与健康检查结果，不发外网探测，不返回连接目标或认证材料。
export async function 读取代理实时状态(api, now = Date.now) {
  const [proxyData, connectionData] = await Promise.all([api('/proxies'), api('/connections')]);
  const proxies = proxyData.proxies || {}, names = new Set();
  const connections = Array.isArray(connectionData.connections) ? connectionData.connections : [];
  for (const connection of connections) {
    const name = connection.chains?.find(name => typeof name === 'string' && proxies[name] && !Array.isArray(proxies[name].all));
    if (name && !/^(?:DIRECT|REJECT(?:-DROP)?|PASS(?:-RULE)?|COMPATIBLE)$/i.test(name)) names.add(name);
  }
  return {
    observedAt: now(), activeConnections: connections.length,
    nodes: [...names].sort().slice(0, 32).map(name => {
      const history = proxies[name].history;
      const latest = Array.isArray(history) ? history.at(-1) : null;
      return { name: name.slice(0, 256), latencyMs: Number.isFinite(latest?.delay) && latest.delay > 0 ? latest.delay : null };
    }),
  };
}
