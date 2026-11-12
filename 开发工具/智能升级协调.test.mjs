import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdleUpgradeCoordinator } from '../扩展功能/软件更新/智能升级协调.mjs';
import { SoftwareUpdates } from '../扩展功能/软件更新/software-updates.mjs';
import { WEB_REPOSITORY } from '../扩展功能/客户安装/Web发布协议.mjs';
import { UpdateError } from '../扩展功能/软件更新/update-auth.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { assembleSoftwareUpdates } from '../扩展功能/软件更新/更新服务装配.mjs';

const version = '2.0.0-beta.22';
const report = (extra = {}) => ({ idle: true, ready: true, prepared: false, error: false, version: null, ...extra });
function fixture({ autoInstall = true, pageIds = ['one'], running = 0, unpersistedResults = 0, retryFails = false } = {}) {
  let time = 1000, staged = false, approved = false, stageFails = false;
  const calls = [], tasks = { running, unpersistedResults }, pages = [...pageIds];
  const preferences = { autoInstall };
  const updates = {
    stageResult: null,
    preferences: async () => preferences,
    status: async () => ({ currentVersion: '2.0.0-beta.21', preferences,
      download: { state: 'verified', version }, install: { allowed: true, state: approved ? 'awaiting-browser-exit' : staged ? 'staged' : 'idle',
        canApprove: staged, targetVersion: staged ? version : null, stageError: updates.stageResult?.error } }),
    async stage() { calls.push('stage'); if (stageFails) throw new UpdateError('update_stage_failed'); staged = true; },
    async approve(ack, options) { assert.equal(ack, 'saved-and-all-tasks-ended'); calls.push(['approve', options]); approved = true; },
    async defer() { calls.push('defer'); approved = false; }
  };
  const generation = { getStatus: () => tasks,
    async assertCanUpdate() { if (tasks.running || tasks.unpersistedResults) throw new UpdateError('generation_busy'); },
    async retryResultSaveBatch() { calls.push('retry-save'); if (!retryFails) tasks.unpersistedResults = 0; return { failures: retryFails ? [{}] : [] }; } };
  const coordinator = createIdleUpgradeCoordinator({ updates, pages: () => pages, generation, now: () => time });
  return { coordinator, calls, tasks, pages, preferences, updates, generation, stageFail: () => { stageFails = true; },
    advance: ms => { time += ms; } };
}
test('开启自动安装后后台暂存，所有页面空闲且保存回执齐全才批准', async () => {
  const f = fixture({ pageIds: ['one', 'two'] });
  await f.coordinator.tick(); assert.deepEqual(f.calls, ['stage']);
  await f.coordinator.activity('one', report());
  assert.equal(f.coordinator.status().reason, 'upgrade_waiting_pages');
  await f.coordinator.activity('two', report({ idle: false }));
  assert.equal(f.coordinator.status().reason, 'upgrade_waiting_idle');
  await f.coordinator.activity('two', report());
  assert.equal(f.coordinator.status().state, 'preparing');
  await f.coordinator.activity('one', report({ prepared: true, version }));
  assert.equal(f.calls.length, 1);
  await f.coordinator.activity('two', report({ prepared: true, version }));
  assert.deepEqual(f.calls.at(-1), ['approve', { manual: false }]);
});
test('自动安装关闭时不暂存、不批准；手动一次请求自动等待生成和保存', async () => {
  const f = fixture({ autoInstall: false, running: 2 });
  await f.coordinator.tick(); assert.deepEqual(f.calls, []);
  await f.coordinator.install(); assert.deepEqual(f.calls, ['stage']);
  await f.coordinator.activity('one', report({ idle: false }));
  assert.equal(f.coordinator.status().reason, 'upgrade_waiting_tasks');
  f.tasks.running = 0;
  await f.coordinator.activity('one', report({ idle: false }));
  assert.equal(f.coordinator.status().state, 'preparing');
  await f.coordinator.activity('one', report({ idle: false, prepared: true, version }));
  assert.deepEqual(f.calls.at(-1), ['approve', { manual: true }]);
});
test('瞬时未落盘结果只重试原保存，失败阻止安装且不循环重试', async () => {
  for (const retryFails of [false, true]) {
    const f = fixture({ unpersistedResults: 1, retryFails });
    await f.coordinator.tick();
    await f.coordinator.activity('one', report());
    assert.equal(f.calls.filter(value => value === 'retry-save').length, 1);
    await f.coordinator.tick();
    if (retryFails) {
      assert.equal(f.coordinator.status().reason, 'upgrade_save_failed');
      assert.equal(f.calls.filter(value => value === 'retry-save').length, 1);
      assert.equal(f.calls.some(Array.isArray), false);
    } else assert.equal(f.coordinator.status().state, 'preparing');
  }
});
test('新页面、过期报告、旧版本回执和未完成操作均不能冒充准备完成', async () => {
  const f = fixture();
  await f.coordinator.tick();
  await f.coordinator.activity('one', report({ ready: false }));
  assert.equal(f.coordinator.status().reason, 'upgrade_waiting_activity');
  await f.coordinator.activity('one', report({ prepared: true, version: '2.0.0-beta.20' }));
  assert.equal(f.calls.some(Array.isArray), false);
  f.pages.push('two'); await f.coordinator.tick();
  assert.equal(f.coordinator.status().reason, 'upgrade_waiting_pages');
  f.pages.pop();
  f.advance(76_000); await f.coordinator.tick();
  assert.equal(f.coordinator.status().reason, 'upgrade_waiting_pages');
  await assert.rejects(f.coordinator.activity('outsider', report()), { code: 'invalid_request' });
});
test('保存失败释放其他页面，取消后不自动重新安装同版本', async () => {
  const f = fixture();
  await f.coordinator.tick(); await f.coordinator.activity('one', report());
  await f.coordinator.activity('one', report({ error: true, version }));
  assert.equal(f.coordinator.status().state, 'blocked');
  await f.coordinator.tick(); assert.equal(f.calls.some(Array.isArray), false);
  await f.coordinator.defer(); await f.coordinator.activity('one', report());
  assert.equal(f.coordinator.status().state, 'idle');
  assert.equal(f.calls.some(Array.isArray), false);
  await f.coordinator.install(); assert.equal(f.coordinator.status().state, 'preparing');
});
test('暂存失败停止流程，不弹确认也不批准；可以明确重试', async () => {
  const f = fixture(); f.stageFail();
  await f.coordinator.install();
  assert.equal(f.coordinator.status().reason, 'update_stage_failed');
  await f.coordinator.tick();
  assert.deepEqual(f.calls, ['stage']);
});
test('取消与最终核实竞态不会在取消后批准安装', async () => {
  const f = fixture(); await f.coordinator.tick(); await f.coordinator.activity('one', report());
  let release;
  let entered;
  const reached = new Promise(resolve => { entered = resolve; });
  f.generation.assertCanUpdate = async () => { entered(); await new Promise(resolve => { release = resolve; }); };
  const pending = f.coordinator.activity('one', report({ prepared: true, version }));
  await reached;
  const cancelled = f.coordinator.defer();
  release(); await Promise.all([pending, cancelled]);
  assert.equal(f.calls.some(Array.isArray), false);
});
test('真实异步暂存未完成或异步失败时都不会批准安装', async () => {
  for (const fail of [false, true]) {
    let finish, phase = 'idle', approvals = 0;
    const identity = { repository: WEB_REPOSITORY, version, downloadId: 'test' };
    const updates = new SoftwareUpdates({ directory: '/unused-in-memory-upgrade-test', currentVersion: '2.0.0-beta.21', auth: {},
      downloader: { status: () => ({ state: 'verified', version }), stageIdentity: () => identity },
      manager: { status: async () => ({ allowed: true, state: phase, canApprove: phase === 'staged' }),
        stage: () => new Promise((resolve, reject) => { finish = () => { if (fail) reject(new UpdateError('update_stage_failed')); else { phase = 'staged'; resolve(); } }; }),
        stagedIdentity: async () => identity, approve: async () => { approvals++; } } });
    updates.preferences = async () => ({ repository: WEB_REPOSITORY, autoInstall: true, developerMode: true });
    updates.history = async () => [];
    const c = createIdleUpgradeCoordinator({ updates });
    await c.tick(); assert.equal(c.status().state, 'staging');
    await c.tick(); assert.equal(approvals, 0);
    const job = updates.staging; finish(); await job; await c.tick();
    assert.equal(approvals, fail ? 0 : 1);
    if (fail) assert.equal(c.status().reason, 'update_stage_failed');
  }
});
test('真实HTTP操作到协调服务：授权页面保存齐全后安装，拒绝伪造页面报告', async () => {
  const directory = await mkdtemp(join(tmpdir(), '智能升级HTTP-'));
  let service, approvals = 0, approved = false;
  try {
    const identity = { repository: WEB_REPOSITORY, version, downloadId: 'test' };
    service = assembleSoftwareUpdates({ dataRoot: directory, origin: 'http://localhost:3001', currentVersion: '2.0.0-beta.21',
      authorize: async () => 'one', updatePages: () => ['one'], networkProxy: { getStatus: () => ({ enabled: false }) },
      generation: { getStatus: () => ({ running: 0, unpersistedResults: 0 }), assertCanUpdate: async () => {},
        updateBlockers: async () => [], taskSummary: async () => ({ failedWithoutResult: 0 }) },
      manager: { status: async () => ({ allowed: true, state: approved ? 'awaiting-browser-exit' : 'staged', canApprove: !approved, targetVersion: version }),
        stagedIdentity: async () => identity, approve: async () => { approvals++; approved = true; } } });
    async function request(input) {
      const req = new PassThrough();
      Object.assign(req, { url: '/__guan-local/software-updates', method: 'POST', headers: { host: 'localhost:3001', origin: 'http://localhost:3001',
        'content-type': 'application/json', 'x-guan-local-protocol': 'guan-local-authorization.v1' } });
      let code, body;
      const res = { writeHead(value) { code = value; }, end(value) { body = JSON.parse(value); } };
      req.end(JSON.stringify(input)); await service.handle(req, res);
      return { code, body };
    }
    assert.equal((await request({ operation: 'preferences', preferences: { developerMode: true, autoInstall: false } })).code, 200);
    assert.equal((await request({ operation: 'install' })).body.result.install.coordination.reason, 'upgrade_waiting_pages');
    assert.equal(approvals, 0);
    assert.equal((await request({ operation: 'activity', activity: { ...report(), pageId: 'forged' } })).code, 409);
    assert.equal((await request({ operation: 'activity', activity: report() })).body.result.install.coordination.state, 'preparing');
    const result = await request({ operation: 'activity', activity: report({ prepared: true, version }) });
    assert.equal(result.code, 200); assert.equal(result.body.result.install.state, 'awaiting-browser-exit');
    assert.equal(approvals, 1); assert.equal(result.body.result.preferences.autoInstall, false);
  } finally { await service?.close(); await rm(directory, { recursive: true, force: true }); }
});
