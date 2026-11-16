import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertRemoteReleaseChecks } from './发布远端检查.mjs';

const commit = 'a'.repeat(40);
const run = { id: 123, run_number: 10, run_attempt: 1, head_sha: commit, head_branch: 'master', event: 'push',
  path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success', html_url: 'https://github.com/example/actions/runs/123' };
const job = { name: 'verify', status: 'completed', conclusion: 'success' };
function check(runs = [run], jobs = [job]) {
  return assertRemoteReleaseChecks({ commit, branch: 'master', api: path => path.includes('/jobs?') ? { jobs } : { workflow_runs: structuredClone(runs) } });
}
test('仅接受相同提交分支的成功工作流及全部成功作业', () => {
  assert.equal(check().runId, 123);
  for (const change of [{ head_sha: 'b'.repeat(40) }, { head_branch: 'main' }, { event: 'pull_request' },
    { path: '.github/workflows/other.yml' }, { status: 'queued', conclusion: null },
    { conclusion: 'failure' }, { conclusion: 'cancelled' }]) assert.throws(() => check([{ ...run, ...change }]), /禁止公开/);
  assert.throws(() => check([]), /禁止公开/);
  for (const conclusion of ['failure', 'skipped', 'cancelled', null]) assert.throws(() => check([run], [{ ...job, conclusion }]), /禁止公开/);
  assert.throws(() => check([run], []), /禁止公开/);
});
test('最新重跑失败不能以旧成功记录放行，API读取异常不降级', () => {
  assert.throws(() => check([run, { ...run, run_attempt: 2, conclusion: 'failure' }]), /禁止公开/);
  assert.throws(() => assertRemoteReleaseChecks({ commit, branch: 'master', api() { throw Error('offline'); } }), /offline/);
});
test('发布入口创建草稿前及公开前均执行同提交检查', () => {
  const source = readFileSync(new URL('./发布Web预览版.mjs', import.meta.url), 'utf8');
  assert.equal(source.match(/^\s*checkRemote\(\);/gm).length, 2);
  assert.ok(source.indexOf('checkRemote();') < source.indexOf("'release', 'create'"));
  assert.ok(source.lastIndexOf('checkRemote();') < source.indexOf("'--draft=false'"));
});
