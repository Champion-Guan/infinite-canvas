import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { ts } from './检查首批功能适配.mjs';
import * as ownership from '../扩展功能/本机存储/回收站归属.mjs';

function fixture() {
  let time = Date.parse('2026-11-11T12:00:00Z'), callback, storageState = 'saved', visible = 'visible';
  const old = '2026-07-01T12:00:00Z', young = '2026-11-01T12:00:00Z', calls = [], removed = [], events = new Map();
  let canvas = { hydrated: true, projects: [{ id: 'live' }], deletedProjects: [
    { id: 'old', deletedAt: old }, { id: 'young', deletedAt: young }, { id: 'busy', deletedAt: old },
  ], guanWorkbooks: { recycledWorkbooks: [{ id: 'book', deletedAt: old, projects: [{ id: 'nested' }] }] } };
  const assets = { hydrated: true, assets: [] };
  const state = { policy: { enabled: true, days: 90 }, lastAutomaticAt: null, lastRun: null, running: false,
    generationRunning: 0, protectedOwners: ['busy', 'nested'] };
  const window = { __guanSQLiteHost: { async storageMaintenance(input) {
    calls.push(input);
    if (input.operation === 'status') return { ...state };
    if (input.operation === 'preview') return { id: 'plan', mode: input.mode, expiresAt: time + 600_000, bytes: 1024,
      fragmentBytes: 512, mediaBytes: 256, taskBytes: 256, fragments: 2, media: 1, tasks: 3, waiting: 4, protectedTasks: 2,
      retentionDays: state.policy.days, protectedOwners: state.protectedOwners };
    if (input.operation === 'execute') return { completedAt: time, automatic: true, bytes: 1024, fragments: 2, media: 1, tasks: 3 };
    if (input.operation === 'configure') { state.policy = input.policy; return { ...state }; }
    throw Error('unexpected command');
  } }, setInterval(fn) { callback = fn; return 1; }, clearInterval() { callback = null; } };
  const context = vm.createContext({ exports: {}, window, Date: class extends Date { static now() { return time; } },
    document: { get visibilityState() { return visible; }, addEventListener(name, fn) { events.set(name, fn); }, removeEventListener(name) { events.delete(name); } },
    require(name) {
      const modules = {
        '@/stores/canvas/use-canvas-store': { useCanvasStore: { getState: () => canvas } },
        '@/stores/use-asset-store': { useAssetStore: { getState: () => assets } },
        '../本机存储/上游浏览器存储桥': { flushSQLiteStorage: async () => {}, storageStatus: () => ({ state: storageState, pending: 0 }) },
        './回收站存储操作': { pendingRecycleCleanup: async () => null, clearRecycleStorage: async (kind, targets) => { removed.push({ kind, targets }); return { removed: targets.length, pending: false }; } },
        '../本机存储/回收站归属.mjs': ownership,
      };
      assert.ok(name in modules, name); return modules[name];
    } });
  vm.runInContext(ts.transpileModule(readFileSync('扩展功能/存储界面/存储整理操作.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, context);
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  return { api: context.exports, state, calls, removed, events, tick: milliseconds => { time += milliseconds; },
    async interval() { callback?.(); await flush(); }, edit() { canvas = { ...canvas, projects: [...canvas.projects, { id: 'new' }] }; },
    saving(value) { storageState = value ? 'saving' : 'saved'; }, visible(value) { visible = value ? 'visible' : 'hidden'; } };
}
test('前端预览只包括超过90天的回收记录，保护新删除内容及有待恢复任务的嵌套产品', async () => {
  const f = fixture(), plan = await f.api.previewStorageCleanup('expired');
  assert.equal(plan.recycled, 1);
  assert.equal(f.removed.length, 0, '预览不删除');
  const result = await f.api.executeStorageCleanup(plan.id);
  assert.equal(result.recycled, 1);
  assert.equal(f.removed[0].kind, 'product_recycle');
  assert.equal(f.removed[0].targets[0], 'old:2026-07-01T12:00:00Z');
});
test('扫描后编辑阻止前后端删除，修改保留策略废弃旧预览', async () => {
  const f = fixture(), plan = await f.api.previewStorageCleanup('organize');
  f.edit();
  await assert.rejects(f.api.executeStorageCleanup(plan.id), /发生变化/);
  assert.equal(f.calls.some(call => call.operation === 'execute'), false);
  const next = await f.api.previewStorageCleanup('expired');
  await f.api.saveRetentionPolicy({ enabled: true, days: 180 });
  await assert.rejects(f.api.executeStorageCleanup(next.id), /预览已过期/);
});
test('自动检查等待打开后空闲；正在保存、隐藏、关闭开关及正在生成均不删除', async () => {
  const f = fixture(), stop = f.api.startAutomaticStorageCleanup();
  await f.interval(); assert.equal(f.calls.length, 0);
  f.tick(60_000); f.saving(true); await f.interval(); assert.equal(f.calls.length, 0);
  f.saving(false); f.visible(false); await f.interval(); assert.equal(f.calls.length, 0);
  f.visible(true); f.state.generationRunning = 1; await f.interval();
  assert.equal(f.calls.some(call => call.operation === 'preview'), false);
  f.state.generationRunning = 0; f.tick(3_600_000); f.state.policy.enabled = false; await f.interval();
  assert.equal(f.calls.some(call => call.operation === 'execute'), false);
  stop(); assert.equal(f.events.size, 0);
});
test('自动检查只清到期内容，当天已完成则等待下一天；用户交互会延后执行', async () => {
  const f = fixture(), stop = f.api.startAutomaticStorageCleanup();
  f.tick(60_000); f.events.get('pointerdown')(); await f.interval();
  assert.equal(f.calls.length, 0);
  f.tick(11_000); await f.interval();
  assert.equal(f.calls.find(call => call.operation === 'preview').mode, 'expired');
  assert.equal(f.calls.find(call => call.operation === 'preview').automatic, true);
  assert.equal(f.removed.length, 1);
  f.state.lastAutomaticAt = Date.parse('2026-11-11T12:01:11Z');
  const before = f.calls.filter(call => call.operation === 'execute').length;
  f.tick(3_600_000); await f.interval();
  assert.equal(f.calls.filter(call => call.operation === 'execute').length, before);
  stop();
});
