import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { openWorkspace, restoreBackup } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createApplicationStorage } from '../扩展功能/本机存储/应用存储适配.mjs';
import { createShardedApplicationStorage, SHARDED_APPLICATION_FORMAT } from '../扩展功能/本机存储/分片应用存储.mjs';
import { createRecoverableShardedApplicationStorage } from '../扩展功能/本机存储/可恢复分片应用存储.mjs';
import { buildFragmentPlan, readFragmentGraph, MAX_FRAGMENT_BYTES, MAX_LOGICAL_BYTES, FRAGMENT_FORMAT } from '../扩展功能/本机存储/分片值编码.mjs';
import { capacityCases, syntheticCanvas } from './分片合成数据.mjs';

const key = 'infinite-canvas:canvas_store', rootId = name => 'app-' + createHash('sha256').update(name).digest('hex');
const code = expected => error => error.code === expected;
const roots = [];
function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'guan-shard-unit-')); roots.push(root);
  let workspace = openWorkspace({ dataRoot: root, initialize: true });
  const writes = [], client = {
    readDocument: async (...args) => workspace.readDocument(...args),
    writeDocument: async input => { writes.push(structuredClone(input)); return options.write ? options.write(input, workspace, writes.length) : workspace.writeDocument(input); },
    writeMedia: async blob => workspace.writeMedia(Buffer.from(await blob.arrayBuffer()), blob.type || 'application/octet-stream'),
    readMedia: async id => { const media = workspace.readMedia(id); return new Blob([media.bytes], { type: media.mime }); },
    readUsage: async () => workspace.readUsage(),
  };
  const app = createRecoverableShardedApplicationStorage({ client, requestLimit: 0, ...options });
  return { root, client, app, writes, get workspace() { return workspace; }, rootDocument: (name = 'app_state') => workspace.readDocument('extension', rootId(name)),
    cold() { workspace.close(); workspace = openWorkspace({ dataRoot: root }); return createRecoverableShardedApplicationStorage({ client, requestLimit: 0, ...options }); }, close() { workspace.close(); } };
}
const instance = (app, storeName = 'app_state') => app.createInstance({ storeName });

test('分片恢复队列仅保留已接入的工厂、诊断、队列和回收接口差异', () => {
  const old = readFileSync(new URL('../扩展功能/本机存储/可恢复应用存储.mjs', import.meta.url), 'utf8');
  const next = readFileSync(new URL('../扩展功能/本机存储/可恢复分片应用存储.mjs', import.meta.url), 'utf8');
  assert.equal(next, old.replace("import { createApplicationStorage, APP_NAMESPACES } from './应用存储适配.mjs';", "import { createShardedApplicationStorage as createApplicationStorage } from './分片应用存储.mjs';\nimport { APP_NAMESPACES } from './应用存储适配.mjs';")
    .replace('export function createRecoverableApplicationStorage(options) {', 'export function createRecoverableShardedApplicationStorage(options) {')
    // 批量回收接口的真实删除、失败重试和共享素材保护另由回收站容量专项覆盖。
    .replace('      removeItem: key => enqueue(space, () => () => instance.removeItem(key)),',
      '      removeItem: key => enqueue(space, () => () => instance.removeItem(key)),\n      removeItems: keys => enqueue(space, () => { const snapshot = [...keys]; return () => instance.removeItems(snapshot); }),')
    .replace('    createInstance, getStatus: status, readUsage: () => base.readUsage(),',
      '    createInstance, getStatus: status, readUsage: () => base.readUsage(),\n    mediaIdsForKeys: groups => base.mediaIdsForKeys(groups),\n    purgeMedia: ids => base.purgeMedia(ids),')
    // 后续已接入的分片错误阶段透传；不把既有诊断差异误报为队列行为变更。
    .replace("failures: failed.map(space => ({ namespace: space.name, code: typeof space.error?.code === 'string' ? space.error.code : 'save_unconfirmed' })) };",
      "failures: [...(baseStatus?.failures ?? []), ...failed.filter(space => !baseStatus?.failures?.some(item => item.namespace === space.name))\n        .map(space => ({ namespace: space.name, code: /^[a-z_]{3,64}$/.test(space.error?.code) ? space.error.code : 'save_unconfirmed', stage: 'prepare', status: null }))] };")
    .replace('    const pending = active.reduce((sum, space) => sum + space.queue.length, 0) + reads;\n    const baseStatus = base?.getStatus();\n    return { state: failed.length || baseStatus?.state === \'error\' ? \'error\' : pending ? \'saving\' : everSaved ? \'saved\' : \'idle\', pending,',
      '    const pending = active.reduce((sum, space) => sum + space.queue.length, 0);\n    const baseStatus = base?.getStatus();\n    return { state: failed.length || baseStatus?.state === \'error\' ? \'error\' : pending ? \'saving\' : everSaved ? \'saved\' : \'idle\', pending, reads,')
    .replace('    run.finally(() => { space.running = null; notify(); });', '    run.finally(() => {\n      space.running = null; notify();\n      // finish先唤醒调用方，调用方可能在finally清理前立即追加操作；不能搁置该队尾。\n      if (space.queue.length && !space.error) void pump(space);\n    });')
    .replace('  async function settle() { await Promise.all([...spaces.values()].map(space => space.running)); }', '  async function settle() {\n    while ([...spaces.values()].some(space => space.running)) await Promise.all([...spaces.values()].map(space => space.running));\n  }'));
});

