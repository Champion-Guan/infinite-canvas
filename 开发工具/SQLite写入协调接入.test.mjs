import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { 根目录 } from './公共.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 写入协调批准产物, 建立SQLite写入协调隔离服务, 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';
import { 核验写入协调批准, 读取写入协调批准, 核验写入协调自有依赖, 检查写入协调服务包, 写入协调差异SHA256, 服务包协议路径, 服务包工作区路径 } from '../上游适配/SQLite写入协调批准.mjs';
import { 服务路径, 协调路径 } from './预审SQLite写入协调.mjs';
import { createDataClient } from '../扩展功能/本机存储/浏览器适配.mjs';

const delta = 写入协调批准产物();
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'guan-stage6-gate-approved-')), root = join(home, '服务包'); mkdirSync(root);
  for (const [path, source] of [[服务包协议路径, readFileSync(join(根目录, 服务包协议路径))], [服务包工作区路径, readFileSync(join(根目录, 服务包工作区路径))], [服务路径, delta.get(服务路径).原文]]) {
    mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), source);
  }
  return { home, root };
}
function apply(root, home, options = {}) {
  return 事务写入(root, delta, join(home, '快照'), { 差异指纹: 写入协调差异SHA256, 写后检查() { assert.equal(检查写入协调服务包(root), true); }, ...options });
}

test('写入协调批准锁定历史JSON/patch、完整前置及新模块，原服务保持不变', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/SQLite写入协调.json')), patch = readFileSync(join(根目录, '上游适配/待审查/SQLite写入协调.patch'));
  assert.match(读取写入协调批准().状态, /^待具体2文件/); assert.equal(delta.size, 2);
  核验写入协调自有依赖(根目录);
  assert.equal(readFileSync(join(根目录, 服务路径), 'utf8'), delta.get(服务路径).原文);
  assert.throws(() => 核验写入协调批准(Buffer.concat([json, Buffer.from(' ')]), patch), /指纹/);
  assert.throws(() => 核验写入协调批准(json, Buffer.concat([patch, Buffer.from(' ')])), /指纹/);
});
test('服务包只能完整前态或后态，半批及服务/协议未知修改均拒绝', () => {
  const { root, home } = fixture(); assert.equal(检查写入协调服务包(root), false);
  writeFileSync(join(root, 服务路径), delta.get(服务路径).产物);
  assert.throws(() => 检查写入协调服务包(root), /不完整/);
  writeFileSync(join(root, 协调路径), delta.get(协调路径).产物); assert.equal(检查写入协调服务包(root), true);
  writeFileSync(join(root, 服务路径), '未知服务'); assert.throws(() => 检查写入协调服务包(root), /未知改动/);
  writeFileSync(join(root, 服务路径), delta.get(服务路径).产物);
  writeFileSync(join(root, 服务包协议路径), '未知协议'); assert.throws(() => 检查写入协调服务包(root), /协议/);
  assert.equal(existsSync(join(home, '快照')), false);
});
test('服务包拒绝额外代码/空目录以及文件/父目录符号链接、硬链接', () => {
  for (const type of ['extra', 'directory', 'symbolic', 'hard', 'parent']) {
    const { root, home } = fixture();
    if (type === 'extra') writeFileSync(join(root, '未知.mjs'), 'export{}');
    else if (type === 'directory') mkdirSync(join(root, '未知目录'));
    else if (type === 'parent') {
      const linkedRoot = join(home, '链接包'); symlinkSync(root, linkedRoot);
      assert.throws(() => 检查写入协调服务包(linkedRoot), /符号链接/); continue;
    } else {
      const external = join(home, '外部.mjs'); writeFileSync(external, delta.get(服务路径).原文);
      unlinkSync(join(root, 服务路径));
      if (type === 'symbolic') symlinkSync(external, join(root, 服务路径)); else linkSync(external, join(root, 服务路径));
    }
    assert.throws(() => 检查写入协调服务包(root), /未知|链接/);
  }
});
test('第二文件写入前失败与写后检查失败均完整回退，不遗留半批', () => {
  for (const point of ['midway', 'postcheck']) {
    const { root, home } = fixture();
    assert.throws(() => apply(root, home, point === 'midway' ? { 写入前(_path, count) { if (count === 1) throw Error('合成故障'); } } : { 写后检查() { throw Error('合成故障'); } }), /合成故障/);
    assert.equal(检查写入协调服务包(root), false); assert.equal(existsSync(join(root, 协调路径)), false);
    assert.equal(readFileSync(join(root, 服务路径), 'utf8'), delta.get(服务路径).原文);
    assert.equal(JSON.parse(readFileSync(join(home, '快照/事务.json'))).状态, '已回退');
  }
});
test('接入成功保留精确原服务快照，协议不变且事务记录只有批准两文件', () => {
  const { root, home } = fixture(); apply(root, home);
  assert.equal(检查写入协调服务包(root), true);
  assert.equal(readFileSync(join(home, '快照/接入前', 服务路径), 'utf8'), delta.get(服务路径).原文);
  assert.equal(readFileSync(join(root, 服务包协议路径), 'utf8'), readFileSync(join(根目录, 服务包协议路径), 'utf8'));
  const journal = JSON.parse(readFileSync(join(home, '快照/事务.json')));
  assert.equal(journal.状态, '完成'); assert.equal(journal.文件.length, 2); assert.equal(journal.差异SHA256, 写入协调差异SHA256);
});
test('真实磁盘装配模块可由HTTP保存并取得持久化ACK，禁止加载前态包', async () => {
  const { root } = fixture(); await assert.rejects(加载SQLite写入协调隔离服务({ 服务包: root }), /完整批准/);
  const integration = 建立SQLite写入协调隔离服务(), { startDataService, openWorkspace } = await 加载SQLite写入协调隔离服务(integration);
  const dataRoot = mkdtempSync(join(tmpdir(), 'guan-stage6-gate-disk-')), workspace = openWorkspace({ dataRoot, initialize: true });
  const origin = 'http://localhost:43122', service = await startDataService({ workspace, allowedOrigins: [origin] });
  const client = createDataClient({ url: service.url, session: service.issueSession(origin), fetchImpl: (url, init) => fetch(url, { ...init, headers: { ...init.headers, Origin: origin } }) });
  try {
    const ack = await client.writeDocument({ collection: 'canvas', id: 'disk', value: { id: 'disk', title: '磁盘装配', nodes: [], connections: [] }, expectedRevision: 0, operationId: randomUUID(), mediaIds: [] });
    assert.equal(ack.persisted, true); assert.equal(workspace.readDocument('canvas', 'disk').value.title, '磁盘装配');
    await service.createBackup(); assert.equal(service.getWriteStatus().queuedWrites, 0);
  } finally { client.close(); await service.close(); workspace.close(); }
  console.log(JSON.stringify({ assembledService: integration, syntheticDataRoot: dataRoot, retained: true }));
});

