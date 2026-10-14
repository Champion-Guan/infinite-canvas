import test from 'node:test';
import assert from 'node:assert/strict';
import { planPort3000Merge, comparableSnapshot } from '../src/shared/data-contract/port3000-merge.mjs';
import { encodeBackupValue, decodeBackupValue } from '../src/shared/data-contract/browser-backup-codec.mjs';

const snapshot = port => ({ app: 'guan-ai-workbench', kind: 'full-browser-backup', format: 1,
  origin: 'http://localhost:' + port, localStorage: {}, sessionStorage: {}, databases: [] });
const store = (name, records) => ({ name, keyPath: null, autoIncrement: false, indexes: [], records });
const database = stores => ({ name: 'infinite-canvas', version: 8, stores });
const state = projects => JSON.stringify({ version: 0, state: { projects, deletedProjects: [] } });

test('merge keeps both sets of projects/media and unrelated settings, uses source preferences with complete backup retained', async () => {
  const s = snapshot(8888), t = snapshot(3000);
  s.localStorage = { 'infinite-canvas:theme_store': 'source', 'guan-header-canvas-projects': 'source-products' };
  t.localStorage = { 'infinite-canvas:theme_store': 'target', 'champion-blog:new-post-draft': 'unchanged', 'resume-site-auth': 'unchanged' };
  const blob = await encodeBackupValue(new Blob(['original-image'], { type: 'image/png' }));
  s.databases = [database([store('app_state', [{ key: 'infinite-canvas:canvas_store', value: state([{ id: 'source', nodes: [] }]) }]), store('image_files', [{ key: 'source-image', value: blob }])])];
  t.databases = [database([store('app_state', [{ key: 'infinite-canvas:canvas_store', value: state([{ id: 'target', nodes: [{ id: 'existing-node' }] }]) }]), store('image_files', [{ key: 'target-image', value: blob }])])];
  const before = JSON.stringify(t), plan = await planPort3000Merge(s, t);
  assert.equal(JSON.stringify(t), before);
  assert.equal(plan.snapshot.localStorage['resume-site-auth'], 'unchanged');
  assert.equal(plan.snapshot.localStorage['champion-blog:new-post-draft'], 'unchanged');
  assert.equal(plan.snapshot.localStorage['infinite-canvas:theme_store'], 'source');
  assert.deepEqual(JSON.parse(plan.snapshot.databases[0].stores[0].records[0].value).state.projects.map(x => x.id), ['source', 'target']);
  assert.equal(plan.snapshot.databases[0].stores[1].records.length, 2);
  assert.equal(await decodeBackupValue(plan.snapshot.databases[0].stores[1].records[0].value).text(), 'original-image');
});

test('same-ID different canvas, media, schema, deletion and unrelated setting conflicts refuse before writes', async () => {
  const s = snapshot(8888), t = snapshot(3000);
  s.databases = [database([store('app_state', [{ key: 'infinite-canvas:canvas_store', value: state([{ id: 'same', nodes: [] }]) }])])];
  t.databases = [database([store('app_state', [{ key: 'infinite-canvas:canvas_store', value: state([{ id: 'same', nodes: [1] }]) }])])];
  await assert.rejects(planPort3000Merge(s, t), /同标识/);
  t.databases[0].stores[0].records[0].value = JSON.stringify({ version: 0, state: { projects: [], deletedProjects: [{ id: 'same', deletedAt: 'old' }] } });
  await assert.rejects(planPort3000Merge(s, t), /回收记录冲突/);
  t.databases[0].version = 9;
  await assert.rejects(planPort3000Merge(s, t), /结构冲突/);
  s.databases = [database([store('image_files', [{ key: 'same', value: 'different' }])])];
  t.databases = [database([store('image_files', [{ key: 'same', value: 'retained' }])])];
  await assert.rejects(planPort3000Merge(s, t), /业务记录/);
  s.databases = t.databases = []; s.localStorage['blog:post'] = 'different'; t.localStorage['blog:post'] = 'retained';
  await assert.rejects(planPort3000Merge(s, t), /其他项目/);
});

test('caches retain destination records; only exact origins allowed, unknown database refuses', async () => {
  const s = snapshot(8888), t = snapshot(3000);
  s.databases = [database([store('prompt_cache', [{ key: 'known', value: 'new' }, { key: 'additional', value: 'new' }])])];
  t.databases = [database([store('prompt_cache', [{ key: 'known', value: 'existing' }])])];
  const plan = await planPort3000Merge(s, t);
  assert.equal(plan.snapshot.databases[0].stores[0].records[0].value, 'existing');
  assert.equal(plan.snapshot.databases[0].stores[0].records.length, 2);
  s.origin = 'http://localhost:8889'; await assert.rejects(planPort3000Merge(s, t), /只允许/);
  s.origin = 'http://localhost:8888'; s.databases[0].name = 'another-project'; await assert.rejects(planPort3000Merge(s, t), /未知数据库/);
});

test('full verification is independent of ordering but detects altered bytes and removed foreign keys', () => {
  const a = snapshot(3000); a.localStorage = { b: '2', a: '1' }; a.sessionStorage.__imt_handshake_page_id = 'old';
  const b = snapshot(3000); b.localStorage = { a: '1', b: '2' }; b.sessionStorage.__imt_handshake_page_id = 'new';
  assert.equal(comparableSnapshot(a), comparableSnapshot(b));
  delete b.localStorage.b; assert.notEqual(comparableSnapshot(a), comparableSnapshot(b));
});
