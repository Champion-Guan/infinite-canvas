import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join, resolve, relative, sep } from 'node:path';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';

检查运行副本();
if (process.argv.length !== 5) throw Error('需要依次提供质量、功能、性能结果目录。');
const 输出根 = resolve(根目录, '.运行/output/阶段4');
const 内容 = process.argv.slice(2).map((path, index) => {
  const 目录 = resolve(path);
  if (!目录.startsWith(输出根 + sep)) throw Error('只能归档本项目隔离测试的结果。');
  const 名称 = ['质量结果.json', '功能结果.json', '性能结果.json'][index];
  const result = JSON.parse(readFileSync(join(目录, 名称), 'utf8'));
  if (index === 0 && result.基线?.提交 !== 基线.提交) throw Error('质量记录不是当前上游基线。');
  if (index === 1 && (result.origin !== 基线.入口 || result.results.length !== 11 || result.results.some(r => !r.passed) || result.errors.length)) throw Error('功能基线不完整或失败。');
  if (index === 2 && (result.browser?.origin !== 基线.入口 || result.samples.length !== 36 || result.samples.some(s => !s.gestureVerified) || result.errors.length)) throw Error('性能手势未验证或采样不完整。');
  // 生成可携带的记录：本机日志绝对路径改为相对此开发仓库的路径。
  const text = JSON.stringify(result, (_, value) => typeof value === 'string' && value.startsWith(根目录) ? relative(根目录, value) : value, 2) + '\n';
  return { 名称, text };
});
// 按性能采样批次留不可覆盖的记录，重测不会替换之前结果。
const 目标 = join(根目录, '开发文档/基线记录', 基线.版本, basename(resolve(process.argv[4])));
for (const item of 内容) {
  const path = join(目标, item.名称);
  if (existsSync(path) && readFileSync(path, 'utf8') !== item.text) throw Error('已有不同基线记录，拒绝覆盖：' + item.名称);
}
mkdirSync(目标, { recursive: true });
for (const item of 内容) writeFileSync(join(目标, item.名称), item.text);
console.log('已归档合成数据基线：' + 目标);
