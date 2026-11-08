import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 运行目录, 检查运行副本, 哈希 } from './检查运行副本.mjs';
import { 生成用户候选 } from './检查用户功能适配.mjs';
import { ts, 预审类型, 生成审查差异 } from './检查首批功能适配.mjs';
import { 批准差异SHA256 } from '../上游适配/用户已选功能批准.mjs';

if (!检查运行副本().用户功能关闭已应用) throw Error('必须先有完整已批准功能基线。');
const require = createRequire(join(运行目录, 'web/package.json'));
const prettier = require('prettier');
const files = [
  'web/src/components/canvas/canvas-top-bar.tsx', 'web/src/components/layout/app-top-nav.tsx',
  'web/src/constant/navigation-tools.ts', 'web/src/guan/功能开关.ts', 'web/src/guan/画布入口.tsx',
  'web/src/router.tsx', 'web/src/stores/use-theme-store.ts',
];
const delta = new Map();
const candidates = 生成用户候选();
const ast = (path, code) => {
  const walk = node => {
    if (ts.isParenthesizedExpression(node)) return walk(node.expression);
    const children = []; ts.forEachChild(node, child => {
      if (!ts.isJsxText(child) || child.text.trim()) children.push(walk(child));
    });
    const text = ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) ? node.text : ts.isJsxText(node) ? node.text.replace(/\s+/g, ' ').trim() : null;
    return [node.kind, text, children];
  };
  return walk(ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true));
};
for (const path of files) {
  const before = readFileSync(join(运行目录, path), 'utf8');
  const options = await prettier.resolveConfig(join(运行目录, path));
  const after = await prettier.format(before, { ...options, filepath: path });
  assert.deepEqual(ast(path, before), ast(path, after), '格式化改变AST结构，停止');
  delta.set(path, { 原文: before, 产物: after });
  candidates.set(path, { ...candidates.get(path), 产物: after });
}
预审类型(candidates);
const patch = 生成审查差异(delta);
const metadata = { 状态: '未批准，未应用', 前置批准差异SHA256: 批准差异SHA256, 差异SHA256: 哈希(patch), 类型预审通过: true, AST结构一致: true, 文件: [...delta].map(([文件, 项]) => ({ 文件, 原始SHA256: 哈希(项.原文), 产物SHA256: 哈希(项.产物) })) };
const dir = join(根目录, '上游适配/待审查'); mkdirSync(dir, { recursive: true });
for (const [name, content] of [['用户功能格式收口.patch', patch], ['用户功能格式收口.json', JSON.stringify(metadata, null, 2) + '\n']]) {
  const path = join(dir, name);
  if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('拒绝覆盖不同审查产物');
  if (!existsSync(path)) writeFileSync(path, content);
}
检查运行副本(); console.log(JSON.stringify(metadata, null, 2));
