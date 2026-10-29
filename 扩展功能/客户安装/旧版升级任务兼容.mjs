import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openWorkspace } from '../本机存储/SQLite工作区.mjs';
import { prepareDailyDataRoot } from '../本机服务/日常数据根.mjs';
import { createWriteCoordinator } from '../本机服务/写入协调.mjs';
import { noResultTaskFailure } from '../生成任务/无结果任务收口.mjs';
import { validateGenerationLedgerDocument } from '../生成任务/SQLite生成任务.mjs';
import { compareVersions } from '../软件更新/stable-version.mjs';
import { WEB_APP, fail } from './Web发布协议.mjs';
import { verifySignedWebDirectory } from './Web安装包核验.mjs';
import { readState, versionPath, webInstallPaths } from './Web安装目录.mjs';
import { ownedProcess } from './管理进程身份.mjs';
import { startCommittedManager, waitManagerRelease } from './管理器版本接续.mjs';

const LEDGER_ID = 'guan-generation-ledger-v1';
const LEDGER_FORMAT = 'guan-generation-ledger.v1';
const OLD_VERSION = '2.0.0-beta.17';
const RELEASE_VERSION = '2.0.0-beta.19';
const hash = value => createHash('sha256').update(value).digest('hex');

export async function prepareLegacyCompatibleTaskLedger({ workspace, coordinator, now = Date.now } = {}) {
  if (!workspace?.workspaceId || typeof workspace.readDocument !== 'function' || typeof workspace.writeDocument !== 'function' ||
      typeof coordinator?.runWrite !== 'function' || typeof now !== 'function') fail('compatibility_workspace_invalid');
  const document = workspace.readDocument('extension', LEDGER_ID);
  if (!document) return { converted: 0, remainingImageBlockers: 0 };
  const before = validateGenerationLedgerDocument(document, { workspaceId: workspace.workspaceId });
  const jobs = structuredClone(before.jobs);
  let converted = 0;
  for (const job of jobs) {
    if (job.result !== null) continue;
    const failure = noResultTaskFailure(job);
    if (!failure || !['accepted', 'running', 'uncertain', 'cancelled'].includes(job.state)) continue;
    if (job.state === 'cancelled' && job.reason === failure.reason) continue;
    // beta.17 accepts a cancelled no-result row; beta.19 converts this marker to failed on cold start.
    job.state = 'cancelled';
    job.reason = failure.reason;
    job.updatedAt = Math.max(now(), job.updatedAt);
    converted++;
  }
  if (converted) {
    const value = { format: LEDGER_FORMAT, workspaceId: workspace.workspaceId, jobs };
    const operationId = randomUUID(), expectedHash = hash(JSON.stringify(value));
    const request = { collection: 'extension', id: LEDGER_ID, value, expectedRevision: before.revision, operationId, mediaIds: before.mediaIds };
    try {
      const ack = await coordinator.runWrite(() => workspace.writeDocument(request));
      if (ack.persisted !== true || ack.workspaceId !== workspace.workspaceId || ack.collection !== 'extension' ||
          ack.id !== LEDGER_ID || ack.operationId !== operationId || ack.revision !== before.revision + 1 || ack.hash !== expectedHash) fail('compatibility_save_unconfirmed');
    } catch (error) {
      const saved = workspace.readDocument('extension', LEDGER_ID);
      if (saved?.revision !== before.revision + 1 || saved.hash !== expectedHash) throw error;
    }
  }
  const after = validateGenerationLedgerDocument(workspace.readDocument('extension', LEDGER_ID), { workspaceId: workspace.workspaceId });
  const remainingImageBlockers = after.jobs.filter(job => !(['failed', 'cancelled'].includes(job.state) || job.state === 'succeeded' && job.applied)).length;
  if (converted && after.jobs.some(job => {
    const failure = noResultTaskFailure(job);
    return failure && job.result === null && !(['cancelled', 'failed'].includes(job.state));
  })) fail('compatibility_save_unconfirmed');
  return { converted, remainingImageBlockers };
}

function supervisorCommand(root) {
  return join(root, 'runtime/node') + ' ' + join(root, '扩展功能/客户安装/Web客户命令.mjs') + ' supervisor';
}

