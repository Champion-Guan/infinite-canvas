import assert from 'node:assert/strict';
import test from 'node:test';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { 构建凭据网关任务候选 } from './预审凭据网关任务端口.mjs';
import { 核验Excel删除字体平滑完整包 } from './接入Excel删除字体平滑隔离副本.mjs';

async function candidateVM(transport) {
  const preview = 构建凭据网关任务候选(), root = preview.integration.组合包;
  assert.equal(preview.delta.size, 17);
  assert.equal([...preview.delta].filter(([, value]) => value.原文 !== null).length, 5);
  const sources = new Map([...preview.delta].map(([path, value]) => [join(root, path), value.产物])), modules = new Map(), builtins = new Map();
  async function load(path) {
    if (modules.has(path)) return modules.get(path);
    if (transport && path === join(root, '画布副本/扩展功能/生成网关/受限上游传输.mjs')) {
      const value = new SyntheticModule(['requestProviderBytes'], function () { this.setExport('requestProviderBytes', transport); });
      modules.set(path, value); return value;
    }
    const source = sources.get(path) ?? readFileSync(path, 'utf8');
    const value = new SourceTextModule(source, { identifier: path, initializeImportMeta(meta) { meta.url = pathToFileURL(path).href; } }); modules.set(path, value); return value;
  }
  async function linker(specifier, referencing) {
    if (specifier.startsWith('node:')) {
      if (!builtins.has(specifier)) {
        const namespace = await import(specifier);
        builtins.set(specifier, new SyntheticModule(Object.keys(namespace), function () { for (const name of Object.keys(namespace)) this.setExport(name, namespace[name]); }));
      }
      return builtins.get(specifier);
    }
    assert.ok(specifier.startsWith('.'), '候选不得引入未审查包');
    return load(resolve(dirname(referencing.identifier), specifier));
  }
  async function evaluate(path) { const module = await load(path); if (module.status === 'unlinked') await module.link(linker); if (module.status === 'linked') await module.evaluate(); return module.namespace; }
  return { root, evaluate };
}
// 候选仅存在内存模块中。没有在完整组合包写文件/安装补丁，也不模拟原画布UI。
test('17文件候选内存装配：真实授权租约、共享写入门禁、保留文档保护和正常收尾', async () => {
  const { root, evaluate } = await candidateVM();
  const startup = await evaluate(join(root, '画布副本/扩展功能/本机服务/受限工作台启动器.mjs'));
  const storage = Object.assign({}, await evaluate(join(root, '服务包/扩展功能/本机存储/SQLite工作区.mjs')), await evaluate(join(root, '服务包/扩展功能/本机服务/数据服务.mjs')));
  const clientModule = await evaluate(join(root, '画布副本/web/src/guan/sqlite/本机授权客户端.mjs'));
  const parent = mkdtempSync(join(tmpdir(), 'guan-generation-memory-preview-')), webRoot = join(parent, 'web'), key = randomBytes(32);
  mkdirSync(webRoot); writeFileSync(join(webRoot, 'index.html'), '<!doctype html><html><head></head><body>仅HTTP协议预审，不是迁入界面</body></html>');
  const app = await startup.startIsolatedAuthorizedWorkbench({ webRoot, dataRoot: join(parent, '工作区'), initialize: true, storage, credentialKeyProvider: { create: async () => Buffer.from(key), read: async () => Buffer.from(key) } });
  try {
    const ticket = app.issueTicket();
    const authorization = await clientModule.authorizeLocalStorage({ code: ticket.code, origin: app.origin, fetchImpl: (url, options) => fetch(url, { ...options, headers: { ...options.headers, Origin: app.origin } }) });
    assert.equal(typeof authorization.generationPort.bind, 'function'); assert.equal('read' in authorization.generationPort, false);
    const session = await authorization.host.initialize();
    const binding = await authorization.generationPort.bind({ kind: 'openai', endpoint: 'https://api.example.com', value: 'synthetic-memory-preview-key' });
    assert.deepEqual(await authorization.generationPort.describe(binding.binding), binding);
    assert.deepEqual(await authorization.generationPort.list('product-A'), []);
    const write = await fetch(authorization.url + `/v1/workspaces/${session.workspaceId}/documents/extension/guan-generation-ledger-v1`, { method: 'PUT', headers: { Origin: app.origin, Authorization: 'Bearer ' + session.token, 'X-Guan-CSRF': session.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ value: { forged: true }, expectedRevision: 0, operationId: randomUUID() }) });
    assert.equal(write.status, 403); assert.equal((await write.json()).error.code, 'reserved_generation_document');
    await authorization.host.close();
    await assert.rejects(authorization.generationPort.list('product-A'));
    assert.equal(app.getStatus().generation.running, 0);
  } finally { await app.close(); key.fill(0); }
  核验Excel删除字体平滑完整包(root, true);
  console.log(JSON.stringify({ memoryOnly: true, retainedTestRoot: parent, authorCoreChanged: false, active3100Changed: false, realProviderCalled: false }));
});
test('候选启动器忙时拒绝停机不缓存失败；任务结束后可正常关闭', async () => {
  let release, entered, calls = 0;
  const blocked = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  // 只替代外网传输边界；启动器/授权/任务/写入队列均用候选实际代码，绝不访问example.com。
  const { root, evaluate } = await candidateVM(async () => { calls++; entered(); await blocked; return { status: 200, contentType: 'application/json', bytes: Buffer.from('{"data":[]}') }; });
  const startup = await evaluate(join(root, '画布副本/扩展功能/本机服务/受限工作台启动器.mjs'));
  const storage = Object.assign({}, await evaluate(join(root, '服务包/扩展功能/本机存储/SQLite工作区.mjs')), await evaluate(join(root, '服务包/扩展功能/本机服务/数据服务.mjs')));
  const clientModule = await evaluate(join(root, '画布副本/web/src/guan/sqlite/本机授权客户端.mjs'));
  const parent = mkdtempSync(join(tmpdir(), 'guan-generation-close-preview-')), webRoot = join(parent, 'web'), key = randomBytes(32);
  mkdirSync(webRoot); writeFileSync(join(webRoot, 'index.html'), '<!doctype html><html><head></head><body>停机协议预审</body></html>');
  const app = await startup.startIsolatedAuthorizedWorkbench({ webRoot, dataRoot: join(parent, '工作区'), initialize: true, storage, credentialKeyProvider: { create: async () => Buffer.from(key), read: async () => Buffer.from(key) } });
  let authorization;
  try {
    authorization = await clientModule.authorizeLocalStorage({ code: app.issueTicket().code, origin: app.origin, fetchImpl: (url, options) => fetch(url, { ...options, headers: { ...options.headers, Origin: app.origin } }) });
    await authorization.host.initialize();
    const binding = await authorization.generationPort.bind({ kind: 'openai', endpoint: 'https://api.example.com', value: 'synthetic-close-preview-key' });
    const task = { id: randomUUID(), productId: 'product-A', nodeId: 'node-A', binding: binding.binding, request: { method: 'POST', path: '/v1/images/generations', contentType: 'application/json', body: 'e30=' } };
    await authorization.generationPort.submit(task); await started;
    await assert.rejects(app.close(), error => error.code === 'generation_busy');
    assert.equal(app.getStatus().ready, true); assert.equal(app.getStatus().generation.running, 1);
    release();
    for (let i = 0; i < 1000 && app.getStatus().generation.running; i++) await nextTurn();
    assert.equal(app.getStatus().generation.running, 0); assert.equal((await authorization.generationPort.get(task.id)).state, 'succeeded');
    await authorization.host.close(); await app.close(); assert.equal(app.getStatus().ready, false); assert.equal(calls, 1);
  } finally { release(); await authorization?.host.close().catch(() => {}); await app.close(); key.fill(0); }
  核验Excel删除字体平滑完整包(root, true);
  console.log(JSON.stringify({ retainedTestRoot: parent, transportBoundaryMocked: true, realProviderCalled: false }));
});
