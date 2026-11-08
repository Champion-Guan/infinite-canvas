import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';

if (process.argv.length !== 4) throw Error('需要质量目录和阶段5浏览器结果目录。');
const guard = 检查运行副本();
if (!guard.用户功能关闭已应用) throw Error('批准差异尚未完整接入。');
const paths = process.argv.slice(2).map(path => resolve(path));
if (paths.some(path => !path.startsWith(resolve(根目录, '.运行/output') + sep))) throw Error('只归档本项目测试结果。');
const quality = JSON.parse(readFileSync(join(paths[0], '质量结果.json')));
const browser = JSON.parse(readFileSync(join(paths[1], '验收结果.json')));
if (quality.基线.提交 !== 基线.提交 || !quality.运行副本.用户功能关闭已应用 || !browser.passed || browser.results.length !== 15 || browser.results.some(item => !item.passed) || browser.errors.length || browser.forbiddenRequests.length || !browser.zipVerified) throw Error('结果不完整，拒绝归档。');
const target = join(根目录, '开发文档/验收记录/阶段5/2026-10-15');
mkdirSync(target, { recursive: true });
for (const [name, data] of [['质量结果.json', quality], ['浏览器结果.json', browser], ['副本保护结果.json', guard]]) {
  const content = JSON.stringify(data, (_key, value) => typeof value === 'string' && value.startsWith(根目录) ? relative(根目录, value) : value, 2) + '\n';
  const path = join(target, name);
  if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('拒绝覆盖不同的验收记录。');
  if (!existsSync(path)) writeFileSync(path, content);
}
console.log('验收记录已归档：' + target);
