// 构建后继，来源 开发工具/模型价格构建依赖只读镜像.mjs SHA256 6b89d50c98ac974ee90997641e8c421560cf99dbd2d6b6469b5d02aa32012c10；原件保持。
// 独立后继，来源 开发工具/构建依赖只读镜像.mjs SHA256 d1ff8c686b496b0a49ca2e7705a824d09984d89ad6380292095bd32027ccb83a；原件保持。
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, realpathSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { 创建类型依赖只读镜像 } from './模型价格复审依赖只读镜像.mjs';

// 在系统临时目录重建同一pnpm依赖图；压缩包逐个匹配原锁SHA512。
// 不读取iCloud占位JS，不改原依赖，不运行安装脚本，不更换版本。
export function 创建完整构建镜像(integration) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'guan-build-dependencies-'))), canvas = join(root, '画布副本');
  const sourceWeb = join(integration.副本, 'web'), sourceModules = join(sourceWeb, 'node_modules');
  cpSync(integration.副本, canvas, { recursive: true, dereference: false, verbatimSymlinks: true, filter: path => path !== sourceModules });
  const web = join(canvas, 'web'), targetModules = join(web, 'node_modules'); mkdirSync(targetModules);
  const mirror = 创建类型依赖只读镜像(path => readFileSync(path, 'utf8'), join(sourceModules, '.pnpm/lock.yaml'));
  const installed = new Map(), queue = [];
  function readable(path) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw Error('构建依赖归档含符号链接');
    chmodSync(path, stat.mode | (stat.isDirectory() ? 0o700 : 0o600));
    if (stat.isDirectory()) for (const name of readdirSync(path)) readable(join(path, name));
  }
  function plan(path) {
    const actual = realpathSync(path);
    if (installed.has(actual)) return installed.get(actual);
    const match = actual.match(/^(.*\/node_modules\/\.pnpm\/)([^/]+)\/node_modules\/((?:@[^/]+\/)?[^/]+)$/);
    if (!match) throw Error('构建依赖拒绝未知实路径：' + actual);
    const [, pnpm, folder, name] = match, target = join(targetModules, '.pnpm', folder, 'node_modules', name);
    installed.set(actual, target); queue.push({ actual, target, pnpm, folder, name }); return target;
  }
  function link(path, target) {
    mkdirSync(dirname(path), { recursive: true });
    if (lstatSync(path, { throwIfNoEntry: false })) {
      if (!lstatSync(path).isSymbolicLink() || resolve(dirname(path), readlinkSync(path)) !== target) throw Error('构建依赖链接冲突'); return;
    }
    symlinkSync(relative(dirname(path), target), path);
  }
  const packageJSON = JSON.parse(readFileSync(join(sourceWeb, 'package.json')));
  const names = [...Object.keys(packageJSON.dependencies), 'vite', '@vitejs/plugin-react', '@tailwindcss/postcss'];
  for (const name of names) link(join(targetModules, name), plan(join(sourceModules, name)));
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]; let text;
    try { text = mirror.read(join(item.actual, 'package.json')); }
    catch (error) {
      // 某些旧npm归档将目录标成0666。只补本轮临时解包目录的owner访问位。
      const report = mirror.report(), index = report.包.length - 1;
      if (error.code !== 'EACCES' || !error.path?.startsWith(realpathSync(join(report.临时目录, String(index), 'unpacked')) + '/')) throw error;
      readable(join(report.临时目录, String(index), 'unpacked'));
      text = mirror.read(join(item.actual, 'package.json'));
    }
    const metadata = JSON.parse(text), report = mirror.report();
    const index = report.包.findIndex(pkg => pkg.name === metadata.name && pkg.version === metadata.version);
    if (index < 0 || metadata.name !== item.name) throw Error('构建依赖包身份不符');
    const unpacked = join(report.临时目录, String(index), 'unpacked'), packageRoot = join(unpacked, readdirSync(unpacked)[0]);
    readable(packageRoot);
    mkdirSync(dirname(item.target), { recursive: true }); cpSync(packageRoot, item.target, { recursive: true, errorOnExist: true, force: false });
    // 应用仅@import shadcn/tailwind.css；保留完整包字节，CLI的运行依赖不进入CSS构建。
    if (item.name === 'shadcn') continue;
    const sourceSibling = join(item.pnpm, item.folder, 'node_modules');
    for (const entry of readdirSync(sourceSibling).filter(name => !name.startsWith('.'))) {
      const deps = entry.startsWith('@') ? readdirSync(join(sourceSibling, entry)).filter(name => !name.startsWith('.')).map(name => entry + '/' + name) : [entry];
      for (const name of deps) {
        const path = join(sourceSibling, name);
        if (!existsSync(path) || !existsSync(join(path, 'package.json')) || realpathSync(path) === item.actual) continue;
        link(join(targetModules, '.pnpm', item.folder, 'node_modules', name), plan(path));
      }
    }
  }
  const report = { ...mirror.report(), 实例数: installed.size, web, sourceWeb, 说明: 'shadcn完整包用于其tailwind.css；未装配未参与应用构建的CLI运行依赖。', 安装脚本已执行: false };
  writeFileSync(join(root, '构建依赖.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  return { root, web, report };
}
