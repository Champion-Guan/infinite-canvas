import { spawn } from 'node:child_process';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { webInstallPaths, readState, versionPath, installWebDirectory } from './Web安装目录.mjs';
import { runWebSupervisor, ownedProcess } from './Web安装管理器.mjs';
import { verifySignedWebDirectory } from './Web安装包核验.mjs';
import { WEB_REPOSITORY, WEB_MANIFEST_NAMES, webReleaseAssetName, fail } from './Web发布协议.mjs';
import { readReleaseAsset } from '../软件更新/github-assets.mjs';
import { readWebAddress, waitWebAddress } from './Web运行地址.mjs';
import { acceptsWebRelease } from '../软件更新/更新发布渠道.mjs';
import { ensureDesktopEntry, openWorkbenchAddress } from './客户桌面入口.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url)), paths = webInstallPaths();
async function bootstrapProof() {
  const m = JSON.parse(await readFile(join(root, '工作台发布.json')));
  if (m.repository !== WEB_REPOSITORY || !/^[0-9A-Za-z.+-]+$/.test(m.version)) fail('web_package_invalid');
  // 公共固定仓库、固定标签；不接收网页、参数或环境变量提供的URL/Token/公钥。
  const response = await fetch(`https://api.github.com/repos/${WEB_REPOSITORY}/releases/tags/web-v${m.version}`, {
    redirect: 'error', signal: AbortSignal.timeout(30000), headers: { accept: 'application/vnd.github+json', 'user-agent': 'AI-Workbench-WebInstaller' } });
  if (!response.ok || Number(response.headers.get('content-length')) > 1024 * 1024) fail('web_release_unavailable');
  let size = 0; const chunks = [];
  for await (const bytes of response.body) { size += bytes.length; if (size > 1024 * 1024) fail('web_release_unavailable'); chunks.push(bytes); }
  const release = JSON.parse(Buffer.concat(chunks));
  if (!acceptsWebRelease(release, { developerMode: true }) || release.tag_name !== 'web-v' + m.version || !Array.isArray(release.assets)) fail('web_release_unavailable');
  for (const [index, name] of WEB_MANIFEST_NAMES.entries()) {
    const assets = release.assets.filter(a => a.name === webReleaseAssetName(name) && a.state === 'uploaded');
    if (assets.length !== 1) fail('release_assets_invalid');
    const bytes = await readReleaseAsset({ repository: WEB_REPOSITORY, token: '', asset: assets[0], maxBytes: index === 0 ? 65536 : 64, signal: AbortSignal.timeout(30000) });
    // 覆盖的仅为公共验签证据；包内任意业务文件不在此写入范围。
    await writeFile(join(root, name), bytes, { mode: 0o600 }); await chmod(join(root, name), 0o600);
  }
}
export async function customerCommand(operation) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') fail('architecture_unsupported');
  if (operation === 'install') {
    await bootstrapProof();
    const result = await installWebDirectory(root);
    await ensureDesktopEntry(paths);
    console.log('安装完成。个人数据与旧工作台均已保留。请双击桌面“生图工作台.app”或“启动工作台.command”。');
    return result.identity;
  }
  if (operation === 'prepare-beta17-upgrade') {
    console.log('正在从固定 GitHub 仓库核对 beta.19 签名和包库存。');
    await bootstrapProof();
    console.log('签名材料已核对。');
    const { runBeta17UpgradePreparation } = await import('./旧版升级任务兼容.mjs');
    return runBeta17UpgradePreparation({ packageRoot: root, paths });
  }
  if (operation === 'supervisor') return runWebSupervisor();
  const state = await readState(paths.state), running = await readState(paths.lock);
  if (operation === 'status') return { installed: Boolean(state), running: Boolean(ownedProcess(running)), version: state?.current?.version, phase: state?.phase,
    address: await readWebAddress(paths, running, state, ownedProcess) };
  if (operation === 'start' || operation === 'desktop-start') {
    if (!state?.current) fail('web_install_required');
    await ensureDesktopEntry(paths);
    let result;
    if (running) {
      if (!ownedProcess(running)) fail('update_recovery_required');
      result = await waitWebAddress(paths, ownedProcess);
    } else {
      const packageRoot = versionPath(paths, state.current);
      await verifySignedWebDirectory(packageRoot, { releaseVersion: state.current.version });
      const child = spawn(join(packageRoot, 'runtime/node'), [join(packageRoot, '扩展功能/客户安装/Web客户命令.mjs'), 'supervisor'], {
        cwd: packageRoot, detached: true, stdio: 'ignore', env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' } });
      child.unref();
      result = await waitWebAddress(paths, ownedProcess);
    }
    if (operation === 'desktop-start') { await openWorkbenchAddress(result.address); return { ...result, opened: true }; }
    return result;
  }
  if (operation === 'stop') {
    if (!ownedProcess(running)) fail('web_process_unowned');
    process.kill(running.pid, 'SIGTERM'); return { stopping: true };
  }
  fail('invalid_request');
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) fail('invalid_request');
  try { const result = await customerCommand(process.argv[2]); if (result?.address) console.log('工作台已就绪，请打开：' + result.address); if (result) console.log(JSON.stringify(result)); }
  catch (e) {
    const operation = process.argv[2];
    console.error(operation === 'prepare-beta17-upgrade'
      ? '准备未完成：' + (e.code || 'web_operation_failed') + '。版本指针没有切换；任务状态可能已兼容标记，请勿重新提交这些任务。若工作台未自动恢复，请点击桌面入口。'
      : '操作未完成：' + (e.code || 'web_operation_failed') + '。现有版本与个人数据保留。');
    process.exitCode = 1;
  }
}
