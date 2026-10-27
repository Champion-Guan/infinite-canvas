import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本, 哈希 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 读取卡片布局隔离记录, 核验卡片布局完整源码 } from './接入卡片自动避让隔离副本.mjs';
import { 预审卡片布局类型 } from './预审卡片自动避让.mjs';
import { 检查写入协调服务包, 服务包工作区路径, 服务包协议路径 } from '../上游适配/SQLite写入协调批准.mjs';

export const 分类容量前置记录 = join(根目录, '.运行/卡片自动避让-YFK58C/卡片布局接入记录.json');
export const 分类容量服务前置 = join(根目录, '.运行/SQLite写入协调-2XvqNB/服务包');
export const 分类统计来源 = '扩展功能/本机存储/分类容量统计.mjs';
export const 分类面板来源 = '扩展功能/存储界面/SQLite分类容量面板.tsx';
const servicePath = '扩展功能/本机服务/数据服务.mjs', fragmentPath = '扩展功能/本机存储/分片值编码.mjs';
const panelPath = 'web/src/components/layout/config-local-storage.tsx', ownPanel = 'web/src/guan/SQLite分类容量面板.tsx';
const fragmentHash = 'ca5fad4597fc2bddb225f33dcd7d6413dfc99935d4343fa29fe4595a07bf057c';

// 锁定前置及新增自有来源，仅派生内存候选。不写运行副本，不启动或重启服务。
export function 构建分类容量候选() {
  const integration = 读取卡片布局隔离记录(分类容量前置记录);
  if (!检查写入协调服务包(分类容量服务前置)) throw Error('分类统计服务前置未完整批准');
  const delta = new Map(), workspace = readFileSync(join(分类容量服务前置, 服务包工作区路径), 'utf8');
  const service = readFileSync(join(分类容量服务前置, servicePath), 'utf8');
  delta.set(服务包工作区路径, { 原文: workspace, 产物: 精确替换(workspace, [
    ["const DB_NAME = '工作台.sqlite';", "import { readCategorizedUsage } from './分类容量统计.mjs';\n\nconst DB_NAME = '工作台.sqlite';"],
    ['  function active(write = false) {', '  let usagePending;\n  function active(write = false) {'],
    ['    readUsage() {', `    readDetailedUsage() {
      active();
      // 同时打开多个容量面板只做一次扫描；结束后不缓存，不影响保存队列。
      if (!usagePending) usagePending = readCategorizedUsage({ dataRoot: root, workspaceId }).finally(() => { usagePending = null; });
      return usagePending;
    },
    readUsage() {`],
  ]) });
  delta.set(servicePath, { 原文: service, 产物: 精确替换(service, [['json(200, workspace.readUsage());', "const usage = await workspace.readDetailedUsage(); requireValue(sessions.get(token) === session && session.expiresAt > now(), 'session_denied', '统计期间会话已失效，请重新授权。', 401); json(200, usage);"]]) });
  for (const path of [分类统计来源, fragmentPath]) {
    if (existsSync(join(分类容量服务前置, path))) throw Error('分类服务前置含未知后继文件');
    const source = readFileSync(join(根目录, path), 'utf8');
    if (path === fragmentPath && 哈希(source) !== fragmentHash) throw Error('分片解码依赖指纹改变');
    delta.set(path, { 原文: null, 产物: source });
  }
  delta.set(panelPath, { 原文: readFileSync(join(integration.副本, panelPath), 'utf8'), 产物: 'export { ConfigLocalStorage } from "@/guan/SQLite分类容量面板";\n' });
  if (existsSync(join(integration.副本, ownPanel))) throw Error('分类面板前置含未知文件');
  delta.set(ownPanel, { 原文: null, 产物: readFileSync(join(根目录, 分类面板来源), 'utf8') });
  核验卡片布局完整源码(integration.副本, true);
  return { integration, delta };
}
export async function 加载分类容量内存候选(preview = 构建分类容量候选()) {
  const load = async path => {
    let source = preview.delta.get(path).产物;
    // 仅内存测试解析静态相对导入；真正接入必须使用另行批准的完整闭合包。
    source = source.replace(/from '(\.[^']+)'/g, (_, relative) => `from '${new URL(relative, pathToFileURL(join(根目录, path))).href}'`);
    if (path === 服务包工作区路径) source = 精确替换(source, [["const sourceRoot = fileURLToPath(new URL('../../', import.meta.url));", 'const sourceRoot = ' + JSON.stringify(根目录) + ';']]);
    return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  };
  return { ...await load(服务包工作区路径), ...await load(servicePath) };
}
export function 预审分类容量类型(preview) {
  return 预审卡片布局类型({ integration: preview.integration, delta: new Map([...preview.delta].filter(([path]) => path.startsWith('web/'))) });
}
export function 预审分类容量(generate = false) {
  检查运行副本();
  const preview = 构建分类容量候选(); 预审分类容量类型(preview);
  const patch = 生成审查差异(preview.delta);
  const manifest = { 日期: '2026-10-18', 状态: '待六文件具体差异批准；仅内存候选及自有面板预审，未接入运行副本',
    上游提交: 基线.提交, 前置记录: 分类容量前置记录, 服务前置: 分类容量服务前置, 差异SHA256: 哈希(patch), 完整候选类型检查通过: true,
    自有来源: [分类统计来源, 分类面板来源, fragmentPath].map(文件 => ({ 文件, SHA256: 哈希(readFileSync(join(根目录, 文件))) })),
    未改服务依赖: [服务包协议路径, '扩展功能/本机服务/写入协调.mjs'].map(文件 => ({ 文件, SHA256: 哈希(readFileSync(join(分类容量服务前置, 文件))) })),
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    保持约束: ['作者506文件、已批准源码及历史批准器不变', '仅受限usage读接口，Host/Origin/会话/CSRF/限流及写入协调保留',
      '只读事务核验当前v1/v2，媒体按块去重，不解密、不读媒体正文、不清理、不迁数据', '备份不计入；磁盘文件长度为采样值，不是文件系统分配空间',
      '无周期统计或画布逐帧订阅；不重启/接管3100、不访问真实数据或Keychain、不推送发布'],
  };
  if (generate) for (const [name, content] of [['SQLite分类容量.patch', patch], ['SQLite分类容量.json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const path = join(根目录, '上游适配/待审查', name);
    if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('不覆盖旧审查产物，请另建修订批次');
    if (!existsSync(path)) writeFileSync(path, content, { flag: 'wx', mode: 0o600 });
  }
  检查运行副本(); return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('只提供预审，不提供接入、重启或生产路径选项');
  console.log(JSON.stringify(预审分类容量(process.argv.includes('--生成审查差异')), null, 2));
}
