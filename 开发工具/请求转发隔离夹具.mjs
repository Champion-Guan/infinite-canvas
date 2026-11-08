import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';
import { 上游目录 } from './公共.mjs';
import { ts } from './检查首批功能适配.mjs';

// 仅隔离测试：随机回环端口、合成请求，转发fetch只能命中本夹具，不接触外网。
export async function 建立请求转发夹具() {
  const requests = [], logs = [];
  let failure = false;
  let finishStream;
  const streamReleased = new Promise(resolve => { finishStream = resolve; });
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ method: req.method, path: req.url, authorization: req.headers.authorization, body: Buffer.concat(chunks).toString('utf8') });
    if (failure) { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"error":{"message":"synthetic-unavailable"}}'); return; }
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'synthetic-image' }, { id: 'synthetic-text' }] }));
    } else if (req.url === '/v1/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"stage":"first"}\n\n');
      // 由测试读到首块后再释放末块，不依赖CPU负载或固定延时。
      await streamReleased;
      res.end('data: [DONE]\n\n');
    } else if (req.url === '/binary') {
      const body = gzipSync(Buffer.from([0, 1, 2, 128, 255]));
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-encoding': 'gzip', 'content-length': body.length }); res.end(body);
    } else {
      res.writeHead(202, { 'content-type': 'application/json', 'x-synthetic-result': 'forwarded' });
      res.end(JSON.stringify({ accepted: true }));
    }
  });
  const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await listen(upstream);
  const upstreamUrl = 'http://127.0.0.1:' + upstream.address().port;
  let proxy;
  try {
    // 原index.js末尾自动listen；只在VM内执行原库函数，绝不导入其CLI启动段。
    const path = join(上游目录, 'canvas-proxy/index.js');
    const source = readFileSync(path, 'utf8');
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const anchors = ast.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(ast) === 'args'));
    if (anchors.length !== 1) throw Error('原代理CLI边界不唯一');
    const library = source.slice(0, anchors[0].getStart(ast)).replace('import.meta.url', JSON.stringify(pathToFileURL(path).href));
    const output = ts.transpileModule(library, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    new vm.Script(output, { filename: path }).runInNewContext({ module, exports: module.exports, require: createRequire(import.meta.url), Buffer,
      console: { log: value => logs.push(value) },
      fetch: (target, options) => {
        if (new URL(target).origin !== upstreamUrl) throw Error('隔离测试拒绝外部目标');
        return fetch(target, { ...options, redirect: 'error' });
      },
    });
    proxy = module.exports.createProxyServer();
    await listen(proxy);
    return { upstreamUrl, proxyUrl: 'http://127.0.0.1:' + proxy.address().port, requests, logs,
      setFailure: value => { failure = value; }, finishStream,
      close: async () => { finishStream(); await close(proxy); await close(upstream); },
    };
  } catch (error) { if (proxy) await close(proxy); await close(upstream); throw error; }
}
