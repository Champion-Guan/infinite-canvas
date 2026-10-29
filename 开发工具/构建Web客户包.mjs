import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { 装配开发源码 } from './装配开发源码.mjs';
import { inventoryWebFiles } from '../扩展功能/客户安装/Web安装包核验.mjs';
import { WEB_APP, WEB_REPOSITORY, WEB_ORIGIN, packageName, sha256 } from '../扩展功能/客户安装/Web发布协议.mjs';
import { readWebArchive } from '../扩展功能/客户安装/Web压缩包读取.mjs';
import { webSourceSnapshot, assertWebReleaseSource } from './Web发布源码核对.mjs';
import { 执行有界构建命令 } from './有界构建进程.mjs';
import { 占用Web构建目录 } from './Web构建占用保护.mjs';
import { 清理Web构建缓存, 清理Web构建临时依赖, 清理Web失败构建 } from './清理Web构建缓存.mjs';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
export async function buildWebPackage({ root = sourceRoot, runtimeDirectory, upstreamDirectory, commit } = {}) {
  assert.equal(process.platform, 'darwin'); assert.equal(process.arch, 'arm64');
  const release = json(join(root, '开发文档/Web发布版本.json')), baseline = json(join(root, '上游基线.json'));
  assert.equal(release.仓库, WEB_REPOSITORY); assert.equal(release.渠道, 'web-preview');
  assert.match(commit || '', /^[a-f0-9]{40}$/);
  const sourceSHA256 = webSourceSnapshot(root);
  let releaseReady = true;
  try { assertWebReleaseSource(root, commit, sourceSHA256); } catch { releaseReady = false; }
  const outputParent = join(root, '.运行/Web客户包'); mkdirSync(outputParent, { recursive: true, mode: 0o700 });
  const releaseBuild = 占用Web构建目录(outputParent);
  let output;
  try { output = mkdtempSync(join(outputParent, '构建-')); } catch (error) { releaseBuild(); throw error; }
  try {
  const buildEnv = { ...process.env, npm_config_cache: join(output, '构建缓存/npm'), npm_config_update_notifier: 'false', npm_config_logs_max: '0' };
  const source = join(output, '装配来源'), active = join(source, '画布副本');
  mkdirSync(active, { recursive: true, mode: 0o700 });
  if (!upstreamDirectory) {
    upstreamDirectory = resolve(root, baseline.目录);
    if (!existsSync(join(upstreamDirectory, '.git'))) {
      upstreamDirectory = join(root, '.运行/Web作者基线');
      if (!existsSync(upstreamDirectory)) execFileSync('git', ['clone', '--filter=blob:none', '--no-checkout', baseline.仓库, upstreamDirectory], { stdio: 'pipe', timeout: 300000 });
      assert.equal(execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: upstreamDirectory, encoding: 'utf8' }).trim(), baseline.仓库);
      execFileSync('git', ['fetch', '--depth=1', 'origin', baseline.提交], { cwd: upstreamDirectory, stdio: 'pipe', timeout: 300000 });
    }
  }
  // 仅从锁定Git提交读取，不携带作者仓库工作树、开发副本、私人数据或已装依赖。
  const archive = execFileSync('git', ['archive', baseline.提交, 'web', 'VERSION', 'CHANGELOG.md', 'LICENSE'], { cwd: upstreamDirectory, maxBuffer: 100 * 1024 * 1024 });
  execFileSync('/usr/bin/tar', ['-xf', '-', '-C', active], { input: archive });
  const record = join(output, '装配记录'); mkdirSync(record, { mode: 0o700 });
  const baselineFiles = {};
  // 刚由锁定git archive创建的全新目录；为装配保护登记其确定的初始内容。
  for (const item of json(join(root, '上游适配/开发源码映射.json')).文件) {
    if (existsSync(join(source, item.目标))) baselineFiles[item.目标] = sha256(readFileSync(join(source, item.目标)));
  }
  for (const item of json(join(root, '上游适配/开发源码映射.json')).接入差异) {
    const name = '画布副本/' + item.目标;
    if (existsSync(join(source, name))) baselineFiles[name] = sha256(readFileSync(join(source, name)));
  }
  save(join(record, '源码装配.json'), { 文件: baselineFiles });
  const assembled = 装配开发源码({ root, activeDirectory: source, runtimeDirectory: record, upstreamDirectory });
  const web = join(active, 'web');
  for (const [name, target] of [['Web前端依赖.json', 'package.json'], ['Web前端依赖锁.json', 'package-lock.json']]) cpSync(join(root, '开发工具', name), join(web, target));
  await 执行有界构建命令('npm', ['ci', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: web, env: buildEnv, budgetDirectory: outputParent, timeout: 300000 });
  const require = createRequire(join(web, 'package.json'));
  await 执行有界构建命令(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '--incremental', 'false'], { cwd: web, budgetDirectory: outputParent, timeout: 120000 });
  writeFileSync(join(active, 'VERSION'), release.版本 + '\n');
  const stage = join(output, packageName(release.版本).replace(/\.zip$/, ''));
  mkdirSync(stage, { mode: 0o700 });
  await 执行有界构建命令(process.execPath, [join(root, '开发工具/构建Web前端.mjs'), '客户', web, join(output, '构建缓存'), join(stage, 'web')], { budgetDirectory: outputParent, timeout: 120000 });
  const copied = new Set();
  // 后端以完成替换的装配结果为准；目标路径必须位于固定扩展目录。
  for (const item of json(join(root, '上游适配/开发源码映射.json')).文件) {
    const prefix = '画布副本/扩展功能/';
    if (!item.目标.startsWith(prefix)) continue;
    const member = item.目标.slice('画布副本/'.length);
    if (copied.has(member)) continue; copied.add(member);
    const target = join(stage, member); mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    cpSync(join(source, item.目标), target); chmodSync(target, 0o600);
  }
  // 旧版安装器单文件上限32MiB：随签名包携带压缩核心，不能漏包或塞入裸二进制。
  const coreDirectory = join(stage, '扩展功能/网络代理/核心');
  const core = json(join(coreDirectory, '核心清单.json')), coreArchive = readFileSync(join(coreDirectory, '代理核心.gz'));
  assert.equal(core.variant, 'Mihomo Smart'); assert.equal(core.platform, 'darwin'); assert.equal(core.arch, 'arm64');
  assert.ok(coreArchive.length < 32 * 1024 ** 2); assert.equal(coreArchive.length, core.archiveSize); assert.equal(sha256(coreArchive), core.archiveSha256);
  assert.ok(readFileSync(join(coreDirectory, '开源许可.txt'), 'utf8').includes('GNU GENERAL PUBLIC LICENSE'));
  assert.equal(core.model.file, '智能选路模型.bin');
  const smartModel = readFileSync(join(coreDirectory, core.model.file));
  assert.ok(smartModel.length <= 32 * 1024 ** 2); assert.equal(smartModel.length, core.model.size); assert.equal(sha256(smartModel), core.model.sha256);
  for (const [name, target] of [['Web运行依赖.json', 'package.json'], ['Web运行依赖锁.json', 'package-lock.json']]) cpSync(join(root, '开发工具', name), join(stage, target));
  await 执行有界构建命令('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: stage, env: buildEnv, budgetDirectory: outputParent, timeout: 300000 });
  rmSync(join(stage, 'node_modules/.bin'), { recursive: true, force: true });
  cpSync(join(active, 'LICENSE'), join(stage, '上游许可.txt'));
  writeFileSync(join(stage, '扩展功能/VERSION'), release.版本 + '\n', { mode: 0o600 });
  const runtime = json(join(runtimeDirectory, 'NODE-RUNTIME.json')), node = readFileSync(join(runtimeDirectory, 'node'));
  assert.equal(runtime.source, 'https://nodejs.org/dist/v24.16.0/node-v24.16.0-darwin-arm64.tar.gz');
  assert.equal(runtime.nodeVersion, 'v24.16.0'); assert.equal(runtime.arch, 'arm64');
  assert.equal(runtime.runtimeSha256, sha256(node)); assert.equal(runtime.runtimeSize, node.length); assert.match(runtime.archiveSha256, /^[a-f0-9]{64}$/);
  assert.equal(node.readUInt32LE(0), 0xfeedfacf); assert.equal(node.readUInt32LE(4), 0x0100000c);
  mkdirSync(join(stage, 'runtime'), { mode: 0o700 });
  for (const file of ['node', 'LICENSE', 'NODE-RUNTIME.json']) cpSync(join(runtimeDirectory, file), join(stage, 'runtime', file));
  chmodSync(join(stage, 'runtime/node'), 0o700);
  const helper = join(stage, '系统助手/系统钥匙串'), swift = join(root, '扩展功能/本机凭据/系统钥匙串.swift');
  mkdirSync(dirname(helper), { mode: 0o700 });
  await 执行有界构建命令('/usr/bin/swiftc', ['-warnings-as-errors', '-O', '-module-cache-path', join(output, 'Swift缓存'), '-o', helper, swift], { budgetDirectory: outputParent, timeout: 300000 });
  chmodSync(helper, 0o700);
  // 链接自检只加载服务模块，不打开端口、数据库或Keychain。
  execFileSync(join(stage, 'runtime/node'), ['--input-type=module', '-e', "await Promise.all([import('./扩展功能/本机服务/日常工作台.mjs'), import('./扩展功能/客户安装/Web安装管理器.mjs'), import('./扩展功能/客户安装/旧版升级任务兼容.mjs')]); try { await import('./扩展功能/客户安装/Web客户服务.mjs'); throw Error('服务绕过管理器运行'); } catch(e) { if(e.message !== 'Web客户服务必须由独立管理器启动。') throw e; }"], { cwd: stage, stdio: 'pipe', timeout: 30000 });
  try { execFileSync(helper, [], { input: '{}', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 }); assert.fail('助手未拒绝非法输入'); }
  catch (error) { assert.equal(error.status, 1, '助手必须在访问Keychain前拒绝非法输入'); }

  for (const [file, mode] of [['安装工作台.command', 'install'], ['启动工作台.command', 'start'], ['修复升级入口.command', 'prepare-beta17-upgrade']]) {
    writeFileSync(join(stage, file), '#!/bin/sh\nset -eu\n工作台目录=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$工作台目录/runtime/node" "$工作台目录/扩展功能/客户安装/Web客户命令.mjs" ' + mode + '\n', { mode: 0o700 });
    // shell标识符需ASCII；面向客户的文件名称仍为中文。
    writeFileSync(join(stage, file), readFileSync(join(stage, file), 'utf8').replaceAll('工作台目录', 'GUAN_WEB_ROOT'), { mode: 0o700 });
  }
  writeFileSync(join(stage, '安装使用说明.txt'), 'Apple Silicon Web预览版。\n先双击“安装工作台.command”，联网验证固定仓库签名后安装；安装完成会检查并创建桌面“生图工作台.app”。也可以双击“启动工作台.command”，按启动器显示的实际地址打开。默认 http://localhost:3000，被占用时自动顺延空闲端口。\n点击桌面入口时，服务未运行会先启动当前安装版本，确认本机工作台健康后再打开实际地址；版本更新后入口继续指向当前版本。\nbeta.17升级受无结果图片任务阻止时，先在软件更新页下载beta.18并点击一次“安装更新”完成暂存；确认“确认并安装”按钮出现后先不要点击。保存并关闭全部工作台页面，再进入本版本目录双击“修复升级入口.command”，按提示确认。等待beta.17恢复后回到软件更新页点击“确认并安装”。\n个人SQLite数据位于AI-Workbench-重建版/工作区，安装版本单独保存，更新不清空或替换私人数据。\n更新在设置的软件更新页操作；确认保存且任务结束后关闭工作台页面，其余网站可继续使用。\n', { mode: 0o600 });
  // 统一包权限，包含npm依赖；不带链接或构建机身份信息。
  execFileSync('/bin/chmod', ['-R', 'go-w', stage]);
  const inventory = { format: 1, app: WEB_APP, repository: WEB_REPOSITORY, version: release.版本, commit,
    dataSchema: 1, origin: WEB_ORIGIN, helper: { sha256: sha256(readFileSync(helper)), sourceSHA256: sha256(readFileSync(swift)) }, files: await inventoryWebFiles(stage) };
  save(join(stage, '工作台发布.json'), inventory);
  const archiveFile = join(output, packageName(release.版本));
  await 执行有界构建命令('/usr/bin/zip', ['-qr', archiveFile, dirname(stage) === output ? stage.slice(output.length + 1) : ''], { cwd: output, budgetDirectory: outputParent, timeout: 120000 });
  const bytes = readFileSync(archiveFile); readWebArchive(bytes, { trustedRuntime: runtime });
  assert.deepEqual(webSourceSnapshot(root), sourceSHA256, '构建期间源码发生变化，请重新构建');
  if (releaseReady) assertWebReleaseSource(root, commit, sourceSHA256);
  const descriptor = { platform: 'darwin', arch: 'arm64', name: packageName(release.版本), sha256: sha256(bytes), size: bytes.length,
    nodeVersion: runtime.nodeVersion, runtimeSha256: runtime.runtimeSha256, runtimeSize: runtime.runtimeSize };
  const result = { archive: archiveFile, stage, version: release.版本, commit, inventorySHA256: sha256(readFileSync(join(stage, '工作台发布.json'))),
    descriptor, sourceFingerprint: assembled.指纹, sourceSHA256, releaseReady, signed: false };
  save(join(output, '构建结果.json'), result);
  清理Web构建缓存(output);
  return result;
  } finally {
    try {
      if (existsSync(join(output, '构建结果.json'))) 清理Web构建临时依赖(output);
      else 清理Web失败构建(output);
    } finally { releaseBuild(); }
  }
}
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 3, '传入已经核验的官方Node运行时目录。');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
  console.log(JSON.stringify(await buildWebPackage({ runtimeDirectory: resolve(process.argv[2]), commit }), null, 2));
}
