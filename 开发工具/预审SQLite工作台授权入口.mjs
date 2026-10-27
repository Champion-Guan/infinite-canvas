import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本, 哈希 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异, 预审类型 } from './检查首批功能适配.mjs';
import { 启动存储批准产物 } from './接入SQLite启动存储隔离副本.mjs';
import { 启动存储差异SHA256 } from '../上游适配/SQLite启动存储批准.mjs';

export const 授权入口模块 = Object.freeze(['协议.mjs', '浏览器适配.mjs', '续期数据客户端.mjs', '应用值编码.mjs', '应用存储适配.mjs', '本机授权客户端.mjs', '工作台授权入口.mjs', '启动工作台.mjs']);
// 初审快照保留。启动器补充清理失败cause后，以复审清单锁定新指纹，9文件patch本身不变。
export const 授权入口审查名 = 'SQLite工作台授权入口复审';
export function 工作台HTML授权候选(text) {
  return 精确替换(text, [['<script type="module" src="/src/main.tsx"></script>', '<script type="module" src="/src/guan/sqlite/启动工作台.mjs"></script>']]);
}
export function 生成SQLite工作台授权候选() {
  检查运行副本();
  const { combined: prerequisite } = 启动存储批准产物(), before = prerequisite.get('web/index.html')?.产物;
  if (!before) throw Error('缺少已批准的启动存储HTML前态');
  const delta = new Map([['web/index.html', { 原文: before, 产物: 工作台HTML授权候选(before) }]]);
  for (const name of 授权入口模块) {
    const source = readFileSync(join(根目录, '扩展功能/本机存储', name), 'utf8');
    if (/\b(?:localStorage|sessionStorage|indexedDB)\s*\./.test(source) || /\b(?:eval|new Function)\s*\(/.test(source)) throw Error('自有授权模块出现未批准的持久化/执行入口');
    delta.set('web/src/guan/sqlite/' + name, { 原文: null, 产物: source });
  }
  // 核验闭合相对模块图。唯一越界导入为原main；不重画React、不插入新原版控件。
  for (const [path, item] of delta) if (path.endsWith('.mjs')) {
    for (const match of item.产物.matchAll(/(?:from\s*|import\(\s*)['"]([^'"]+)['"]/g)) {
      const target = posix.normalize(posix.join(posix.dirname(path), match[1]));
      if (!match[1].startsWith('.') || (!delta.has(target) && !(path.endsWith('/工作台授权入口.mjs') && target === 'web/src/main'))) throw Error('授权模块图出现未知依赖：' + match[1]);
    }
  }
  return { delta, prerequisite, combined: new Map([...prerequisite, ...delta]) };
}
export function 预审SQLite工作台授权入口({ 生成差异 = false } = {}) {
  const { delta, combined } = 生成SQLite工作台授权候选();
  预审类型(new Map([...combined].filter(([path]) => /\.(ts|tsx)$/.test(path))));
  for (const name of 授权入口模块) {
    const check = spawnSync(process.execPath, ['--check', join(根目录, '扩展功能/本机存储', name)], { encoding: 'utf8' });
    if (check.status !== 0) throw Error('授权模块语法未通过：' + name + '\n' + check.stderr);
  }
  const patch = 生成审查差异(delta);
  const manifest = {
    状态: '待具体9文件差异批准，未应用任何运行副本', 日期: '2026-10-17', 上游提交: 基线.提交,
    前置启动存储差异SHA256: 启动存储差异SHA256, 差异SHA256: 哈希(patch), 完整TS类型预审通过: true, 自有JS语法及模块图通过: true,
    核心改动: '仅将已批准index.html的module入口从main.tsx改为自有启动入口；新增8个自有模块，原main及React布局不改',
    保持约束: ['没有应用待批差异，也未建立携带新差异的运行副本', '一次性码只由可信进程内签发，不放URL/Cookie/浏览器存储', '授权和健康检查成功后才加载既有SQLite初始化及原React入口', '刷新须新码；现阶段启动器只支持临时隔离端口', '不接管或重启3100，不迁旧数据、不读取真实凭据、不发布', '保存失败UI、正式凭据端口、容量及恢复仍为独立缺口'],
    文件: [...delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    自有来源: 授权入口模块.map(name => ({ 文件: '扩展功能/本机存储/' + name, SHA256: 哈希(readFileSync(join(根目录, '扩展功能/本机存储', name))) })),
    启动器来源: ['扩展功能/本机服务/受限工作台启动器.mjs', '扩展功能/本机服务/本机授权网关.mjs', '扩展功能/本机服务/受控会话.mjs', '扩展功能/本机服务/自动备份.mjs'].map(文件 => ({ 文件, SHA256: 哈希(readFileSync(join(根目录, 文件))) })),
  };
  if (生成差异) for (const [name, content] of [[授权入口审查名 + '.patch', patch], [授权入口审查名 + '.json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const path = join(根目录, '上游适配/待审查', name);
    if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('不覆盖历史工作台授权入口审查');
    if (!existsSync(path)) writeFileSync(path, content);
  }
  检查运行副本(); return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('只预审，不提供应用功能');
  console.log(JSON.stringify(预审SQLite工作台授权入口({ 生成差异: process.argv.includes('--生成审查差异') }), null, 2));
}