test('最终闭合模块图共享协议身份：缺媒体404、版本冲突409、坏引用404不退化500', async () => {
  const { root, home } = fixture(); apply(root, home);
  const { startDataService, openWorkspace } = await 加载SQLite写入协调隔离服务({ 服务包: root });
  const dataRoot = mkdtempSync(join(tmpdir(), 'guan-stage6-gate-errors-')), workspace = openWorkspace({ dataRoot, initialize: true });
  const origin = 'http://localhost:43123', service = await startDataService({ workspace, allowedOrigins: [origin] });
  try {
    const session = service.issueSession(origin), base = service.url + '/v1/workspaces/' + workspace.workspaceId;
    const call = (path, input) => fetch(base + path, { method: input ? 'PUT' : 'GET', headers: { Origin: origin, Authorization: 'Bearer ' + session.token, 'X-Guan-CSRF': session.csrf, ...(input ? { 'Content-Type': 'application/json' } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
    const missing = await call('/media/' + 'a'.repeat(64));
    assert.equal(missing.status, 404); assert.equal((await missing.json()).error.code, 'media_not_found');
    const input = { value: { id: 'errors', title: '模块图', nodes: [], connections: [] }, expectedRevision: 0, operationId: randomUUID(), mediaIds: [] };
    assert.equal((await call('/documents/canvas/errors', input)).status, 200);
    const conflict = await call('/documents/canvas/errors', { ...input, operationId: randomUUID() });
    assert.equal(conflict.status, 409); assert.equal((await conflict.json()).error.code, 'revision_conflict');
    const badMedia = await call('/documents/canvas/errors', { ...input, expectedRevision: 1, operationId: randomUUID(), mediaIds: ['a'.repeat(64)] });
    assert.equal(badMedia.status, 404); assert.equal((await badMedia.json()).error.code, 'media_not_found');
    assert.equal(workspace.readDocument('canvas', 'errors').revision, 1);
  } finally { await service.close(); workspace.close(); }
});