test('连续await保存后立即追加及完成回调追加不会搁置，flush等到全部确认', { timeout: 10_000 }, async () => {
  const f = fixture();
  try {
    const a = instance(f.app);
    for (let i = 0; i < 15; i++) await a.setItem('step', i);
    await a.setItem('chain', 1).then(() => a.setItem('chain', 2));
    await f.app.flush(); assert.equal(await a.getItem('step'), 14); assert.equal(await a.getItem('chain'), 2);
    assert.equal(f.app.getStatus().pending, 0); f.app.close();
  } finally { f.close(); }
});

for (const config of capacityCases) test(`分片完整保存并冷重开：${config.name}`, async () => {
  const f = fixture();
  try {
    const a = instance(f.app), value = syntheticCanvas(config);
    await a.setItem(key, value); await f.app.flush();
    assert.equal(await a.getItem(key), value);
    assert.equal(f.rootDocument().value.format, SHARDED_APPLICATION_FORMAT);
    assert.ok(f.writes.every(write => Buffer.byteLength(JSON.stringify(write.value)) <= MAX_FRAGMENT_BYTES));
    const writesBefore = f.writes.length; f.app.close();
    const reopened = f.cold(); assert.equal(await instance(reopened).getItem(key), value); await reopened.flush(); reopened.close();
    assert.equal(f.writes.length, writesBefore, '冷读取不自动改写格式或数据');
  } finally { f.close(); }
});

test('单产品超2MiB、超长中文字符串及跨分片代理对不丢内容', async () => {
  const f = fixture();
  try {
    const a = instance(f.app), canvas = syntheticCanvas({ products: 1, nodes: 2100, textLength: 1000 });
    assert.ok(Buffer.byteLength(canvas) > 2 * 1024 * 1024); await a.setItem(key, canvas);
    const text = 'x'.repeat(8191) + '😀' + '\ud800' + '尺寸'.repeat(70000);
    await instance(f.app, 'prompt_cache').setItem('large', text); await f.app.flush(); f.app.close();
    const reopened = f.cold(); assert.equal(await instance(reopened).getItem(key), canvas); assert.equal(await instance(reopened, 'prompt_cache').getItem('large'), text); reopened.close();
  } finally { f.close(); }
});

