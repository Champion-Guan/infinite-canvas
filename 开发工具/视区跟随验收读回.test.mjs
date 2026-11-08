import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';
import { readFreshRevealCanvas } from './视区跟随原画布夹具.mjs';

test('验收观察者每次从SQLite读新根，而不是复用首次空画布缓存', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'guan-reveal-reader-')));
  const workspace = openWorkspace({ dataRoot: join(root, '数据'), initialize: true });
  const client = { readDocument: (...args) => workspace.readDocument(...args), writeDocument: value => workspace.writeDocument(value) };
  const writer = createShardedApplicationStorage({ client }), cachedReader = createShardedApplicationStorage({ client });
  const key = 'infinite-canvas:canvas_store';
  const empty = { state: { currentProjectId: 'synthetic', projects: [{ id: 'synthetic', nodes: [] }] }, version: 1 };
  const created = structuredClone(empty); created.state.projects[0].nodes.push({ id: 'synthetic-node', type: 'text' });
  try {
    await writer.createInstance().setItem(key, JSON.stringify(empty));
    assert.deepEqual(await readFreshRevealCanvas(client), empty);
    assert.deepEqual(JSON.parse(await cachedReader.createInstance().getItem(key)), empty);
    await writer.createInstance().setItem(key, JSON.stringify(created));
    assert.deepEqual(JSON.parse(await cachedReader.createInstance().getItem(key)), empty, '重现旧验收工具的会话缓存');
    assert.deepEqual(await readFreshRevealCanvas(client), created, '新观察者须读取浏览器刚提交的一代');
  } finally { writer.close(); cachedReader.close(); workspace.close(); }
});
