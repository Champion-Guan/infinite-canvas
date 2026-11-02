import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WEB_MANIFEST_NAMES, sha256, verifyWebManifest } from '../扩展功能/客户安装/Web发布协议.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

// 只执行旧版本的纯验签/解包模块，不启动旧服务或读取客户工作区。
export async function verifyLegacyPackages(repository, recordFile) {
  const record = JSON.parse(await readFile(recordFile, 'utf8'));
  const archiveDirectory = dirname(record.archive);
  const proof = await Promise.all(WEB_MANIFEST_NAMES.map(name => readFile(join(archiveDirectory, name))));
  const identity = verifyWebManifest(...proof, { releaseVersion: record.version });
  assert.equal(identity.manifest.commit, record.commit);
  assert.equal(sha256(await readFile(record.archive)), identity.selected.sha256);
  const temporary = await mkdtemp(join(root, '.运行/旧版包兼容复验-'));
  const results = [];
  try {
    const download = join(temporary, '下载');
    await mkdir(download, { mode: 0o700 });
    await copyFile(record.archive, join(download, 'package.zip'));
    for (let i = 0; i < WEB_MANIFEST_NAMES.length; i++) {
      await writeFile(join(download, WEB_MANIFEST_NAMES[i]), proof[i], { mode: 0o600 });
    }
    for (const version of ['2.0.0-beta.14', '2.0.0-beta.19', '2.0.0-beta.20']) {
      const tag = 'web-v' + version, sourceRoot = join(temporary, '旧源码-' + version);
      const modules = new Map();
      async function materialize(name) {
        assert.ok(!name.startsWith('../') && !posix.isAbsolute(name) && name.endsWith('.mjs'));
        if (modules.has(name)) return;
        const bytes = execFileSync('git', ['show', tag + ':' + name], {
          cwd: repository, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
        });
        modules.set(name, sha256(bytes));
        const file = join(sourceRoot, name);
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        await writeFile(file, bytes, { mode: 0o600 });
        for (const [, specifier] of bytes.toString().matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)) {
          await materialize(posix.normalize(posix.join(posix.dirname(name), specifier)));
        }
      }
      const entry = '扩展功能/客户安装/Web安装包核验.mjs';
      await materialize(entry);
      const verifier = await import(pathToFileURL(join(sourceRoot, entry)));
      const destination = join(temporary, '解包-' + version);
      try {
        const checked = await verifier.extractSignedWebPackage(download, destination, {
          releaseVersion: record.version, currentVersion: version,
        });
        assert.equal(checked.inventory.version, record.version);
        assert.equal(checked.inventory.commit, record.commit);
        assert.ok(checked.inventory.files['修复升级入口.command']);
        assert.ok(checked.inventory.files['扩展功能/客户安装/工作台图标.icns']);
        results.push({ from: version, to: record.version, passed: true,
          verifierSHA256: modules.get(entry), files: Object.keys(checked.inventory.files).length,
          originalModules: Object.fromEntries(modules) });
      } finally {
        await rm(destination, { recursive: true, force: true });
      }
    }
    return { at: new Date().toISOString(), version: record.version, commit: record.commit,
      archiveSHA256: identity.selected.sha256, signatureVerified: true, results,
      scope: '各标签原始核验器及其原始相对依赖完整执行验签、ZIP解包、库存/架构核验；未启动旧服务，不代表Mac B实机升级。临时源码和解包目录在finally清理。' };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 4, '传入发布Git检出目录及构建结果文件。');
  const result = await verifyLegacyPackages(resolve(process.argv[2]), resolve(process.argv[3]));
  const directory = join(root, '开发文档/验收记录/Claude逐项复现20261102');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, '旧版安装包兼容.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
