import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { UpdateOriginTransaction } from '../src/server/update-origin-transaction.mjs';

const next = { id: '1.0.24-' + 'a'.repeat(12) + '-test', version: '1.0.24', commit: 'a'.repeat(40), buildId: 'b'.repeat(24) };
async function setup(t, failure) {
  const root = await mkdtemp(path.join(tmpdir(), 'guan-origin-transaction-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [], phases = []; let closed = true;
  const adapter = Object.fromEntries(['verify', 'assertClosed', 'backup', 'copyAndVerify', 'verifyBackup', 'switchService', 'health', 'rollback']
    .map(name => [name, async () => {
      calls.push(name);
      if (name === 'assertClosed' && !closed || name === failure) throw Error('synthetic failure');
      return name === 'backup' ? { privateBackup: true } : name === 'copyAndVerify' ? { verified: true } : undefined;
    }]));
  const transaction = new UpdateOriginTransaction({ file: path.join(root, 'migration.json'), adapter,
    onStep: async value => { phases.push(value.phase); if (failure === 'late-page' && value.phase === 'browser-verified') closed = false; } });
  const lease = { async assertValid() { calls.push('grant'); } };
  return { transaction, calls, phases, lease, adapter };
}

test('online migration cannot switch before backups, independent browser verification and repeated closure checks', async t => {
  const { transaction, calls, phases, lease } = await setup(t);
  assert.equal((await transaction.run({ source: 'http://localhost:8888', next, lease })).state, 'committed');
  assert.deepEqual(phases, ['prepared', 'backing-up', 'copying', 'browser-verified', 'switching', 'health-check', 'committed']);
  assert.ok(calls.indexOf('switchService') > calls.indexOf('verifyBackup'));
  assert.equal(calls.filter(x => x === 'verify').length, 2);
  await assert.rejects(transaction.run({ source: 'http://localhost:8888', next, lease }), /already_committed/);
});

for (const failure of ['backup', 'copyAndVerify', 'verifyBackup', 'late-page'])
  test('preserves unfinished migration and blocks automatic replay: ' + failure, async t => {
    const { transaction, calls, lease } = await setup(t, failure);
    await assert.rejects(transaction.run({ source: 'http://127.0.0.1:8888', next, lease }), failure === 'late-page' ? /recovery_required/ : /safely_stopped/);
    assert.ok(!calls.includes('switchService'));
    assert.equal((await transaction.read()).phase, 'recovery-required');
    await assert.rejects(transaction.run({ source: 'http://localhost:8888', next, lease }), /recovery_required/);
  });

test('switch/health failure restores startup metadata only; failed rollback remains durable', async t => {
  const { transaction, calls, lease } = await setup(t, 'health');
  await assert.rejects(transaction.run({ source: 'http://localhost:8888', next, lease }), /failed_rolled_back/);
  assert.equal((await transaction.read()).phase, 'rolled-back'); assert.ok(calls.includes('rollback'));
  transaction.adapter.rollback = async () => { throw Error('synthetic rollback failure'); };
  await assert.rejects(transaction.run({ source: 'http://localhost:8888', next, lease }), /recovery_required/);
  assert.equal((await transaction.read()).phase, 'recovery-required');
});

test('expired grants and open pages stop before a backup; presentation errors cannot undo success', async t => {
  const { transaction, calls, lease } = await setup(t);
  await assert.rejects(transaction.run({ source: 'http://localhost:8888', next, lease: { assertValid: async () => { throw Error('expired'); } } }), /expired/);
  assert.ok(!calls.includes('backup'));
  transaction.onStep = async () => { throw Error('UI disconnected'); };
  assert.equal((await transaction.run({ source: 'http://localhost:8888', next, lease })).state, 'committed');
});

test('cold recovery requires a new grant and never replays a partially written browser copy', async t => {
  const { transaction, calls, lease } = await setup(t, 'copyAndVerify');
  await assert.rejects(transaction.run({ source: 'http://localhost:8888', next, lease }));
  const copies = calls.filter(x => x === 'copyAndVerify').length;
  await assert.rejects(transaction.recover({ lease: { assertValid: async () => { throw Error('expired'); } } }), /expired/);
  assert.equal((await transaction.recover({ lease })).state, 'rolled-back');
  assert.equal(calls.filter(x => x === 'copyAndVerify').length, copies);
});
