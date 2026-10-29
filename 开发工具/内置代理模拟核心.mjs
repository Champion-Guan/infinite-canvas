// 仅供loopback测试，不解析真实订阅，不访问公网节点或生成服务。
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { parse } from '../扩展功能/网络代理/node_modules/yaml/dist/index.js';

const file = process.argv[process.argv.indexOf('-f') + 1];
const config = parse(readFileSync(file, 'utf8'));
if (config.proxies.some(node => node.name === 'FAIL_FIXTURE')) process.exit(1);

const sockets = new Set();
const mixed = createServer((req, res) => { res.writeHead(405); res.end(); });
mixed.on('connect', (req, client, head) => {
  sockets.add(client); client.once('close', () => sockets.delete(client));
  if (req.headers['proxy-authorization'] !== 'Basic ' + Buffer.from(config.authentication[0]).toString('base64')) {
    client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); return;
  }
  const target = req.url.match(/^127\.0\.0\.1:(\d+)$/);
  if (!target) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
  const upstream = connect(Number(target[1]), '127.0.0.1', () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) upstream.write(head);
    client.pipe(upstream).pipe(client);
  });
  sockets.add(upstream); upstream.once('close', () => sockets.delete(upstream));
  client.on('error', () => upstream.destroy()); upstream.on('error', () => client.destroy());
});

let selection = config.proxies[0].name;
const control = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.headers.authorization !== 'Bearer ' + config.secret) { res.writeHead(401); res.end('{}'); return; }
  if (req.url === '/connections') {
    res.end(JSON.stringify({ connections: [{ metadata: { host: 'www.gstatic.com' }, chains: [selection, 'TEST-GROUP'] }] })); return;
  }
  if (req.url === '/version') { res.end('{"version":"fixture-only"}'); return; }
  if (req.url === '/proxies') {
    res.end(JSON.stringify({ proxies: {
      'TEST-GROUP': { type: 'Selector', now: selection, all: config.proxies.map(node => node.name) },
      ...Object.fromEntries(config.proxies.map(node => [node.name, { type: node.type }])),
      'PASS-RULE': { type: 'Pass-RULE' }, 'REJECT-DROP': { type: 'Reject-DROP' },
    } })); return;
  }
  if (req.method === 'PUT' && req.url === '/proxies/TEST-GROUP') {
    let text = ''; for await (const chunk of req) text += chunk;
    selection = JSON.parse(text).name; res.writeHead(204); res.end(); return;
  }
  if (req.url.endsWith('/delay?url=https%3A%2F%2Fwww.gstatic.com%2Fgenerate_204&timeout=5000')) {
    res.end('{"delay":12}'); return;
  }
  res.writeHead(404); res.end('{}');
});
for (const server of [mixed, control]) server.on('connection', socket => {
  sockets.add(socket); socket.once('close', () => sockets.delete(socket));
});
mixed.listen(config['mixed-port'], '127.0.0.1');
control.listen(Number(config['external-controller'].split(':')[1]), '127.0.0.1');
process.on('SIGTERM', () => {
  for (const socket of sockets) socket.destroy();
  for (const server of [mixed, control]) server.close();
});
