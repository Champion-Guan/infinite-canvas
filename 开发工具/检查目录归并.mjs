import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { 装配开发源码, 读取源码映射 } from './装配开发源码.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const active = join(root, '.运行/3100源'), web = join(active, '画布副本/web');
const result = 装配开发源码({ root, checkOnly: true }), mapping = 读取源码映射(root);
const files = new Set([
  ...mapping.文件.map(item => join(active, item.目标)),
  ...mapping.接入差异.map(item => join(active, '画布副本', item.目标)),
]);
let references = 0;
for (const file of files) {
  if (!['.ts', '.tsx', '.js', '.mjs', '.html'].includes(extname(file))) continue;
  const content = readFileSync(file, 'utf8');
  assert.ok(!/@\/guan\/|\/src\/guan\//.test(content), '仍引用旧前端挂载：' + file);
  // 只解析源码模块引用，不把提示词、资源URL或历史文档当作依赖。
  for (const match of content.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)(["'])([^"'\r\n]+)\1/g)) {
    const spec = match[2].split('?')[0];
    const candidate = spec.startsWith('@/') ? join(web, 'src', spec.slice(2))
      : spec.startsWith('/src/') ? join(web, spec.slice(1))
      : spec.startsWith('.') ? resolve(dirname(file), spec) : null;
    if (!candidate) continue;
    references++;
    assert.ok([candidate, ...['.ts', '.tsx', '.js', '.mjs', '.d.ts', '/index.ts', '/index.tsx', '/index.js'].map(suffix => candidate + suffix)].some(existsSync), '引用目标缺失：' + file + ' → ' + spec);
  }
}
console.log(JSON.stringify({ ...result, 校验引用: references, 旧前端引用: 0, 根目录独立来源: new Set(mapping.文件.map(item => item.来源)).size, 顺序接入补丁: mapping.接入补丁.length }, null, 2));
