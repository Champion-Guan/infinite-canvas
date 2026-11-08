import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 读取日常启动复验记录, 核验日常启动完整源码 } from './接入SQLite日常启动隔离副本.mjs';
import { 检查写入协调服务包, 写入协调差异SHA256 } from '../上游适配/SQLite写入协调批准.mjs';
import { 日常启动差异SHA256 } from '../上游适配/SQLite日常启动批准.mjs';

export const 指纹 = bytes => createHash('sha256').update(bytes).digest('hex');
const exec = promisify(execFile);
const extensions = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.ico', '.woff', '.woff2', '.ttf', '.gif', '.mp4', '.mp3', '.txt']);
export function 安全目录(path, privateOnly = false) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & (privateOnly ? 0o077 : 0o022)) || realpathSync(path) !== resolve(path)) throw Error('目录链接、所有者或权限不安全');
}
export function 安全文件(path, { executable = false, max = 16 * 1024 * 1024 } = {}) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode & 0o022) || stat.size > max ||
    executable && !(stat.mode & 0o100) || realpathSync(path) !== resolve(path)) throw Error('文件链接、权限或大小不安全');
  const bytes = readFileSync(path);
  if (bytes.length !== stat.size) throw Error('读取期间文件改变');
  return { sha256: 指纹(bytes), size: bytes.length };
}
export function 静态产物清单(root) {
  安全目录(root); const files = {}; let total = 0, count = 0;
  function walk(path = '', depth = 0) {
    if (depth > 16) throw Error('静态目录层级超限');
    for (const name of readdirSync(join(root, path))) {
      if (name.startsWith('.') || /[\\%?#]/.test(name)) throw Error('静态产物文件名不安全');
      if (++count > 2048) throw Error('静态产物数量超限');
      const relative = path ? path + '/' + name : name, target = join(root, relative), stat = lstatSync(target);
      if (stat.isDirectory() && !stat.isSymbolicLink()) { 安全目录(target); files[relative] = { directory: true }; walk(relative, depth + 1); }
      else {
        if (!extensions.has(extname(name))) throw Error('静态产物文件类型不支持');
        const item = 安全文件(target, { max: 128 * 1024 * 1024 }); total += item.size;
        if (total > 512 * 1024 * 1024) throw Error('静态产物总体积超限');
        files[relative] = item;
      }
    }
  }
  walk(); if (!files['index.html'] || files['index.html'].directory) throw Error('缺少原工作台入口');
  return files;
}
export function 读取协调记录(path) {
  const record = resolve(path), home = dirname(record);
  if (!home.startsWith(resolve(根目录, '.运行') + sep) || !/^SQLite写入协调-[A-Za-z0-9]+$/.test(home.split(sep).at(-1)) || record !== join(home, '写入协调接入记录.json')) throw Error('只接受批准协调服务隔离记录');
  安全目录(home); 安全文件(record);
  const value = JSON.parse(readFileSync(record));
  if (value.服务包 !== join(home, '服务包') || value.写入协调差异SHA256 !== 写入协调差异SHA256 || value.已接管3100 !== false ||
    value.已接入隔离服务包 !== true || value.文件数 !== 2 || !检查写入协调服务包(value.服务包)) throw Error('协调服务记录不完整');
  return value;
}
function currentEnvironment() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || Number(process.versions.node.split('.')[0]) !== 24) throw Error('需要已验收的macOS arm64及Node.js 24');
}
// 纯产物核验可用于临时测试。正式CLI还必须通过下面的完整批准源码/记录核验。
export function 核验准备产物(root, expectedSHA256) {
  安全目录(root, true);
  const path = join(root, '准备清单.json'); 安全文件(path, { max: 1024 * 1024 });
  const bytes = readFileSync(path);
  if (!/^[0-9a-f]{64}$/.test(expectedSHA256 ?? '') || 指纹(bytes) !== expectedSHA256) throw Error('准备清单指纹不符');
  const manifest = JSON.parse(bytes);
  if (Object.keys(manifest).sort().join(',') !== 'arch,createdAt,helper,nodeMajor,platform,protocol,web,协调差异SHA256,协调记录,日常差异SHA256,日常记录' ||
    manifest.protocol !== 'guan-daily-runtime.v1' || manifest.platform !== 'darwin' || manifest.arch !== 'arm64' || manifest.nodeMajor !== 24 ||
    manifest.日常差异SHA256 !== 日常启动差异SHA256 || manifest.协调差异SHA256 !== 写入协调差异SHA256) throw Error('准备清单范围不符');
  if (readdirSync(root).sort().join(',') !== 'web,准备清单.json,系统助手') throw Error('运行包出现未知内容');
  安全目录(join(root, '系统助手'), true);
  if (readdirSync(join(root, '系统助手')).join(',') !== '系统钥匙串') throw Error('助手目录出现未知内容');
  if (Object.keys(manifest.helper ?? {}).sort().join(',') !== 'path,sha256,size,sourceSHA256' || manifest.helper.path !== '系统助手/系统钥匙串' || !/^[0-9a-f]{64}$/.test(manifest.helper.sourceSHA256)) throw Error('助手描述不符');
  const helper = 安全文件(join(root, manifest.helper.path), { executable: true });
  if (helper.sha256 !== manifest.helper.sha256 || helper.size !== manifest.helper.size || JSON.stringify(静态产物清单(join(root, 'web'))) !== JSON.stringify(manifest.web)) throw Error('运行包文件变化或缺失');
  return { root, manifest, helperPath: join(root, manifest.helper.path), webRoot: join(root, 'web'), manifestSHA256: expectedSHA256 };
}
export function 核验日常运行包(path, expectedSHA256) {
  currentEnvironment(); const record = resolve(path), root = dirname(record);
  if (!root.startsWith(resolve(根目录, '.运行') + sep) || !/^SQLite日常准备-[A-Za-z0-9]+$/.test(root.split(sep).at(-1)) || record !== join(root, '准备清单.json')) throw Error('只接受本项目准备运行包，不读取其他文件');
  const prepared = 核验准备产物(root, expectedSHA256), { manifest } = prepared;
  const integration = 读取日常启动复验记录(manifest.日常记录), serviceIntegration = 读取协调记录(manifest.协调记录);
  const swift = join(integration.副本, '扩展功能/本机凭据/系统钥匙串.swift');
  if (安全文件(swift).sha256 !== manifest.helper.sourceSHA256) throw Error('系统助手不对应批准的Swift源码');
  return { ...prepared, integration, serviceIntegration };
}
// 只写新的可重建准备包；不创建正式工作区、不执行助手、不访问Keychain。
export async function 准备日常运行包({ dailyRecord, serviceRecord }) {
  currentEnvironment();
  const integration = 读取日常启动复验记录(dailyRecord); 读取协调记录(serviceRecord);
  const root = mkdtempSync(join(根目录, '.运行/SQLite日常准备-')), cache = mkdtempSync(join(realpathSync(tmpdir()), 'guan-daily-build-cache-'));
  const web = join(integration.副本, 'web'), require = createRequire(join(web, 'package.json'));
  const ts = require('typescript'), config = ts.readConfigFile(join(web, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw Error('批准副本TypeScript配置不可读');
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web), program = ts.createProgram(parsed.fileNames, { ...parsed.options, incremental: false, noEmit: true });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => web, getCanonicalFileName: p => p, getNewLine: () => '\n' }));
  console.log('批准磁盘副本完整类型检查通过；开始原React构建。');
  const { build } = await import(pathToFileURL(require.resolve('vite')).href);
  await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: join(cache, 'vite'), logLevel: 'warn',
    build: { outDir: join(root, 'web'), emptyOutDir: false }, css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } } });
  const helperDirectory = join(root, '系统助手'); mkdirSync(helperDirectory, { mode: 0o700 });
  const swift = join(integration.副本, '扩展功能/本机凭据/系统钥匙串.swift'), helperPath = join(helperDirectory, '系统钥匙串');
  await exec('/usr/bin/swiftc', ['-warnings-as-errors', '-O', '-module-cache-path', join(cache, 'swift'), '-o', helperPath, swift], { timeout: 55_000, maxBuffer: 1024 * 1024 });
  chmodSync(helperPath, 0o700);
  核验日常启动完整源码(integration.副本, true); 读取协调记录(serviceRecord);
  const manifest = { protocol: 'guan-daily-runtime.v1', platform: 'darwin', arch: 'arm64', nodeMajor: 24, createdAt: new Date().toISOString(),
    日常记录: resolve(dailyRecord), 协调记录: resolve(serviceRecord), 日常差异SHA256: 日常启动差异SHA256, 协调差异SHA256: 写入协调差异SHA256,
    web: 静态产物清单(join(root, 'web')), helper: { path: '系统助手/系统钥匙串', sourceSHA256: 安全文件(swift).sha256, ...安全文件(helperPath, { executable: true }) } };
  const bytes = JSON.stringify(manifest, null, 2) + '\n', path = join(root, '准备清单.json'); writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
  核验准备产物(root, 指纹(bytes));
  return { path, sha256: 指纹(bytes), root, cache, nativeHelperCompiled: true, nativeHelperExecuted: false, realKeychainAccessed: false };
}