test('产品改名及单节点编辑复用未变块，不重新写全部产品', async () => {
  const f = fixture();
  try {
    const a = instance(f.app), config = capacityCases[3];
    await a.setItem(key, syntheticCanvas(config)); await f.app.flush();
    const first = f.writes.reduce((sum, write) => sum + Buffer.byteLength(JSON.stringify(write.value)), 0), count = f.writes.length;
    await a.setItem(key, syntheticCanvas(config, '-改名')); await f.app.flush();
    const renamed = f.writes.slice(count).reduce((sum, write) => sum + Buffer.byteLength(JSON.stringify(write.value)), 0);
    assert.ok(renamed < first / 5, `${renamed}应显著低于${first}`);
    const next = JSON.parse(syntheticCanvas(config, '-改名')), beforeNode = f.writes.length;
    next.state.projects[3].nodes[100].metadata.text = '只修改一个尺寸关键词';
    await a.setItem(key, JSON.stringify(next)); await f.app.flush();
    assert.ok(f.writes.slice(beforeNode).reduce((sum, write) => sum + Buffer.byteLength(JSON.stringify(write.value)), 0) < first / 5);
    assert.deepEqual(JSON.parse(await a.getItem(key)), next);
  } finally { f.close(); }
});

test('接近32MiB的合成文本与分页数组按实际JSON大小重组，跨页代理对不误计', async () => {
  for (const value of ['x'.repeat(MAX_LOGICAL_BYTES - 64), ('x'.repeat(8191) + '😀').repeat(120), Array.from({ length: 1500 }, (_, i) => `${i}:` + 'z'.repeat(1000))]) {
    const plan = await buildFragmentPlan(value);
    const readDocument = async (_collection, id) => ({ collection: 'extension', id, value: plan.fragments.get(id).value, mediaIds: [] });
    assert.deepEqual(await readFragmentGraph({ head: plan.head, readDocument }), value);
  }
});

test('冷读取验证过的不可变块可复用，刷新后改名不再次读取整个图', async () => {
  const f = fixture(); let reads = 0;
  try {
    await instance(f.app).setItem(key, syntheticCanvas(capacityCases[2])); await f.app.flush();
    const reader = createShardedApplicationStorage({ client: { ...f.client, readDocument: async (...args) => { reads++; return f.client.readDocument(...args); } } });
    const store = instance(reader); await store.getItem(key); const afterLoad = reads, beforeWrites = f.writes.length;
    await store.setItem(key, syntheticCanvas(capacityCases[2], '-改名')); await reader.flush();
    const newParts = f.writes.slice(beforeWrites).filter(write => write.id.startsWith('app-part-')).length;
    assert.ok(afterLoad > newParts); assert.equal(reads - afterLoad, newParts, '只查询新内容块，不能重复读已核验旧块');
    assert.equal(await store.getItem(key), syntheticCanvas(capacityCases[2], '-改名')); reader.close();
  } finally { f.close(); }
});

test('所有实际块与根写入边界的前/后故障均不发布半代，原请求重试不重复revision', async t => {
  const baseline = syntheticCanvas({ products: 1, nodes: 1, textLength: 10 }), next = syntheticCanvas({ products: 1, nodes: 500, textLength: 2000 });
  const trial = fixture(); let total;
  try { await instance(trial.app).setItem(key, baseline); const start = trial.writes.length; await instance(trial.app).setItem(key, next); await trial.app.flush(); total = trial.writes.length - start; }
  finally { trial.close(); }
  assert.ok(total > 2);
  // 每个实际故障场景独立计时，避免把66个完整冷读/重试挤进单次60秒。
  // 单场景仍保留原60秒阈值和完整断言，按生产免频率限制端口串行验收。
  for (const phase of ['before', 'after']) for (let point = 1; point <= total; point++) await t.test(`${phase}-${point}/${total}`, { timeout: 60_000 }, async () => {
    let active = false, count = 0, lost, once = true;
    const f = fixture({ write(input, workspace) {
      if (!active || ++count !== point || !once) return workspace.writeDocument(input);
      once = false; lost = structuredClone(input);
      if (phase === 'after') workspace.writeDocument(input);
      throw Error('合成写入中断');
    } });
    try {
      const a = instance(f.app); await a.setItem(key, baseline); await f.app.flush(); active = true;
      await assert.rejects(a.setItem(key, next)); assert.equal(f.app.getStatus().state, 'error');
      const reader = createShardedApplicationStorage({ client: f.client });
      assert.equal(await instance(reader).getItem(key), phase === 'after' && point === total ? next : baseline); reader.close();
      await assert.rejects(f.app.flush(), code('save_not_confirmed'));
      await f.app.retryPending(); await f.app.flush(); assert.equal(await a.getItem(key), next);
      assert.equal(f.rootDocument().revision, 2);
      const repeats = f.writes.filter(write => write.operationId === lost.operationId);
      assert.equal(repeats.length, 2); assert.deepEqual(repeats[0], repeats[1]);
    } finally { f.close(); }
  });
});

