import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 启动存储批准产物 } from './接入SQLite启动存储隔离副本.mjs';

const runtime = join(根目录, '.运行', 基线.提交);
const ts = createRequire(join(runtime, 'web/package.json'))('typescript');
function sources(directory) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(name) ? [relative(runtime, path)] : [];
  });
}
function inspectScript(path, text, lineOffset = 0) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true), findings = [];
  const record = (node, type) => findings.push({ 文件: path, 行: lineOffset + source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, 类型: type });
  function walk(node) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === 'localforage') record(node, 'localForage依赖入口');
    if (ts.isPropertyAccessExpression(node) && /^(localStorage|sessionStorage|indexedDB)$/.test(node.expression.getText(source).replace(/^(window|globalThis)\./, ''))) record(node, '浏览器存储访问');
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'persist') {
      const options = node.arguments[1];
      const storage = options && ts.isObjectLiteralExpression(options) && options.properties.some(property => property.name?.getText(source) === 'storage');
      if (!storage) record(node, 'Zustand隐式浏览器持久化');
    }
    ts.forEachChild(node, walk);
  }
  walk(source); return findings;
}
function inspect(path, text) {
  if (!path.endsWith('.html')) return inspectScript(path, text);
  return [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].flatMap(match => {
    const start = match.index + match[0].indexOf('>') + 1;
    return inspectScript(path + '.js', match[1], text.slice(0, start).split('\n').length - 1).map(item => ({ ...item, 文件: path }));
  });
}
export function 审计SQLite覆盖() {
  const { combined: files } = 启动存储批准产物(), paths = new Set([...sources(join(runtime, 'web/src')), ...files.keys()]);
  const before = [], after = [];
  for (const path of paths) {
    const item = files.get(path), original = item ? item.原文 : readFileSync(join(runtime, path), 'utf8');
    if (original !== null) before.push(...inspect(path, original));
    after.push(...inspect(path, item ? item.产物 : original));
  }
  if (after.length) throw Error('候选尚有未覆盖的浏览器存储入口：' + JSON.stringify(after));
  const result = { 上游提交: 基线.提交, 审计对象: '已批准启动后继的内存组合产物，包含HTML内联脚本', 已接管3100: false, 扫描源码文件: paths.size, 当前直接或隐式入口: before.length, 候选残留入口: after.length, 当前入口明细: before, 限制: 'AST检查直接调用、HTML内联脚本及Zustand默认persist，不证明第三方依赖或未走到的功能零持久化；须结合实际UI回归。' };
  console.log(JSON.stringify(result, null, 2)); return result;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) 审计SQLite覆盖();
