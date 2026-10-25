import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
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
  await writeFile(notes, await readFile(join(root, '开发文档/Web紧急存储更新说明.md'), 'utf8'), { flag: 'wx', mode: 0o600 });
  run(['release', 'create', tag, '--repo', WEB_REPOSITORY, '--target', record.commit, '--draft', '--prerelease', '--title', '生图工作台 Web ' + record.version, '--notes-file', notes]);
  run(['release', 'upload', tag, '--repo', WEB_REPOSITORY, record.archive + '#' + selected.name, ...WEB_MANIFEST_NAMES.map(name => join(directory, name) + '#' + name)]);
  const downloaded = await mkdtemp(join(directory, '远程复核-'));
  try {
  for (const name of [selected.name, ...WEB_MANIFEST_NAMES]) run(['release', 'download', tag, '--repo', WEB_REPOSITORY, '--pattern', webReleaseAssetName(name), '--dir', downloaded]);
  verifyWebManifest(await readFile(join(downloaded, webReleaseAssetName(WEB_MANIFEST_NAMES[0]))), await readFile(join(downloaded, webReleaseAssetName(WEB_MANIFEST_NAMES[1]))), { releaseVersion: record.version });
  assert.equal(sha256(await readFile(join(downloaded, webReleaseAssetName(selected.name)))), selected.sha256);
  } finally { await rm(downloaded, { recursive: true, force: true }); }
  run(['release', 'edit', tag, '--repo', WEB_REPOSITORY, '--draft=false', '--prerelease']);
  return { url: `https://github.com/${WEB_REPOSITORY}/releases/tag/${tag}`, version: record.version, channel: 'web-preview' };
}
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try { assert.equal(process.argv.length, 4); assert.equal(process.argv[3], 'RELEASE-WEB-PREVIEW'); console.log(JSON.stringify(await publishWebPreview(resolve(process.argv[2])))); }
  catch { console.error('Web预发布未完成；请检查现有Draft和资产。正式Stable及客户数据未改动。'); process.exitCode = 1; }
}
