import assert from 'node:assert/strict';
import { WEB_REPOSITORY } from '../扩展功能/客户安装/Web发布协议.mjs';

// 只接受同一构建提交在发布代码分支上的真实工作流结果，不以本机检查代替。
export function assertRemoteReleaseChecks({ commit, branch, api }) {
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.ok(['master', 'main'].includes(branch));
  const response = api(`repos/${WEB_REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${commit}&branch=${branch}&per_page=100`);
  const runs = response?.workflow_runs?.filter(run => run.head_sha === commit && run.head_branch === branch
    && ['push', 'workflow_dispatch'].includes(run.event) && run.path === '.github/workflows/ci.yml');
  const latest = runs?.sort((a, b) => b.run_number - a.run_number || b.run_attempt - a.run_attempt)[0];
  if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success')
    throw new Error(`远端源码检查未通过，禁止公开：${latest ? `${latest.status}/${latest.conclusion || '未结束'}` : '目标提交没有检查记录'}。`);
  const jobs = api(`repos/${WEB_REPOSITORY}/actions/runs/${latest.id}/attempts/${latest.run_attempt}/jobs?per_page=100`);
  if (!jobs?.jobs?.length || jobs.jobs.some(job => job.status !== 'completed' || job.conclusion !== 'success'))
    throw new Error('远端源码检查存在未通过或跳过的作业，禁止公开。');
  return { commit, branch, runId: latest.id, attempt: latest.run_attempt, url: latest.html_url };
}
