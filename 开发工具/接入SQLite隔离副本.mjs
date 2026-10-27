import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 生成SQLite全面候选 } from './预审SQLite全面替换.mjs';
import { 生成审查差异, 预审类型 } from './检查首批功能适配.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 读取SQLite批准, 核验SQLite自有依赖, 检查SQLite批次, SQLite差异SHA256 } from '../上游适配/SQLite全面替换批准.mjs';

export function SQLite批准产物() {
  const manifest = 读取SQLite批准();
  核验SQLite自有依赖(根目录);
  const files = 生成SQLite全面候选();
  if (files.size !== manifest.文件.length || 哈希(生成审查差异(files)) !== SQLite差异SHA256) throw Error('SQLite重建差异偏离批准内容');
  for (const item of manifest.文件) {
    const value = files.get(item.文件);
    if (!value || (value.原文 === null ? null : 哈希(value.原文)) !== item.原始SHA256 || 哈希(value.产物) !== item.候选SHA256) throw Error('SQLite重建产物指纹不符：' + item.文件);
  }
  return files;
}

// 只创建独立的可重建验收副本。不提供写入活跃3100副本的选项。
export function 建立SQLite隔离副本({ 类型预审 = true } = {}) {
  const state = 检查运行副本();
  if (!state.请求转发已恢复 || 检查SQLite批次(运行目录)) throw Error('SQLite接入前置不是已批准的完整浏览器存储版本');
  const files = SQLite批准产物();
  if (类型预审) 预审类型(files);
  const home = mkdtempSync(join(根目录, '.运行/SQLite完整界面-'));
  const root = join(home, '副本'); mkdirSync(root, { mode: 0o700 });
  const baseline = new Map();
  function copyDirectory(source, target) {
    mkdirSync(target, { recursive: true });
    for (const entry of readdirSync(source, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.git', '.DS_Store', 'tsconfig.tsbuildinfo'].includes(entry.name)) continue;
      const from = join(source, entry.name), to = join(target, entry.name);
      if (entry.isSymbolicLink()) throw Error('隔离源码中不允许符号链接');
      if (entry.isDirectory()) copyDirectory(from, to);
      else {
        if (!entry.isFile() || lstatSync(from).nlink !== 1) throw Error('隔离源码类型不安全');
        cpSync(from, to, { errorOnExist: true, force: false });
        baseline.set(relative(root, to), 哈希(readFileSync(to)));
      }
    }
  }
  copyDirectory(运行目录, root);
  // 依赖仅复用现有安装，不运行安装脚本；Vite缓存另放隔离目录。
  symlinkSync(join(运行目录, 'web/node_modules'), join(root, 'web/node_modules'));
  for (const [path, item] of files) {
    if ((baseline.get(path) ?? null) !== (item.原文 === null ? null : 哈希(item.原文))) throw Error('复制时前态发生变化');
  }
  const snapshot = join(home, '事务快照');
  事务写入(root, files, snapshot, { 差异指纹: SQLite差异SHA256, 写后检查: () => {
    if (!检查SQLite批次(root)) throw Error('SQLite隔离产物未完整接入');
    for (const [path, hash] of baseline) if (!files.has(path) && 哈希(readFileSync(join(root, path))) !== hash) throw Error('隔离副本出现范围外改动');
  } });
  // 再次核验日常副本未被接管，任何失败均保留隔离证据而不清理用户文件。
  检查运行副本();
  if (检查SQLite批次(运行目录)) throw Error('不允许接管日常副本');
  const report = { 批准差异SHA256: SQLite差异SHA256, 已接入隔离副本: true, 已接管3100: false, 副本: root, 事务快照: snapshot, 文件数: files.size };
  writeFileSync(join(home, '接入记录.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 2) throw Error('本工具只创建隔离验收副本，不接受生产路径或应用选项');
  const result = 建立SQLite隔离副本();
  if (!result.副本.startsWith(resolve(根目录, '.运行') + sep)) throw Error('隔离目标不安全');
  console.log(JSON.stringify(result, null, 2));
}
