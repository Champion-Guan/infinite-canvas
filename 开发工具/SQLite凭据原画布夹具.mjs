import { createRequire } from 'node:module';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 建立SQLite凭据隔离副本, 加载SQLite凭据隔离启动器 } from './接入SQLite凭据隔离副本.mjs';
import { 建立SQLite写入协调隔离服务, 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';
import { 检查凭据接入后继, 核验凭据接入自有依赖, 凭据接入前置指纹, 读取凭据接入批准 } from '../上游适配/SQLite凭据接入批准.mjs';

// 仅复验已经事务接入的临时源码；完整逐字比较日常基线+所有批准后继。
// 不复用前次数据、浏览器、授权或主密钥，不写入此副本，不接受生产根。
export function 读取凭据隔离复验记录(path) {
  检查运行副本();
  const record = resolve(path), home = dirname(record), root = join(home, '副本');
  if (!home.startsWith(resolve(根目录, '.运行') + sep) || !/^SQLite完整界面-[A-Za-z0-9]+$/.test(home.split(sep).at(-1)) ||
    record !== join(home, '凭据接入记录.json') || realpathSync(record) !== record || realpathSync(root) !== root || !lstatSync(record).isFile() || lstatSync(record).nlink !== 1) throw Error('只允许已事务接入的隔离复验记录，不接受生产目录或链接');
  const integration = JSON.parse(readFileSync(record));
  if (integration.副本 !== root || !integration.凭据接入已完成 || integration.凭据接入文件数 !== 10 || integration.已接管3100 !== false || !检查凭据接入后继(root)) throw Error('隔离复验记录不完整');
  const hashes = directory => {
    const files = new Map();
    function walk(path = '') {
      for (const name of readdirSync(join(directory, path))) {
        if (['node_modules', '.git', 'dist', '.DS_Store', 'tsconfig.tsbuildinfo'].includes(name)) continue;
        const relative = path ? path + '/' + name : name, stat = lstatSync(join(directory, relative));
        if (stat.isSymbolicLink()) throw Error('隔离复验源码出现链接');
        if (stat.isDirectory()) walk(relative);
        else if (!stat.isFile() || stat.nlink !== 1) throw Error('隔离复验源码类型不安全');
        else files.set(relative, 哈希(readFileSync(join(directory, relative))));
      }
    }
    walk(); return files;
  };
  const expected = hashes(运行目录), current = hashes(root);
  for (const [path, hash] of 凭据接入前置指纹()) expected.set(path, hash);
  for (const item of 读取凭据接入批准().文件) expected.set(item.文件, item.候选SHA256);
  if (current.size !== expected.size || [...expected].some(([path, hash]) => current.get(path) !== hash)) throw Error('隔离复验完整源码偏离日常基线与精确批准后继');
  return integration;
}

// 真React画布和磁盘批准模块；随机主密钥只在本测试进程内存，不调用Keychain。
export async function createCredentialCanvasFixture({ reviewRecord } = {}) {
  核验凭据接入自有依赖(根目录);
  const integration = reviewRecord ? 读取凭据隔离复验记录(reviewRecord) : 建立SQLite凭据隔离副本();
  const serviceIntegration = 建立SQLite写入协调隔离服务(), approved = await 加载SQLite写入协调隔离服务(serviceIntegration);
  const { startIsolatedAuthorizedWorkbench } = await 加载SQLite凭据隔离启动器(integration);
  const root = mkdtempSync(join(tmpdir(), 'guan-stage6-credential-canvas-')), web = join(integration.副本, 'web');
  const require = createRequire(join(web, 'package.json')), { build } = await import(pathToFileURL(require.resolve('vite')).href), dist = join(root, 'dist');
  await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: join(root, 'node_modules/.vite'), logLevel: 'warn',
    build: { outDir: dist, emptyOutDir: false }, css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } } });
  if (!检查凭据接入后继(integration.副本)) throw Error('构建后凭据副本完整性未通过');
  核验凭据接入自有依赖(根目录);
  let workspace, service;
  const storage = { ...approved, openWorkspace(options) { workspace = approved.openWorkspace(options); return workspace; },
    async startDataService(options) { service = await approved.startDataService(options); return service; } };
  const material = randomBytes(32), credentialKeyProvider = { read: async () => Buffer.from(material), create: async () => Buffer.from(material) };
  const launcher = await startIsolatedAuthorizedWorkbench({ webRoot: dist, dataRoot: join(root, '数据'), initialize: true, storage, credentialKeyProvider });
  return { ...launcher, root, dataRoot: join(root, '数据'), workspace, dataURL: service.url, integration, serviceIntegration,
    testKeyProvider: credentialKeyProvider, createBackup: () => service.createBackup(),
    async close() { try { await launcher.close(); } finally { material.fill(0); } } };
}