export async function prepareBeta17Upgrade({ packageRoot, paths = webInstallPaths(), confirm, report = () => {} } = {}) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') fail('architecture_unsupported');
  if (typeof confirm !== 'function') fail('install_operator_confirmation_required');
  const packageInventory = JSON.parse(await readFile(join(packageRoot, '工作台发布.json'), 'utf8'));
  if (packageInventory.version !== RELEASE_VERSION) fail('release_identity_mismatch');
  const target = await verifySignedWebDirectory(packageRoot, { releaseVersion: RELEASE_VERSION });
  const state = await readState(paths.state);
  if (state?.app !== WEB_APP || !['committed', 'rolled-back'].includes(state.phase) ||
      state.current?.version !== OLD_VERSION || !state.workspaceId || compareVersions(RELEASE_VERSION, OLD_VERSION) <= 0)
    fail('compatibility_version_unsupported');
  const currentRoot = versionPath(paths, state.current);
  await verifySignedWebDirectory(currentRoot, { releaseVersion: OLD_VERSION });
  await verifySignedWebDirectory(packageRoot, { releaseVersion: RELEASE_VERSION, currentVersion: state.current.version });
  const owner = await readState(paths.lock);
  if (!owner || !ownedProcess(owner) || owner.command !== supervisorCommand(currentRoot)) fail('web_process_unowned');
  report({ phase: 'verified', currentVersion: state.current.version, releaseVersion: target.inventory.version });
  if (await confirm({ currentVersion: OLD_VERSION, targetVersion: RELEASE_VERSION }) !== true) fail('install_operator_confirmation_required');

  let stopped = false, canRestart = false, restartAttempted = false;
  try {
    report({ phase: 'stopping', currentVersion: state.current.version });
    const retryStop = setInterval(() => {
      if (ownedProcess(owner)) {
        try { process.kill(owner.pid, 'SIGTERM'); } catch { /* 进程可能刚好退出；等待器会重新核验锁和身份。 */ }
      }
    }, 500);
    try { await waitManagerRelease(paths, owner); } finally { clearInterval(retryStop); }
    stopped = true;
    const currentState = await readState(paths.state);
    if (JSON.stringify(currentState) !== JSON.stringify(state) || await readState(paths.lock)) fail('update_state_invalid');

    const dataRoot = prepareDailyDataRoot({ initialize: false });
    let workspace, coordinator, result;
    try {
      report({ phase: 'repairing', currentVersion: state.current.version });
      workspace = openWorkspace({ dataRoot, initialize: false });
      if (workspace.workspaceId !== state.workspaceId) fail('workspace_identity_mismatch');
      coordinator = createWriteCoordinator();
      result = await prepareLegacyCompatibleTaskLedger({ workspace, coordinator });
    } finally {
      try { await coordinator?.close(); } finally { workspace?.close(); canRestart = true; }
    }
    restartAttempted = true;
    report({ phase: 'restarting', currentVersion: state.current.version });
    const running = await startCommittedManager(paths, state.current);
    canRestart = false;
    report({ phase: 'ready', address: running.address, version: state.current.version, converted: result.converted,
      remainingImageBlockers: result.remainingImageBlockers, releaseVersion: target.inventory.version });
    return { ...running, converted: result.converted, remainingImageBlockers: result.remainingImageBlockers, releaseVersion: target.inventory.version };
  } catch (error) {
    if (stopped && canRestart && !restartAttempted) {
      restartAttempted = true;
      try { await startCommittedManager(paths, state.current); } catch { /* 保留原事务和工作区；不启动第二个主管。 */ }
    }
    throw error;
  }
}

export async function runBeta17UpgradePreparation({ packageRoot, paths = webInstallPaths(), input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || !output.isTTY) fail('install_operator_confirmation_required');
  const { createInterface } = await import('node:readline/promises');
  const terminal = createInterface({ input, output });
  try {
    const answer = await terminal.question('请先保存并关闭所有生图工作台页面。确认已保存并关闭后，输入“已保存并关闭”：');
    return await prepareBeta17Upgrade({ packageRoot, paths, confirm: async () => answer.trim() === '已保存并关闭',
      report: value => {
        const messages = {
          verified: `签名包和 beta.17 安装已核对。`,
          stopping: '正在正常关闭 beta.17 主管并等待 SQLite 释放。',
          repairing: '正在将无结果图片任务写入兼容状态；不会重发请求。',
          restarting: '任务账本已核对，正在重新启动 beta.17。',
          ready: `已兼容处理 ${value.converted} 条无结果图片任务，旧版 ${value.version} 已恢复。请回到工作台，在设置的软件更新中安装 ${value.releaseVersion}。`,
        };
        if (messages[value.phase]) output.write(messages[value.phase] + '\n');
      } });
  } finally { terminal.close(); }
}
