import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, totalmem, cpus } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createRecoverableApplicationStorage } from '../扩展功能/本机存储/可恢复应用存储.mjs';
import { createWriteCoordinator } from '../扩展功能/本机服务/写入协调.mjs';

const measurements = [];
test('真实单文档链路保存200、1000和5000节点，冷重开精确恢复并测量序列化', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'M1保存复现-'));
  let workspace, app;
  try {
    workspace = openWorkspace({ dataRoot: directory, initialize: true });
    const client = {
      readDocument: async (...args) => workspace.readDocument(...args),
      writeDocument: async input => workspace.writeDocument(input),
    };
    app = createRecoverableApplicationStorage({ client });
    const key = 'infinite-canvas:canvas_store';
    for (const count of [200, 1000, 5000]) {
      const store = app.createInstance();
      const value = { state: { projects: [{ id: '合成产品', title: '性能复现',
        nodes: Array.from({ length: count }, (_, index) => ({ id: '节点-' + index, type: 'text', title: '提示词',
          position: { x: index % 20 * 350, y: Math.floor(index / 20) * 300 }, width: 320, height: 240,
          metadata: { content: '合成提示词用于测量，不含真实客户数据。'.repeat(30) } })),
        connections: [], chatSessions: [], activeChatId: null, viewport: { x: 0, y: 0, k: 1 } }], deletedProjects: [] } };
      const serialStart = performance.now(), serialized = JSON.stringify(value), jsonMs = performance.now() - serialStart;
      const saveStart = performance.now();
      await store.setItem(key, serialized); await app.flush();
      const saveMs = performance.now() - saveStart;
      app.close();
      app = createRecoverableApplicationStorage({ client });
      assert.deepEqual(JSON.parse(await app.createInstance().getItem(key)), value);
      app.close(); app = createRecoverableApplicationStorage({ client });
      measurements.push({ nodes: count, bytes: Buffer.byteLength(serialized),
        stringifyMs: +jsonMs.toFixed(2), encodeWriteAckMs: +saveMs.toFixed(2) });
    }
  } finally { app?.close(); workspace?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('SQLite删除后空闲页可复用，不要求每次VACUUM；实际主键查询使用索引', () => {
  const directory = mkdtempSync(join(tmpdir(), 'M1数据库复现-'));
  let workspace, reader;
  try {
    workspace = openWorkspace({ dataRoot: directory, initialize: true });
    const write = (id, character) => workspace.writeDocument({ collection: 'extension', id, value: { text: character.repeat(1024 * 1024) },
      expectedRevision: 0, operationId: randomUUID() });
    write('large-document', 'a');
    const file = join(directory, '工作台.sqlite');
    reader = new DatabaseSync(file);
    const plan = reader.prepare("EXPLAIN QUERY PLAN SELECT * FROM documents WHERE collection=? AND id=?").all('extension', 'large-document');
    assert.ok(plan.some(item => /INDEX|PRIMARY KEY/.test(item.detail)), JSON.stringify(plan));
    const before = reader.prepare('PRAGMA page_count').get().page_count;
    reader.prepare('DELETE FROM documents WHERE collection=? AND id=?').run('extension', 'large-document');
    const free = reader.prepare('PRAGMA freelist_count').get().freelist_count;
    assert.ok(free > 0);
    write('replacement-document', 'b');
    const after = reader.prepare('PRAGMA page_count').get().page_count;
    assert.ok(after <= before + 8, '空闲页应复用，不能按每次写入持续增长');
    measurements.push({ databasePagesBefore: before, freedPages: free, databasePagesAfter: after,
      databaseBytes: statSync(file).size, queryPlan: plan.map(item => item.detail) });
  } finally { reader?.close(); workspace?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('128个同时提交的保存实际串行，无四路SQLite写入或等待超时', async () => {
  const coordinator = createWriteCoordinator();
  let active = 0, peak = 0, completed = 0;
  await Promise.all(Array.from({ length: 128 }, () => coordinator.runWrite(async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--; completed++;
  })));
  assert.equal(peak, 1); assert.equal(completed, 128);
  assert.equal(coordinator.getStatus().queuedWrites, 0);
  await coordinator.close();
  measurements.push({ concurrentSubmissions: 128, peakSQLiteWriters: peak, completed });
});

test.after(() => {
  const directory = new URL('../开发文档/验收记录/Claude逐项复现20261102/', import.meta.url);
  mkdirSync(directory, { recursive: true });
  const result = { date: new Date().toISOString(), cpu: cpus()[0]?.model, memoryGiB: totalmem() / 1024 ** 3,
    runtime: process.version, measurements,
    scope: '当前本机、合成画布、真实编码与SQLite落盘回执；不含浏览器绘制、上游生图或Mac B实机升级。单次测量用于复现报告估算，不作为统计基准。临时数据库均已清理。' };
  writeFileSync(new URL('M1实测.json', directory), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
});
