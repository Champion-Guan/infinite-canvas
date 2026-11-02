import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { webInstallPaths, readState, versionPath } from './Web安装目录.mjs';
import { ownedProcess } from './管理进程身份.mjs';
import { restoreWebStage } from './Web暂存恢复.mjs';
import { saveInstallConfirmation } from './本次安装确认.mjs';
import { startCommittedManager, waitManagerRelease } from './管理器版本接续.mjs';
import { readDetachedProgress } from './独立更新观察.mjs';
import { dailyWorkbenchPaths } from '../本机服务/日常数据根.mjs';
import { requireSavedUpdateChannel } from '../软件更新/更新发布渠道.mjs';
import { WEB_APP, fail } from './Web发布协议.mjs';

const exec = promisify(execFile);
const browserNames = [
  ['Chrome', /\/(?:Google Chrome(?: Canary| Beta| Dev)?|Chromium)\.app\/Contents\/MacOS\/(?:Google Chrome(?: Canary| Beta| Dev)?|Chromium)$/],
  ['Safari', /\/Safari(?: Technology Preview)?\.app\/Contents\/MacOS\/Safari(?: Technology Preview)?$/],
  ['Edge', /\/Microsoft Edge(?: Beta| Dev| Canary)?\.app\/Contents\/MacOS\/Microsoft Edge(?: Beta| Dev| Canary)?$/],
  ['Firefox', /\/Firefox(?: Developer Edition| Nightly)?\.app\/Contents\/MacOS\/firefox$/i],
  ['Brave', /\/Brave Browser(?: Beta| Nightly)?\.app\/Contents\/MacOS\/Brave Browser(?: Beta| Nightly)?$/],
  ['Arc', /\/Arc\.app\/Contents\/MacOS\/Arc$/],
];
export function runningRecoveryBrowsers(processes) {
  return browserNames.filter(([, pattern]) => processes.split('\n').some(line => pattern.test(line.trim()))).map(([name]) => name);
}

// 仅由客户主动双击恢复入口调用。先退出浏览器，再正常排空旧服务，沿用原暂存事务。
// 不向旧网关注入能力、不改签名包、不删除锁，也不以等待时长代替保存确认。
export async function recoverWaitingUpgrade(paths = webInstallPaths(), options = {}) {
  const runtime = {
    processes: async () => (await exec('/bin/ps', ['-axo', 'comm='], { timeout: 5000, maxBuffer: 1024 ** 2 })).stdout,
    owns: ownedProcess,
    stage: (state) => restoreWebStage(paths, state.workspaceId, state.current),
    channel: version => requireSavedUpdateChannel(join(dailyWorkbenchPaths().dataRoot, 'software-updates'), version),
    signal: owner => process.kill(owner.pid, 'SIGTERM'),
    released: owner => waitManagerRelease(paths, owner, { timeout: 45_000 }),
    start: current => startCommittedManager(paths, current),
    progress: version => readDetachedProgress(paths, version),
    pause: () => new Promise(resolve => setTimeout(resolve, 500)),
    now: Date.now, timeout: 180_000, report: () => {},
    ...options,
  };
  const noBrowsers = async () => {
    const browsers = runningRecoveryBrowsers(await runtime.processes());
    if (browsers.length) throw Object.assign(Error('请先保存所有工作台，再完全退出 ' + browsers.join('、') + '（Command+Q），然后重新双击恢复入口。'), { code: 'update_recovery_browsers_open' });
  };
  await noBrowsers();
  const initial = await readState(paths.state);
  if (initial?.app !== WEB_APP || !['committed', 'rolled-back'].includes(initial.phase) || !initial.workspaceId) fail('update_recovery_required');
  const staged = await runtime.stage(initial);
  if (!staged) fail('update_stage_unavailable');
  await runtime.channel(staged.next.version);
  const unchanged = async () => {
    if (JSON.stringify(await readState(paths.state)) !== JSON.stringify(initial)) fail('update_recovery_required');
    const restored = await runtime.stage(initial);
    if (JSON.stringify(restored) !== JSON.stringify(staged)) fail('update_stage_invalid');
    await runtime.channel(staged.next.version);
  };
  const owner = await readState(paths.lock);
  if (owner) {
    const command = versionPath(paths, initial.current) + '/扩展功能/客户安装/Web客户命令.mjs supervisor';
    if (!runtime.owns(owner) || !owner.command?.endsWith(command)) fail('web_process_unowned');
    await unchanged(); await noBrowsers();
    if (!runtime.owns(owner) || JSON.stringify(await readState(paths.lock)) !== JSON.stringify(owner)) fail('web_process_unowned');
    runtime.report('正在正常停止旧版服务，等待任务和保存排空…');
    await runtime.signal(owner);
    await runtime.released(owner);
  }
  await noBrowsers(); await unchanged();
  if (await readState(paths.lock)) fail('web_service_running');
  // 恢复入口是本次安装的新请求；期限已过也只确认同一工作区、同一份已验签暂存。
  await saveInstallConfirmation(paths, initial.workspaceId, initial.current, staged);
  runtime.report('正在继续安装 ' + staged.next.version + '，请暂时保持浏览器退出…');
  await runtime.start(initial.current);
  const deadline = runtime.now() + runtime.timeout;
  while (runtime.now() < deadline) {
    const progress = await runtime.progress(staged.next.version);
    if (progress.state === 'success') {
      return { version: staged.next.version, address: progress.origin, recovered: true };
    }
    if (['rolled-back', 'recovery-required', 'blocked', 'deferred'].includes(progress.state)) fail(progress.reason || 'update_activation_unconfirmed');
    await runtime.pause();
  }
  fail('update_resume_timeout');
}