test('失败后新增编辑、remove、clear保持FIFO，重试期间编辑也全部确认', { timeout: 10_000 }, async () => {
  let offline = false;
  const f = fixture({ write(input, workspace) { if (offline) throw Error('合成断网'); return workspace.writeDocument(input); } });
  try {
    const a = instance(f.app); await a.setItem('one', '原值'); await f.app.flush(); offline = true;
    await assert.rejects(a.setItem('one', '未确认'));
    await assert.rejects(a.setItem('two', '后续')); await assert.rejects(a.removeItem('one')); await assert.rejects(a.clear()); await assert.rejects(a.setItem('last', '最终'));
    await assert.rejects(f.app.retryPending()); assert.equal(f.app.getStatus().state, 'error');
    offline = false; const flight = f.app.retryPending(); const editing = a.setItem('during', '重试中编辑');
    // 错误期间调用可立即拒绝，但其不可变编辑仍须保留在队列并在本次恢复中提交。
    await editing.catch(() => {}); await flight; await f.app.flush();
    assert.deepEqual(await a.keys(), ['last', 'during']);
    assert.equal(await a.getItem('last'), '最终'); assert.equal(await a.getItem('during'), '重试中编辑');
  } finally { f.close(); }
});

test('并发根冲突不覆盖；相同内容块创建竞争可复用，假ACK不当成功', async () => {
  const f = fixture();
  try {
    const other = createShardedApplicationStorage({ client: f.client }), a = instance(f.app), b = instance(other);
    assert.equal(await a.getItem('x'), null); assert.equal(await b.getItem('x'), null);
    await a.setItem('x', 'A'); await assert.rejects(b.setItem('x', 'B'), code('revision_conflict'));
    assert.equal(f.rootDocument().revision, 1);
    const fresh = createShardedApplicationStorage({ client: f.client }); assert.equal(await instance(fresh).getItem('x'), 'A'); fresh.close();
    let raced = false;
    const race = fixture({ write(input, workspace) { if (!raced && input.id.startsWith('app-part-')) { raced = true; workspace.writeDocument({ ...input, operationId: crypto.randomUUID() }); } return workspace.writeDocument(input); } });
    try { await instance(race.app).setItem('x', '相同块'); await race.app.flush(); assert.equal(await instance(race.app).getItem('x'), '相同块'); }
    finally { race.close(); }
    const invalid = fixture({ write() { return { persisted: true }; } });
    try { await assert.rejects(instance(invalid.app).setItem('x', '不能假报'), code('invalid_ack')); assert.equal(invalid.rootDocument(), null); }
    finally { invalid.close(); }
  } finally { f.close(); }
});

test('v1读取不改写；明确编辑才发布v2，旧只读兼容器对v2失败而非空库', async () => {
  const f = fixture();
  try {
    const legacy = createApplicationStorage({ client: f.client }); await instance(legacy).setItem('old', { unknown: [1, 2] }); await legacy.flush(); legacy.close();
    const before = f.rootDocument(), count = f.writes.length;
    assert.deepEqual(await instance(f.app).getItem('old'), { unknown: [1, 2] }); assert.equal(f.writes.length, count); assert.deepEqual(f.rootDocument(), before);
    await instance(f.app).setItem('new', '新内容'); await f.app.flush(); assert.equal(f.rootDocument().revision, 2);
    const oldReader = createApplicationStorage({ client: f.client }); await assert.rejects(instance(oldReader).getItem('old'), code('invalid_namespace'));
    assert.deepEqual(await instance(f.app).getItem('old'), { unknown: [1, 2] });
  } finally { f.close(); }
});

