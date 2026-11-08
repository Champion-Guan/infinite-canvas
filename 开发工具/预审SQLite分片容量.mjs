import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { 根目录 } from './公共.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createRecoverableShardedApplicationStorage } from '../扩展功能/本机存储/可恢复分片应用存储.mjs';
import { MAX_FRAGMENT_BYTES, MAX_LOGICAL_BYTES } from '../扩展功能/本机存储/分片值编码.mjs';
import { capacityCases, syntheticCanvas } from './分片合成数据.mjs';

const key = 'infinite-canvas:canvas_store', results = [], round = n => Math.round(n * 100) / 100;
for (const config of [...capacityCases, { name: '单产品2100节点', products: 1, nodes: 2100, textLength: 1000 }]) {
  const root = mkdtempSync(join(tmpdir(), 'guan-sharded-capacity-')); let workspace = openWorkspace({ dataRoot: root, initialize: true });
  const writes = [], reads = [], client = {
    readDocument: async (...args) => { const doc = workspace.readDocument(...args); reads.push(doc ? Buffer.byteLength(JSON.stringify(doc.value)) : 0); return doc; },
    writeDocument: async input => { writes.push({ bytes: Buffer.byteLength(JSON.stringify(input.value)), isRoot: !input.id.startsWith('app-part-') }); return workspace.writeDocument(input); },
  };
  const create = () => createRecoverableShardedApplicationStorage({ client });
  let app = create(), store = app.createInstance();
  function metrics(start) { const values = writes.slice(start); return { documentWrites: values.length, fragmentWrites: values.filter(x => !x.isRoot).length, rootWrites: values.filter(x => x.isRoot).length, writeValueBytes: values.reduce((sum, x) => sum + x.bytes, 0) }; }
  try {
    const source = syntheticCanvas(config), firstStart = performance.now();
    await store.setItem(key, source); await app.flush(); const firstSaveMs = round(performance.now() - firstStart), first = metrics(0);
    const index = writes.length, beforeReads = reads.length, renameStart = performance.now(), renamed = syntheticCanvas(config, '-改名');
    await store.setItem(key, renamed); await app.flush(); const renameSaveMs = round(performance.now() - renameStart), rename = metrics(index);
    const next = JSON.parse(renamed), nodeStartWrites = writes.length, nodeStart = performance.now();
    next.state.projects[0].nodes[0].metadata.text += '-尺寸关键词';
    const final = JSON.stringify(next); await store.setItem(key, final); await app.flush(); const nodeEditSaveMs = round(performance.now() - nodeStart), nodeEdit = metrics(nodeStartWrites);
    const warmEditReadCalls = reads.length - beforeReads;
    assert.ok(writes.every(x => x.isRoot || x.bytes <= MAX_FRAGMENT_BYTES));
    if (config.products >= 5) assert.ok(rename.writeValueBytes < first.writeValueBytes / 5);
    app.close(); workspace.close(); workspace = openWorkspace({ dataRoot: root }); app = create(); store = app.createInstance();
    const reopenStart = performance.now(); assert.equal(await store.getItem(key), final); await app.flush(); const reopenReadMs = round(performance.now() - reopenStart); app.close();
    results.push({ ...config, accepted: true, sourceBytes: Buffer.byteLength(source), firstSaveMs, renameSaveMs, nodeEditSaveMs, reopenReadMs,
      first, rename, nodeEdit, warmEditReadCalls, exactColdRead: true, syntheticDataRoot: root });
  } finally { workspace.close(); }
}
const output = mkdtempSync(join(根目录, '.运行/output/SQLite分片容量-'));
const report = { dateUTC: new Date().toISOString(), maxFragmentBytes: MAX_FRAGMENT_BYTES, maxLogicalNamespaceBytes: MAX_LOGICAL_BYTES, results,
  selectedSyntheticCapacityPassed: true, productionTakenOver: false, limitations: ['每项一次样本，仅进程内真实SQLite，不是HTTP或浏览器性能基准', '仍需要完整JSON解析和应用值编码；这里只减少实际文档写入量，不宣称解决React卡顿', '没有块GC，旧代/失败块/幂等记录均保留，磁盘会增长', '原工作区usage暂把v2及块计入extension物理文档，不是逻辑记录数量', '正式凭据、生命周期和生产接入仍未交付'] };
writeFileSync(join(output, '分片容量结果.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, ...report }, null, 2));
