import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { 根目录, 上游目录, 基线 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 精确替换, 预审类型, 生成审查差异, ts } from './检查首批功能适配.mjs';
import { 生成用户候选 } from './检查用户功能适配.mjs';
import { 生成首页顶栏候选 } from './生成首页顶栏候选.mjs';
import { 生成脚本来源候选 } from './预审脚本与提示词来源.mjs';
import { 读取品牌资源 } from './导入品牌原样资源.mjs';
import { 状态, 上游提交, 恢复编号, 保持关闭, 接入差异, 品牌资源 } from '../上游适配/全局顶栏主题品牌恢复.mjs';
import { 精简主题历史映射 } from '../上游适配/精简离线与三态主题批准.mjs';
import { 修订前态指纹 } from '../上游适配/顶栏单来源批准.mjs';
import { 顶栏后继, 顶栏运行后继SHA256, 脚本来源后继SHA256, 脚本来源运行后继SHA256 } from '../上游适配/首页批次后继.mjs';
import { 读取全局恢复批准 } from '../上游适配/全局界面恢复批准.mjs';

// 后续小补丁会继续演进同一批源码。重放已经批准的全局批次时，优先
// 取运行目录中按批准指纹保存的历史前后态，避免当前源码改变旧差异。
function 读取全局历史字节() {
  const manifest = 读取全局恢复批准();
  const expected = new Map(manifest.文件.filter(item => item.原始SHA256 !== null).map(item => [item.文件, item]));
  const before = new Map(), after = new Map();
  const inventory = spawnSync('find', [join(根目录, '.运行'), '-type', 'f'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  for (const file of (inventory.stdout || '').split('\n').filter(Boolean)) {
    const marker = file.lastIndexOf('/web/');
    if (marker < 0) continue;
    const relative = file.slice(marker + 1);
    const item = expected.get(relative);
    if (!item || (before.has(relative) && after.has(relative))) continue;
    try {
      const value = readFileSync(file, 'utf8');
      const hash = 哈希(value);
      if (hash === item.原始SHA256 && !before.has(relative)) before.set(relative, value);
      if (hash === item.候选SHA256 && !after.has(relative)) after.set(relative, value);
    } catch { /* 临时事务文件可能在扫描时退出，继续查找其他副本。 */ }
  }
  return { before, after };
}

// 从既有精确批准产物重建，不把运行副本当作权威源码。
export function 生成全局界面候选() {
  if (状态 !== '待单独批准' || 上游提交 !== 基线.提交) throw Error('本批仍需针对锁定基线单独批准');
  const status = 检查运行副本();
  if (!status.首页顶栏已应用 || !status.脚本与提示词来源关闭已应用) throw Error('缺少既有批准前置');
  const previous = new Map([...生成用户候选(), ...生成首页顶栏候选(), ...生成脚本来源候选()]);
  const files = new Map();
  const successor = 精简主题历史映射(运行目录);
  for (const item of 接入差异) {
    const before = previous.get(item.文件)?.产物 ?? readFileSync(join(上游目录, item.文件), 'utf8');
    // 当前维护源码可能已经包含这条历史恢复的完整后继；保持后继内容原样，
    // 仍由后续指纹链校验，避免重复套用同一 UI 恢复补丁。
    const 已是顶栏后继 = item.文件 === 'web/src/guan/旧版首页顶栏.tsx' &&
      哈希(before) === 顶栏后继[item.文件]?.后态SHA256;
    const 运行已有顶栏后继 = 已是顶栏后继 && 修订前态指纹(运行目录, item.文件) === 顶栏运行后继SHA256;
    const 已是脚本来源后继 = item.文件 === 'web/src/guan/脚本与提示词来源.ts' && 哈希(before) === 脚本来源后继SHA256;
    const after = 已是顶栏后继 || 已是脚本来源后继 ? before : 精确替换(before, item.替换);
    const 运行已有脚本来源后继 = 已是脚本来源后继 && 修订前态指纹(运行目录, item.文件) === 脚本来源运行后继SHA256;
    const expected = status.全局界面恢复已应用 ? after : before;
    const next = successor.get(item.文件);
    if (next && !已是脚本来源后继 && next.原始SHA256 !== 哈希(expected)) throw Error('全局恢复后继前态不符');
    if (!运行已有顶栏后继 && !运行已有脚本来源后继 && 修订前态指纹(运行目录, item.文件) !== (next?.候选SHA256 ?? 哈希(expected))) throw Error('前置产物不符：' + item.文件);
    files.set(item.文件, { 原文: before, 产物: after });
  }
  if (status.全局界面恢复已应用) {
    const history = 读取全局历史字节();
    for (const item of 读取全局恢复批准().文件) {
      const value = files.get(item.文件);
      const before = history.before.get(item.文件);
      const after = history.after.get(item.文件);
      if (value && before && after) files.set(item.文件, { 原文: before, 产物: after });
    }
  }
  if (existsSync(join(运行目录, 品牌资源.产物)) && !status.全局界面恢复已应用) throw Error('运行副本已有品牌资源，拒绝覆盖');
  return files;
}

export function 生成品牌资源差异() {
  const temp = mkdtempSync(join(tmpdir(), 'guan-brand-review-'));
  try {
    writeFileSync(join(temp, 'favicon.png'), 读取品牌资源());
    const diff = spawnSync('git', ['-c', 'core.autocrlf=false', 'diff', '--no-index', '--binary', '--', '/dev/null', 'favicon.png'], { cwd: temp, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (diff.status !== 1 || !diff.stdout.includes('GIT binary patch')) throw Error('无法生成精确品牌资源差异：' + (diff.error?.message ?? diff.stderr));
    return diff.stdout.replaceAll('a/favicon.png', 'a/' + 品牌资源.产物).replaceAll('b/favicon.png', 'b/' + 品牌资源.产物);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export function 预审全局界面({ 完整类型 = false, 生成差异 = false } = {}) {
  const files = 生成全局界面候选();
  const sourceFiles = new Map([...files].filter(([path]) => /\.tsx?$/.test(path)));
  for (const [fileName, item] of sourceFiles) {
    const { diagnostics } = ts.transpileModule(item.产物, { fileName, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } });
    if (diagnostics?.length) throw Error('候选语法错误：' + fileName);
  }
  if (完整类型) 预审类型(sourceFiles);
  const patch = 生成审查差异(files) + 生成品牌资源差异();
  const applied = 检查运行副本().全局界面恢复已应用;
  const check = spawnSync('git', ['-C', 运行目录, 'apply', ...(applied ? ['--reverse'] : []), '--check', '-'], { input: patch, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (check.status !== 0) throw Error('标准差异检查失败：' + check.stderr);
  const manifest = {
    状态, 上游提交, 恢复编号, 保持关闭,
    前置首页顶栏差异SHA256: '2968209314dc8a492aeb35402a252b0fcd01a7422b9225ecf5ee75b127bc95d6',
    前置脚本来源关闭差异SHA256: 'b615e837c229023f3f021601fa506ad8bcaaae8886cd4631bea3dad97f29f2ec',
    已应用到运行副本: false, 语法预审通过: true, 完整类型预审通过: 完整类型, 标准差异检查通过: true,
    差异SHA256: 哈希(patch),
    文件: [...files].map(([文件, item]) => ({ 文件, 原始SHA256: 哈希(item.原文), 候选SHA256: 哈希(item.产物) })).concat({ 文件: 品牌资源.产物, 原始SHA256: null, 候选SHA256: 品牌资源.SHA256 }),
  };
  if (生成差异) {
    if (!完整类型) throw Error('只保存通过完整类型预审的审查快照');
    const dir = join(根目录, '上游适配/待审查');
    mkdirSync(dir, { recursive: true });
    for (const [name, content] of [['全局顶栏主题品牌恢复.patch', patch], ['全局顶栏主题品牌恢复.json', JSON.stringify(manifest, null, 2) + '\n']]) {
      const path = join(dir, name);
      if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('不覆盖不同审查快照');
      if (!existsSync(path)) writeFileSync(path, content);
    }
  }
  检查运行副本();
  console.log(JSON.stringify(manifest, null, 2));
  return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => !['--生成审查差异', '--完整类型预审'].includes(arg))) throw Error('仅供预审，不提供运行副本应用功能');
  预审全局界面({ 生成差异: process.argv.includes('--生成审查差异'), 完整类型: process.argv.includes('--完整类型预审') });
}
