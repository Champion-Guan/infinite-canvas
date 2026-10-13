import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from '../src/canvas/node_modules/typescript/lib/typescript.js';

function load(relative, globals = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/^import .*;$/gm, '').replace(/export /g, '');
  const context = vm.createContext(globals);
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context;
}
test('release parser preserves upstream entries and bundles Chinese stable notes offline', () => {
  const { parseChangelog } = load('../src/canvas/lib/release.ts');
  const upstream = parseChangelog('## 0.20.0 - 2026-10-13\n+ [Fixed] Original author fix');
  assert.equal(upstream[0].version, '0.20.0');
  assert.equal(upstream[0].date, '2026-10-13');
  assert.equal(upstream[0].items[0].type, 'Fixed');
  const notes = readFileSync(new URL('../docs/RELEASE-NOTES.md', import.meta.url), 'utf8');
  const local = parseChangelog(notes);
  assert.equal(local[0].version, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  assert.equal(local[0].date, notes.match(/^## \d+\.\d+\.\d+ — (\d{4}-\d{2}-\d{2})$/m)[1]);
  assert.ok(local.find(entry => entry.version === '1.0.18').items.some(item => item.content.includes('快捷键')));
});

function actions(overrides = {}, fail = '') {
  const calls = [], confirmations = [];
  const status = { hasNewVersion: true, latest: { version: '1.1.0' }, preferences: { autoInstall: false }, download: { state: 'verified' }, install: { state: 'staged' }, ...overrides };
  const context = load('../src/canvas/hooks/use-software-update-actions.ts', {
    useState: () => [false, () => {}], useEffect: () => {},
    App: { useApp: () => ({ message: { success() {}, error() {} }, modal: { confirm: input => confirmations.push(input) } }) },
    updateRequest: async (operation, input) => { calls.push({ operation, input }); if (operation === fail) throw Error('fixture failure'); },
    window: { open: () => fail === 'popup' ? null : { document: { body: {} }, close() {} } },
    openUpdateProgressWindow: async () => { calls.push({ operation: 'progress-window' }); if (fail === 'progress-window') throw Error('fixture failure'); },
  });
  return { actions: context.useSoftwareUpdateActions(status, async () => calls.push({ operation: 'refresh' })), calls, confirmations };
}
test('canceling confirmation does not change preferences or approve installation', () => {
  const fixture = actions(); fixture.actions.approve();
  assert.equal(fixture.confirmations.length, 1);
  assert.match(fixture.confirmations[0].content, /页面保持打开时不会安装/);
  assert.equal(fixture.calls.length, 0);
});
test('explicit install confirmation enables safe installation then sends fixed acknowledgement', async () => {
  const fixture = actions(); fixture.actions.approve(); await fixture.confirmations[0].onOk();
  assert.deepEqual(fixture.calls.map(c => c.operation), ['progress-window', 'preferences', 'approve', 'refresh']);
  assert.equal(fixture.calls[1].input.autoInstall, true);
  assert.equal(fixture.calls[2].input.acknowledgement, 'saved-and-all-tasks-ended');
});
test('unverified downloads and unavailable or recovery-required managers cannot approve', () => {
  for (const overrides of [{ download: { state: 'downloading' } }, { install: { state: 'disabled' } }, { install: { state: 'unavailable' } }, { install: { state: 'recovery-required' } }, { install: { state: 'staged', staging: true } }, { hasNewVersion: false }]) {
    const fixture = actions(overrides); fixture.actions.approve(); assert.equal(fixture.confirmations.length, 0); assert.equal(fixture.calls.length, 0);
  }
});
test('preference failure prevents approve; existing preference does not need an extra write', async () => {
  const failure = actions({}, 'preferences'); failure.actions.approve();
  await assert.rejects(failure.confirmations[0].onOk(), /fixture failure/);
  assert.deepEqual(failure.calls.map(c => c.operation), ['progress-window', 'preferences', 'refresh']);
  const existing = actions({ preferences: { autoInstall: true } }); existing.actions.approve(); await existing.confirmations[0].onOk();
  assert.deepEqual(existing.calls.map(c => c.operation), ['progress-window', 'approve', 'refresh']);
});
test('blocked popup or failed progress service never approves installation', async () => {
  for (const fail of ['popup', 'progress-window']) {
    const fixture = actions({}, fail); fixture.actions.approve();
    await assert.rejects(fixture.confirmations[0].onOk());
    assert.ok(!fixture.calls.some(c => ['preferences', 'approve'].includes(c.operation)));
  }
});
