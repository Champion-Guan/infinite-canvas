import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { openSQLiteCredentialVault } from '../扩展功能/本机凭据/SQLite凭据保管.mjs';
import { createWriteCoordinator } from '../扩展功能/本机服务/写入协调.mjs';
import { createProviderCredentialGateway } from '../扩展功能/生成网关/渠道凭据网关.mjs';
import { openGenerationTasks } from '../扩展功能/生成任务/SQLite生成任务.mjs';

export const roots = [];
const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port)); });
export const closeServer = server => new Promise((resolve, reject) => { server.closeAllConnections(); server.close(error => error ? reject(error) : resolve()); });
export { listen };
export async function generationFixture({ maxTasks = 256, maxConcurrent = 4, wrapWorkspace = value => value, beforeReply } = {}) {
  const parent = mkdtempSync(join(tmpdir(), 'guan-generation-test-')), dataRoot = join(parent, '工作区'); roots.push(parent);
  const workspace = openWorkspace({ dataRoot, initialize: true }), key = randomBytes(32);
  const keyProvider = { create: async () => Buffer.from(key), read: async () => Buffer.from(key) };
  const vault = await openSQLiteCredentialVault({ workspace, keyProvider, initialize: true });
  const requests = [], reply = { status: 200, type: 'application/json', bytes: Buffer.from('{"data":[{"b64_json":"aXNvbGF0ZWQ="}]}'), disconnect: false, redirect: false };
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ method: req.method, path: req.url, headers: { ...req.headers }, bytes: Buffer.concat(chunks) });
    await beforeReply?.(requests.at(-1));
    if (reply.disconnect) { req.socket.destroy(); return; }
    if (reply.redirect) { res.writeHead(302, { location: 'https://never-contact.invalid/secret' }); res.end(); return; }
    res.writeHead(reply.status, { 'content-type': reply.type, 'set-cookie': 'synthetic-cookie=never-forward', 'www-authenticate': 'never-forward' }); res.end(reply.bytes);
  });
  const providerOrigin = await listen(server), coordinator = createWriteCoordinator();
  const gateway = createProviderCredentialGateway({ workspace: wrapWorkspace(workspace), vault, coordinator, testOrigins: [providerOrigin] });
  async function verifyApplied(job, checkpoint) {
    if (!checkpoint || checkpoint.productId !== job.productId) return false;
    const canvas = workspace.readDocument('canvas', job.productId);
    return canvas?.revision === checkpoint.revision && canvas.hash === checkpoint.hash && canvas.value.nodes.some(node => node.id === job.nodeId && node.metadata?.generationTaskId === job.id && node.metadata?.storageKey === 'media:' + job.result.id);
  }
  const tasks = await openGenerationTasks({ workspace: wrapWorkspace(workspace), gateway, coordinator, verifyApplied, maxTasks, maxConcurrent });
  return { parent, dataRoot, workspace, vault, key, keyProvider, providerOrigin, reply, requests, coordinator, gateway, tasks, verifyApplied,
    async bind(kind = 'openai', value = 'synthetic-not-real-' + randomUUID()) { return { value, ...(await gateway.bind({ kind, endpoint: providerOrigin, value })) }; },
    submit(binding, overrides = {}) { return { id: randomUUID(), productId: 'product-A', nodeId: 'result-A', binding, request: { method: 'POST', path: '/v1/images/generations', contentType: 'application/json', body: Buffer.from('{"model":"synthetic","prompt":"尺寸测试"}').toString('base64') }, ...overrides }; },
    saveCanvas(job) {
      const before = workspace.readDocument('canvas', job.productId);
      const value = { id: job.productId, title: '隔离合成产品', nodes: [{ id: job.nodeId, type: 'image', position: { x: 0, y: 0 }, metadata: { generationTaskId: job.id, storageKey: 'media:' + job.result.id } }], connections: [] };
      const ack = workspace.writeDocument({ collection: 'canvas', id: job.productId, value, mediaIds: [job.result.id], expectedRevision: before?.revision || 0, operationId: randomUUID() });
      return { productId: job.productId, revision: ack.revision, hash: ack.hash };
    },
    async close() { await tasks.drain(); await tasks.close(); await closeServer(server); await coordinator.close(); vault.close(); workspace.close(); key.fill(0); },
  };
}
export function containsText(root, value) {
  for (const item of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, item.name);
    if (item.isDirectory() ? containsText(path, value) : readFileSync(path).includes(Buffer.from(value))) return true;
  }
  return false;
}
