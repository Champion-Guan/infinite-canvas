import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 哈希 } from './检查运行副本.mjs';
import { 生成审查差异 } from './检查首批功能适配.mjs';
import { 构建写入协调候选, 服务路径 } from './预审SQLite写入协调.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 检查写入协调服务包, 读取写入协调批准, 核验写入协调自有依赖, 写入协调差异SHA256, 服务包协议路径, 服务包工作区路径 } from '../上游适配/SQLite写入协调批准.mjs';

export function 写入协调批准产物() {
  const manifest = 读取写入协调批准(); 核验写入协调自有依赖(根目录);
  const delta = 构建写入协调候选();
  if (delta.size !== 2 || 哈希(生成审查差异(delta)) !== 写入协调差异SHA256) throw Error('写入协调重建差异偏离批准内容');
  for (const item of manifest.文件) {
    const value = delta.get(item.文件);
    if (!value || (value.原文 === null ? null : 哈希(value.原文)) !== item.原始SHA256 || 哈希(value.产物) !== item.候选SHA256) throw Error('写入协调重建产物指纹不符');
  }
  return delta;
}

// 不接受生产路径，始终新建包。相对导入保持原字节，不用内存候选或导入改写装配。
export function 建立SQLite写入协调隔离服务() {
  检查运行副本();
  const delta = 写入协调批准产物(), home = mkdtempSync(join(根目录, '.运行/SQLite写入协调-'));
  const root = join(home, '服务包'), snapshot = join(home, '写入协调事务快照');
  mkdirSync(root, { mode: 0o700 });
  for (const [path, content] of [[服务包协议路径, readFileSync(join(根目录, 服务包协议路径))], [服务包工作区路径, readFileSync(join(根目录, 服务包工作区路径))], [服务路径, delta.get(服务路径).原文]]) {
    mkdirSync(dirname(join(root, path)), { recursive: true, mode: 0o700 }); writeFileSync(join(root, path), content, { mode: 0o600 });
  }
  if (检查写入协调服务包(root)) throw Error('隔离服务包前态异常');
  核验写入协调自有依赖(根目录);
  事务写入(root, delta, snapshot, { 差异指纹: 写入协调差异SHA256, 写后检查() {
    if (!检查写入协调服务包(root)) throw Error('写入协调后继未完整接入');
    核验写入协调自有依赖(根目录);
  } });
  检查运行副本();
  const report = { 写入协调差异SHA256, 已接入隔离服务包: true, 已接管3100: false, 服务包: root, 事务快照: snapshot, 文件数: 2, 未修改依赖文件数: 2, 同包工作区与协议: true };
  writeFileSync(join(home, '写入协调接入记录.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  return report;
}
export async function 加载SQLite写入协调隔离服务(integration) {
  if (!检查写入协调服务包(integration.服务包)) throw Error('只加载完整批准服务包');
  const module = await import(pathToFileURL(join(integration.服务包, 服务路径)).href);
  const workspace = await import(pathToFileURL(join(integration.服务包, 服务包工作区路径)).href);
  if (!检查写入协调服务包(integration.服务包)) throw Error('服务包在加载期间发生变化');
  return Object.freeze({ ...module, ...workspace });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 2) throw Error('只创建隔离服务包，不接受生产路径或应用选项');
  console.log(JSON.stringify(建立SQLite写入协调隔离服务(), null, 2));
}
