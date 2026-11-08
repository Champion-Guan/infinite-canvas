import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { 根目录 } from './公共.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createRecoverableApplicationStorage } from '../扩展功能/本机存储/可恢复应用存储.mjs';
import { MAX_DOCUMENT_BYTES } from '../扩展功能/本机存储/协议.mjs';

// 仅生成合成数据，测量当前兼容层的整命名空间成本，不改限制或已批准实现。
// 项目字段来自锁定上游use-canvas-store.ts/type canvas.ts；不是客户项目样本。
const key = 'infinite-canvas:canvas_store';
const cases = [
  { name: '单产品50节点', products: 1, nodes: 50, textLength: 500 },
  { name: '单产品200节点', products: 1, nodes: 200, textLength: 1000 },
  { name: '5产品各200节点', products: 5, nodes: 200, textLength: 1000 },
  { name: '10产品各200节点', products: 10, nodes: 200, textLength: 1000 },
  { name: '20产品各250节点', products: 20, nodes: 250, textLength: 1000 },
  { name: '5产品各200中文节点', products: 5, nodes: 200, textLength: 500, chinese: true },
];
function snapshot(config, titleSuffix = '') {
  const time = '2026-10-18T00:00:00.000Z';
  const text = (config.chinese ? '尺寸材质展示' : 'synthetic product dimensions ').repeat(config.textLength).slice(0, config.textLength);
  const projects = Array.from({ length: config.products }, (_, p) => ({
    id: `p-${p}`, title: `合成产品${p}${p === 0 ? titleSuffix : ''}`, createdAt: time, updatedAt: time,
    nodes: Array.from({ length: config.nodes }, (_, n) => ({ id: `n-${p}-${n}`, type: 'text', title: `合成提示词${n}`, position: { x: (n % 20) * 350, y: Math.floor(n / 20) * 300 }, width: 320, height: 240, metadata: { text } })),
    connections: Array.from({ length: Math.max(0, config.nodes - 1) }, (_, n) => ({ id: `e-${p}-${n}`, fromNodeId: `n-${p}-${n}`, toNodeId: `n-${p}-${n + 1}` })),
    chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
  }));
  return JSON.stringify({ state: { projects, deletedProjects: [] }, version: 0 });
}
function storage(workspace, observations) {
  const client = {
    readDocument: async (collection, id) => workspace.readDocument(collection, id),
    writeDocument: async input => {
      const start = performance.now(); const ack = workspace.writeDocument(input);
      observations.push({ bodyBytes: Buffer.byteLength(JSON.stringify(input.value)), sqliteWriteMs: performance.now() - start });
      return ack;
    },
    readUsage: async () => workspace.readUsage(),
  };
  const app = createRecoverableApplicationStorage({ client });
  return { app, store: app.createInstance({ storeName: 'app_state' }) };
}
const rounded = value => Math.round(value * 100) / 100;
const results = [];
for (const config of cases) {
  const root = mkdtempSync(join(tmpdir(), 'guan-sqlite-capacity-')), dataRoot = join(root, '数据');
  let workspace = openWorkspace({ dataRoot, initialize: true });
  const observations = [], { app, store } = storage(workspace, observations);
  try {
    const baseline = snapshot({ products: 1, nodes: 1, textLength: 10 });
    await store.setItem(key, baseline); await app.flush();
    const before = workspace.listDocuments('extension')[0];
    const source = snapshot(config); const start = performance.now();
    let rejected;
    try { await store.setItem(key, source); await app.flush(); }
    catch (error) { rejected = error.code ?? 'unknown'; }
    const firstSaveMs = performance.now() - start;
    if (rejected) {
      // 超限也是需记录的产品缺口；只验证没有丢掉旧快照或谎报成功。
      assert.equal(rejected, 'document_too_large');
      assert.deepEqual(workspace.listDocuments('extension')[0], before);
      assert.equal(app.getStatus().state, 'error');
      assert.equal(observations.length, 1, '超限候选不得发出写请求');
      workspace.close(); workspace = openWorkspace({ dataRoot });
      const restored = storage(workspace, []); assert.equal(await restored.store.getItem(key), baseline); restored.app.close();
      results.push({ ...config, sourceBytes: Buffer.byteLength(source), accepted: false, error: rejected, firstSaveMs: rounded(firstSaveMs), previousSnapshotPreserved: true, unconfirmedStateVisible: true, syntheticDataRoot: dataRoot });
      continue;
    }
    assert.equal(await store.getItem(key), source); await app.flush();
    // 只改一个项目的名称，观察现有整命名空间重写的规模，不称为增量更新。
    const next = snapshot(config, '-改名'), updateStart = performance.now();
    await store.setItem(key, next); await app.flush(); const renameSaveMs = performance.now() - updateStart;
    const last = observations.at(-1); assert.equal(observations.length, 3);
    app.close(); workspace.close(); workspace = openWorkspace({ dataRoot });
    const reopened = storage(workspace, []), readStart = performance.now();
    assert.equal(await reopened.store.getItem(key), next); const reopenReadMs = performance.now() - readStart;
    reopened.app.close();
    results.push({ ...config, sourceBytes: Buffer.byteLength(source), accepted: true, encodedNamespaceBytes: last.bodyBytes, firstSaveMs: rounded(firstSaveMs), renameSaveMs: rounded(renameSaveMs), lastSQLiteWriteMs: rounded(last.sqliteWriteMs), reopenReadMs: rounded(reopenReadMs), exactColdRead: true, syntheticDataRoot: dataRoot });
  } finally { workspace.close(); }
}
const output = join(根目录, '.运行/output', 'SQLite容量预审-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const report = { date: new Date().toISOString(), node: process.version, documentLimitBytes: MAX_DOCUMENT_BYTES, results,
  customerCapacityReady: results.every(item => item.accepted), productionTakenOver: false,
  boundaries: ['进程内真实SQLite与候选恢复兼容层，不含HTTP、浏览器渲染、媒体或凭据', '每种规模仅一次首次写入、一次改名及冷重开，不是统计性能基准', '所有根目录为新建合成数据，保留供复查；不读取现有数据、不修改协议或容量限制', '拒绝超限是安全保护通过，但代表该规模尚不能交付，不能记成容量验收通过'] };
writeFileSync(join(output, '容量与性能结果.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, ...report }, null, 2));