test('媒体、临时URL、Date、特殊键和多个namespace保持；删除不清理共享媒体或旧块', async () => {
  const f = fixture({ readBlobUrl: async () => new Blob(['临时合成图'], { type: 'image/png' }) });
  try {
    const a = instance(f.app, 'image_files'), b = instance(f.app, 'media_files');
    const value = { blob: new Blob(['共享图'], { type: 'image/png' }), url: 'blob:synthetic-only', date: new Date('2026-01-01T00:00:00Z'), nested: JSON.parse('{"__proto__":{"safe":true},"future":42}') };
    await a.setItem('image:one', value); await b.setItem('shared', value.blob); await f.app.flush();
    const media = readdirSync(join(f.root, '媒体')); await a.removeItem('image:one'); await a.clear();
    assert.equal(await a.length(), 0); assert.deepEqual(readdirSync(join(f.root, '媒体')), media);
    const reopened = createShardedApplicationStorage({ client: f.client });
    assert.equal(await (await instance(reopened, 'media_files').getItem('shared')).text(), '共享图'); reopened.close();
    await a.setItem('image:one', value); const restored = await a.getItem('image:one');
    assert.equal(await restored.blob.text(), '共享图'); assert.equal(await (await fetch(restored.url)).text(), '临时合成图');
    assert.equal(restored.date.toISOString(), value.date.toISOString()); assert.equal(Object.hasOwn(restored.nested, '__proto__'), true); assert.equal({}.safe, undefined); assert.equal(restored.nested.future, 42);
    assert.equal(JSON.stringify(f.writes).includes('blob:synthetic-only'), false);
  } finally { f.close(); }
});

test('凭据缺端口仍拒绝、模拟凭据仅存引用、容量及循环错误不发布根', async () => {
  const f = fixture();
  try {
    await assert.rejects(instance(f.app).setItem('infinite-canvas:ai_config_store', JSON.stringify({ state: { apiKey: 'synthetic-secret-not-real' }, version: 0 })), code('secret_port_required'));
    assert.equal(f.rootDocument(), null); assert.equal(f.writes.length, 0);
    const ref = 'secret:' + 'a'.repeat(64), secretPort = { store: async () => ref, inspect: async () => 'guan-vault:' + ref };
    const safe = createShardedApplicationStorage({ client: f.client, secretPort });
    await instance(safe).setItem('infinite-canvas:ai_config_store', JSON.stringify({ state: { apiKey: 'synthetic-secret-not-real' }, version: 0 })); await safe.flush();
    assert.equal(JSON.stringify(f.writes).includes('synthetic-secret-not-real'), false);
    const reader = createShardedApplicationStorage({ client: f.client }); await assert.rejects(instance(reader).getItem('infinite-canvas:ai_config_store'), code('secret_port_required'));
    const capped = fixture();
    try {
      await instance(capped.app).setItem('baseline', '旧快照'); await capped.app.flush(); const before = capped.rootDocument(), count = capped.writes.length;
      await assert.rejects(instance(capped.app).setItem('too-large', 'x'.repeat(MAX_LOGICAL_BYTES)), code('logical_value_too_large'));
      assert.equal(capped.writes.length, count); assert.deepEqual(capped.rootDocument(), before);
    } finally { capped.close(); }
    const circle = {}; circle.self = circle;
    await assert.rejects(instance(createShardedApplicationStorage({ client: f.client })).setItem('cycle', circle), code('invalid_value'));
    assert.throws(() => f.app.createInstance({ name: 'other', storeName: 'evil' }), code('namespace_denied'));
  } finally { f.close(); }
});

