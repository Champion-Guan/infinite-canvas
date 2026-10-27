import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';
import { createRecoverableShardedApplicationStorage } from '../扩展功能/本机存储/可恢复分片应用存储.mjs';
import { syntheticCanvas } from './分片合成数据.mjs';

// 原60秒测试串行塞入全部故障边界，累计编码、SQLite读写及请求预算等待会超时。
// 保留原测试和阈值。本文件同样数据、全部边界、同样断言，按独立库/客户端分场景；
// 不模拟时钟、不抬高/关闭96次/10050ms节流，限制同时最多6个隔离场景。
const key = 'infinite-canvas:canvas_store', rootId = 'app-' + createHash('sha256').update('app_state').digest('hex');
const baseline = syntheticCanvas({ products: 1, nodes: 1, textLength: 10 }), next = syntheticCanvas({ products: 1, nodes: 500, textLength: 2000 });
const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function fixture(write) {
  const root = mkdtempSync(join(tmpdir(), 'guan-shard-matrix-')), workspace = openWorkspace({ dataRoot: join(root, '数据'), initialize: true }), writes = [], calls = []; roots.push(root);
  const client = { readDocument: async (...args) => { calls.push(performance.now()); return workspace.readDocument(...args); },
    writeDocument: async input => { calls.push(performance.now()); writes.push(structuredClone(input)); return write ? write(input, workspace) : workspace.writeDocument(input); } };
  const app = createRecoverableShardedApplicationStorage({ client });
  return { root, workspace, app, writes, calls, client, rootDocument: () => workspace.readDocument('extension', rootId) };
}
test('全部实际分片故障边界按独立场景验收，保留真实限流及60秒单场景上限', { concurrency: 6 }, async t => {
  const trial = fixture(); let total;
  try { const a = trial.app.createInstance(); await a.setItem(key, baseline); const start = trial.writes.length; await a.setItem(key, next); await trial.app.flush(); total = trial.writes.length - start; }
  finally { trial.workspace.close(); }
  assert.ok(total > 2);
  console.log(JSON.stringify({ matrixBoundaries: total, matrixCases: total * 2, concurrentCases: 6, clientBudgetUnchanged: '96/10050ms' }));
  const jobs = [];
  for (const phase of ['before', 'after']) for (let point = 1; point <= total; point++) jobs.push(t.test(`${phase}-${point}/${total}`, { timeout: 60_000 }, async () => {
    let active = false, count = 0, lost, once = true;
    const f = fixture((input, workspace) => {
      if (!active || ++count !== point || !once) return workspace.writeDocument(input);
      once = false; lost = structuredClone(input);
      if (phase === 'after') workspace.writeDocument(input);
      throw Error('合成写入中断');
    });
    const begin = performance.now();
    try {
      const a = f.app.createInstance(); await a.setItem(key, baseline); await f.app.flush(); active = true;
      await assert.rejects(a.setItem(key, next)); assert.equal(f.app.getStatus().state, 'error');
      const reader = createShardedApplicationStorage({ client: f.client });
      assert.equal(await reader.createInstance().getItem(key), phase === 'after' && point === total ? next : baseline); reader.close();
      await assert.rejects(f.app.flush(), error => error.code === 'save_not_confirmed');
      await f.app.retryPending(); await f.app.flush(); assert.equal(await a.getItem(key), next);
      assert.equal(f.rootDocument().revision, 2);
      const repeats = f.writes.filter(write => write.operationId === lost.operationId);
      assert.equal(repeats.length, 2); assert.deepEqual(repeats[0], repeats[1]);
      for (let i = 96; i < f.calls.length; i++) assert.ok(f.calls[i] - f.calls[i - 96] >= 10_045, '实际调用不得绕过客户端96次/10050ms预算');
      console.log(JSON.stringify({ phase, point, total, root: f.root, calls: f.calls.length, elapsedMs: Math.round(performance.now() - begin), passed: true }));
    } finally { f.workspace.close(); }
  }));
  await Promise.all(jobs);
});
