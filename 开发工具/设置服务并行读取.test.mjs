import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SoftwareUpdates } from '../扩展功能/软件更新/software-updates.mjs';
import { assembleSoftwareUpdates } from '../扩展功能/软件更新/更新服务装配.mjs';

const gate = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

test('更新偏好读取后，历史和管理器状态同时开始，不被独立慢读取串行阻塞', async () => {
  const directory = await mkdtemp(join(tmpdir(), '设置并行状态-'));
  const history = gate(), manager = gate(), started = [];
  const updates = new SoftwareUpdates({ directory, currentVersion: '2.0.0-beta.29',
    manager: { status: () => { started.push('manager'); return manager.promise; } } });
  updates.preferences = async () => ({ repository: 'Champion-Guan/infinite-canvas', developerMode: false });
  updates.history = () => { started.push('history'); return history.promise; };
  try {
    const pending = updates.status();
    await Promise.resolve();
    assert.deepEqual(started, ['history', 'manager']);
    history.resolve([]); manager.resolve({ allowed: true, state: 'idle' });
    assert.equal((await pending).install.state, 'idle');
  } finally { history.resolve([]); manager.resolve({ allowed: true, state: 'idle' }); updates.stop(); await rm(directory, { recursive: true, force: true }); }
});

test('更新装配同时读取独立任务信息，必须全部完成才发布安装状态，不提交网络检查', async () => {
  const directory = await mkdtemp(join(tmpdir(), '设置服务并行-'));
  const blockers = gate(), summary = gate(), manager = gate(), started = [];
  let checks = 0;
  const service = assembleSoftwareUpdates({
    dataRoot: directory, origin: 'http://localhost:3000', currentVersion: '2.0.0-beta.29',
    authorize: async () => 'test-page', networkProxy: { getStatus: () => { checks++; return { enabled: false }; } },
    manager: { status: () => { started.push('manager'); return manager.promise; } },
    generation: {
      updateBlockers: () => { started.push('blockers'); return blockers.promise; },
      taskSummary: () => { started.push('summary'); return summary.promise; },
    },
  });
  try {
    let finished = false;
    const pending = service.status().then(value => { finished = true; return value; });
    assert.deepEqual(started, ['blockers', 'summary']);
    blockers.resolve([{ id: 'original-task', reason: 'result_save_unconfirmed' }]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false);
    summary.resolve({ failedWithoutResult: 3 }); manager.resolve({ allowed: true, state: 'idle' });
    const status = await pending;
    assert.equal(status.taskSummary.failedWithoutResult, 3);
    assert.equal(status.install.blockers[0].id, 'original-task');
    assert.equal(checks, 0, '只读本机状态不检查外网');
  } finally {
    blockers.resolve([]); summary.resolve({ failedWithoutResult: 0 }); manager.resolve({ allowed: true, state: 'idle' });
    await service.close(); await rm(directory, { recursive: true, force: true });
  }
});
