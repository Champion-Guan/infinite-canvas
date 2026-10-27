import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 哈希 } from './检查运行副本.mjs';
import { 构建临时媒体策略候选 } from './预审SQLite临时媒体策略.mjs';
import { 生成审查差异 } from './检查首批功能适配.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 读取媒体策略批准, 媒体策略差异SHA256, 媒体启动器路径, 媒体启动器依赖, 核验媒体策略自有依赖, 检查媒体启动器包 } from '../上游适配/SQLite临时媒体策略批准.mjs';

export function 媒体策略批准产物() {
  const manifest = 读取媒体策略批准(); 核验媒体策略自有依赖(根目录);
  const delta = 构建临时媒体策略候选(), item = manifest.文件[0], value = delta.get(媒体启动器路径);
  if (delta.size !== 1 || 哈希(生成审查差异(delta)) !== 媒体策略差异SHA256 || 哈希(value.原文) !== item.原始SHA256 || 哈希(value.产物) !== item.候选SHA256) throw Error('媒体策略重建偏离批准内容');
  return delta;
}
// 仅新建自有隔离启动器包。原启动器及历史授权入口来源指纹保持不变。
export function 建立SQLite媒体隔离启动器() {
  检查运行副本(); const delta = 媒体策略批准产物();
  const home = mkdtempSync(join(根目录, '.运行/SQLite媒体策略-')), root = join(home, '启动器包'), snapshot = join(home, '媒体策略事务快照');
  mkdirSync(root, { mode: 0o700 });
  for (const path of [媒体启动器路径, ...媒体启动器依赖().map(item => item.文件)]) {
    mkdirSync(dirname(join(root, path)), { recursive: true, mode: 0o700 });
    writeFileSync(join(root, path), readFileSync(join(根目录, path)), { mode: 0o600 });
  }
  if (检查媒体启动器包(root)) throw Error('新包不能提前含媒体后态');
  事务写入(root, delta, snapshot, { 差异指纹: 媒体策略差异SHA256, 写后检查() {
    if (!检查媒体启动器包(root)) throw Error('媒体启动器后检查未通过'); 核验媒体策略自有依赖(根目录);
  } });
  const report = { 媒体策略差异SHA256, 启动器包: root, 事务快照: snapshot, 文件数: 1, 未修改依赖数: 媒体启动器依赖().length, 已接管3100: false };
  writeFileSync(join(home, '接入记录.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  检查运行副本(); return report;
}
export async function 加载SQLite媒体隔离启动器(integration) {
  if (!检查媒体启动器包(integration.启动器包)) throw Error('只加载完整批准的媒体启动器包');
  const module = await import(pathToFileURL(join(integration.启动器包, 媒体启动器路径)).href);
  if (!检查媒体启动器包(integration.启动器包)) throw Error('媒体启动器包加载期间改变');
  return module;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 2) throw Error('只建立隔离启动器包，不接受生产目录或跳过检查选项');
  console.log(JSON.stringify(建立SQLite媒体隔离启动器(), null, 2));
}