test('缺块、被改块、未知格式及重复记录在首次读时失败，不写默认空数据', async () => {
  const f = fixture();
  try {
    await instance(f.app).setItem(key, syntheticCanvas(capacityCases[1])); await f.app.flush(); const before = f.writes.length;
    for (const kind of ['missing', 'hash', 'version', 'media']) {
      const client = { ...f.client, async readDocument(collection, id, options) {
        const doc = await f.client.readDocument(collection, id, options);
        if (kind === 'missing' && id.startsWith('app-part-')) return null;
        if (kind === 'hash' && id.startsWith('app-part-')) return { ...doc, value: { ...doc.value, changed: true } };
        if (id === rootId('app_state') && kind === 'version') return { ...doc, value: { ...doc.value, format: 'future-unknown' } };
        if (id === rootId('app_state') && kind === 'media') return { ...doc, mediaIds: ['0'.repeat(64)] };
        return doc;
      } };
      const app = createShardedApplicationStorage({ client });
      await assert.rejects(instance(app).getItem(key)); await assert.rejects(app.flush(), code('save_not_confirmed'));
    }
    assert.equal(f.writes.length, before);
    const plan = await buildFragmentPlan([['duplicate', { tree: ['null'], mediaIds: [] }], ['duplicate', { tree: ['null'], mediaIds: [] }]]);
    const fake = { ...f.client, async readDocument(collection, id) { return id === rootId('app_state') ? { collection, id, revision: 1, mediaIds: [], value: { format: SHARDED_APPLICATION_FORMAT, namespace: 'app_state', entryCount: 2, head: plan.head } } : { collection, id, mediaIds: [], value: plan.fragments.get(id).value }; } };
    await assert.rejects(instance(createShardedApplicationStorage({ client: fake })).getItem(key), code('invalid_namespace'));
  } finally { f.close(); }
});

test('分片解码限制扇出、未知类型和指数引用膨胀，不接受伪造可读数据', async () => {
  const documents = new Map();
  function make(body) {
    const value = { format: FRAGMENT_FORMAT, ...body }, id = 'app-part-' + createHash('sha256').update(JSON.stringify(value)).digest('hex');
    documents.set(id, { collection: 'extension', id, value, mediaIds: [] }); return { id };
  }
  const leaf = make({ kind: 'json', data: ['x'.repeat(8192)] });
  let ref = leaf;
  for (let i = 0; i < 5; i++) ref = make({ kind: 'array', parts: Array.from({ length: 16 }, () => ref) });
  await assert.rejects(readFragmentGraph({ head: ref, readDocument: async (_c, id) => documents.get(id) }), code('fragment_budget_exceeded'));
  const fields = make({ kind: 'json', data: [['x', ['unknown', 1]]] }), duplicate = make({ kind: 'json', data: [['x', ['inline', 1]], ['x', ['inline', 2]]] });
  for (const head of [make({ kind: 'unknown', data: 1 }), make({ kind: 'array', parts: Array.from({ length: 65 }, () => leaf) }), make({ kind: 'text', parts: [leaf] }), make({ kind: 'typed-object', entries: fields }), make({ kind: 'typed-object', entries: duplicate })]) {
    await assert.rejects(readFragmentGraph({ head, readDocument: async (_c, id) => documents.get(id) }), code('fragment_corrupt'));
  }
});

test('真实SQLite备份冷恢复包括全部数据块、删除结果和共享媒体', async () => {
  const f = fixture();
  try {
    const a = instance(f.app), data = syntheticCanvas(capacityCases[3]);
    await a.setItem(key, data); await a.setItem('removed', '删除项'); await a.removeItem('removed');
    await instance(f.app, 'image_files').setItem('image:backup', new Blob(['synthetic-backup'], { type: 'image/png' })); await f.app.flush();
    const backup = await f.workspace.createBackup(), restoreRoot = mkdtempSync(join(tmpdir(), 'guan-shard-restore-')), target = join(restoreRoot, '恢复'); roots.push(restoreRoot);
    restoreBackup({ backupRoot: backup.path, targetRoot: target }); const workspace = openWorkspace({ dataRoot: target });
    try {
      const app = createShardedApplicationStorage({ client: { readDocument: async (...args) => workspace.readDocument(...args), readMedia: async id => { const value = workspace.readMedia(id); return new Blob([value.bytes], { type: value.mime }); } } });
      assert.equal(await instance(app).getItem(key), data); assert.equal(await instance(app).getItem('removed'), null);
      assert.equal(await (await instance(app, 'image_files').getItem('image:backup')).text(), 'synthetic-backup'); app.close();
    } finally { workspace.close(); }
  } finally { f.close(); }
});

test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
