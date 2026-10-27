import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 哈希 } from './检查运行副本.mjs';
import { 构建免填码候选 } from './预审SQLite免填码启动.mjs';
import { 建立SQLite工作台授权隔离副本 } from './接入SQLite工作台授权隔离副本.mjs';
import { 建立SQLite媒体隔离启动器 } from './接入SQLite临时媒体隔离启动器.mjs';
import { 生成审查差异 } from './检查首批功能适配.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 检查媒体启动器包, 媒体启动器路径, 媒体启动器依赖 } from '../上游适配/SQLite临时媒体策略批准.mjs';
import { 读取免填码批准, 核验免填码自有依赖, 检查免填码后继, 免填码差异SHA256 } from '../上游适配/SQLite免填码启动批准.mjs';

export function 免填码批准产物() {
  const manifest = 读取免填码批准(); 核验免填码自有依赖(根目录);
  const delta = 构建免填码候选();
  if (delta.size !== 3 || 哈希(生成审查差异(delta)) !== 免填码差异SHA256) throw Error('免填码重建差异偏离批准内容');
  for (const item of manifest.文件) {
    const value = delta.get(item.文件);
    if (!value || (value.原文 === null ? null : 哈希(value.原文)) !== item.原始SHA256 || 哈希(value.产物) !== item.候选SHA256) throw Error('免填码重建产物指纹不符');
  }
  return delta;
}
function sourceHashes(root) {
  const result = new Map();
  function walk(path = '') {
    for (const name of readdirSync(join(root, path))) {
      if (['node_modules', '.git', 'dist', '.DS_Store', 'tsconfig.tsbuildinfo'].includes(name)) continue;
      const relative = path ? path + '/' + name : name, stat = lstatSync(join(root, relative));
      if (stat.isSymbolicLink()) throw Error('隔离源文件出现链接');
      if (stat.isDirectory()) walk(relative);
      else if (!stat.isFile() || stat.nlink !== 1) throw Error('隔离源文件类型不安全');
      else result.set(relative, 哈希(readFileSync(join(root, relative))));
    }
  }
  walk(); return result;
}
// 始终新建副本，先组装已批准媒体前置，再以一笔事务同时更新页面和启动器。
// 无生产目标、端口、重启或跳过检查参数。任何失败都不启动服务。
export function 建立SQLite免填码隔离副本() {
  检查运行副本(); const delta = 免填码批准产物();
  const integration = 建立SQLite工作台授权隔离副本(), media = 建立SQLite媒体隔离启动器(), root = integration.副本;
  if (!检查媒体启动器包(media.启动器包)) throw Error('媒体前置未完整接入');
  for (const path of [媒体启动器路径, ...媒体启动器依赖().map(item => item.文件)]) {
    mkdirSync(dirname(join(root, path)), { recursive: true, mode: 0o700 });
    writeFileSync(join(root, path), readFileSync(join(media.启动器包, path)), { flag: 'wx', mode: 0o600 });
  }
  if (!检查媒体启动器包(media.启动器包) || 检查免填码后继(root)) throw Error('免填码接入前态不符');
  const before = sourceHashes(root), snapshot = join(dirname(root), '免填码启动事务快照');
  事务写入(root, delta, snapshot, { 差异指纹: 免填码差异SHA256, 写后检查() {
    if (!检查免填码后继(root)) throw Error('免填码后继未完整接入'); 核验免填码自有依赖(根目录);
    const after = sourceHashes(root);
    for (const [path, hash] of before) if (!delta.has(path) && after.get(path) !== hash) throw Error('免填码范围外修改：' + path);
    for (const path of after.keys()) if (!before.has(path) && !delta.has(path)) throw Error('免填码范围外新增：' + path);
  } });
  检查运行副本();
  const report = { ...integration, 免填码差异SHA256, 免填码已接入: true, 免填码文件数: delta.size, 免填码事务快照: snapshot,
    媒体前置: media, 启动器包: root, 已接管3100: false };
  writeFileSync(join(dirname(root), '免填码接入记录.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  return report;
}
export async function 加载SQLite免填码隔离启动器(integration) {
  if (!检查免填码后继(integration.副本)) throw Error('只加载完整批准的免填码装配');
  const module = await import(pathToFileURL(join(integration.副本, 媒体启动器路径)).href);
  if (!检查免填码后继(integration.副本)) throw Error('免填码装配加载期间改变');
  return module;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 2) throw Error('只新建免填码隔离副本，不接受生产目录或跳过检查选项');
  console.log(JSON.stringify(建立SQLite免填码隔离副本(), null, 2));
}
