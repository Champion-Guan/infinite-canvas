import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WEB_REPOSITORY, WEB_MANIFEST_NAMES, webReleaseAssetName, verifyWebManifest, sha256 } from '../扩展功能/客户安装/Web发布协议.mjs';

// 发布为单独web-v标签的Prerelease，旧Stable客户端忽略这个渠道。
export async function publishWebPreview(recordFile) {
  const root = fileURLToPath(new URL('../', import.meta.url)), record = JSON.parse(await readFile(recordFile, 'utf8'));
  const run = args => execFileSync('gh', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GH_DEBUG: '' } }).trim();
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const user = JSON.parse(run(['api', 'user'])); assert.equal(user.login, 'Champion-Guan'); assert.equal(user.id, 87700227);
  assert.equal(git(['status', '--porcelain', '--untracked-files=all']), ''); assert.equal(git(['rev-parse', 'HEAD']), record.commit);
  const directory = resolve(record.archive, '..'), tag = 'web-v' + record.version;
  assert.equal(git(['rev-parse', tag + '^{commit}']), record.commit);
  const proof = await Promise.all(WEB_MANIFEST_NAMES.map(name => readFile(join(directory, name))));
  const { selected, manifest } = verifyWebManifest(proof[0], proof[1], { releaseVersion: record.version });
  assert.equal(manifest.commit, record.commit); assert.equal(sha256(await readFile(record.archive)), selected.sha256);
  const notes = join(directory, '发布说明.md');
  await writeFile(notes, `Web预览版 ${record.version}\n\n本版修复在线安装入口：设置和右上版本弹窗共用暂存、再次验签、明确确认与关页安装流程，关闭自动安装偏好仍可手动安装且不改变偏好；已下载的按钮明确显示“已下载并验证”。源码开发版会说明需从客户安装启动入口操作。保留独立安装管理器、工作区身份、任务检查、备份与失败回退。\n\n包含此前保存、刷新和产品切换提速：合并命名空间读取，复用已验证图片，减少无变化保存，分离后台读取与保存等待，修复保存状态误报。保留真实提交回执、自动重连及升级数据保护。当前本机样本保存约1.5–4.4秒、刷新约3–5秒、连续产品切换约1–2秒；不同机器和数据规模表现可能不同。\n\nApple Silicon（macOS arm64）。下载“${selected.name}”，解压后双击“安装工作台.command”，再双击“启动工作台.command”，按启动器显示的实际地址打开。默认 http://localhost:3000，被占用时自动顺延空闲端口。安装器联网取得本Release的签名清单并核验全部文件。\n\n本版新增旧版整批迁移：在保存旧数据的浏览器中打开旧工作台地址的 /local-app/port-migration，一次导出完整备份；新版设置→旧版整批迁移，一次合并全部产品、Excel工作簿、回收快照、引用素材及普通配置，可选补充配置JSON。重复导入不重复新增，等待SQLite保存确认后再关闭。源已缺失素材需查看清单后明确选择保留缺失标记。API密钥、WebDAV密码、请求脚本及受保护本机端点需重新配置，协议默认地址不代表原渠道。保留旧工作台和完整备份。已有Web版在设置→软件更新中验签下载，确认保存和任务结束、关闭工作台页面后升级。版本目录与SQLite/素材分开，失败保留或回退。\n\n这是预览版；跨Mac实机验收与未迁移功能详见仓库开发文档。\n`, { flag: 'wx', mode: 0o600 });
  run(['release', 'create', tag, '--repo', WEB_REPOSITORY, '--target', record.commit, '--draft', '--prerelease', '--title', '生图工作台 Web ' + record.version, '--notes-file', notes]);
  run(['release', 'upload', tag, '--repo', WEB_REPOSITORY, record.archive + '#' + selected.name, ...WEB_MANIFEST_NAMES.map(name => join(directory, name) + '#' + name)]);
  const downloaded = await mkdtemp(join(directory, '远程复核-'));
  for (const name of [selected.name, ...WEB_MANIFEST_NAMES]) run(['release', 'download', tag, '--repo', WEB_REPOSITORY, '--pattern', webReleaseAssetName(name), '--dir', downloaded]);
  verifyWebManifest(await readFile(join(downloaded, webReleaseAssetName(WEB_MANIFEST_NAMES[0]))), await readFile(join(downloaded, webReleaseAssetName(WEB_MANIFEST_NAMES[1]))), { releaseVersion: record.version });
  assert.equal(sha256(await readFile(join(downloaded, webReleaseAssetName(selected.name)))), selected.sha256);
  run(['release', 'edit', tag, '--repo', WEB_REPOSITORY, '--draft=false', '--prerelease']);
  return { url: `https://github.com/${WEB_REPOSITORY}/releases/tag/${tag}`, version: record.version, channel: 'web-preview' };
}
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try { assert.equal(process.argv.length, 4); assert.equal(process.argv[3], 'RELEASE-WEB-PREVIEW'); console.log(JSON.stringify(await publishWebPreview(resolve(process.argv[2])))); }
  catch { console.error('Web预发布未完成；请检查现有Draft和资产。正式Stable及客户数据未改动。'); process.exitCode = 1; }
}
