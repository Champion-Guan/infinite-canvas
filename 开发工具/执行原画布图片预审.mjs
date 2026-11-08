import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ESLint } from 'eslint';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import { 根目录 } from './公共.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 构建原画布图片闭环候选, 预审原画布图片闭环 } from './预审原画布图片闭环.mjs';

// 只保存预审证据；候选只在CompilerHost/VM内。此工具没有接入、启动或发布选项。
if (process.argv.length !== 2) throw Error('预审不接受接入、启动或发布参数');
const output = mkdtempSync(join(根目录, '.运行/output/原画布图片预审-'));
const results = [];
function run(name, args) {
  const result = spawnSync(process.execPath, args, { cwd: 根目录, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  const log = (result.stdout || '') + (result.stderr || '');
  const file = join(output, name + '.log'); writeFileSync(file, log, { flag: 'wx', mode: 0o600 });
  const tests = log.match(/(?:ℹ |# )tests (\d+)/)?.[1];
  results.push({ 检查: name, 退出码: result.status, 日志: file, SHA256: 哈希(log), ...(tests ? { 测试数: Number(tests) } : {}) });
  if (result.status !== 0) throw Error(name + '未通过，现场保留：' + output);
}
run('图片闭环专项', ['--test', '开发工具/原画布图片闭环.test.mjs']);
run('既有网关任务回归', ['--test', '开发工具/生成网关.test.mjs', '开发工具/SQLite生成任务.test.mjs', '开发工具/生成HTTP闭环.test.mjs']);
const ownLint = new ESLint({ cwd: 根目录, overrideConfigFile: true, overrideConfig: [js.configs.recommended, { languageOptions: { globals: { ...globals.node, ...globals.browser } } }] });
const own = await ownLint.lintFiles(['扩展功能/画布生成/*.mjs', '开发工具/构建原版图片协议.mjs', '开发工具/预审原画布图片闭环.mjs', '开发工具/原画布图片闭环.test.mjs', '开发工具/执行原画布图片预审.mjs']);
writeFileSync(join(output, '自有代码检查.json'), JSON.stringify(own, null, 2), { flag: 'wx', mode: 0o600 });
if (own.some(item => item.errorCount || item.warningCount)) throw Error('自有代码检查不通过：' + output);
const preview = 构建原画布图片闭环候选();
const lint = new ESLint({ cwd: 根目录, overrideConfigFile: true, overrideConfig: [
  ...tseslint.configs.recommended,
  { files: ['**/*.{ts,tsx}'], languageOptions: { globals: globals.browser }, plugins: { 'react-hooks': hooks },
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' } },
] });
const differences = [];
for (const [path, item] of preview.delta) {
  if (!/\.tsx?$/.test(path)) continue;
  // 使用自有虚拟文件名，禁止在封存运行包写文件；不运行eslint --fix。
  const filePath = join(根目录, '开发工具/虚拟预审', path);
  const after = (await lint.lintText(item.产物, { filePath }))[0];
  const before = item.原文 === null ? { messages: [] } : (await lint.lintText(item.原文, { filePath }))[0];
  const signature = message => JSON.stringify([message.ruleId, message.message, message.nodeType, message.severity]);
  const counts = new Map();
  for (const message of before.messages) counts.set(signature(message), (counts.get(signature(message)) || 0) + 1);
  const added = after.messages.filter(message => { const key = signature(message), count = counts.get(key) || 0; if (count) { counts.set(key, count - 1); return false; } return true; });
  differences.push({ 文件: path, 既有诊断数: before.messages.length, 候选诊断数: after.messages.length, 新增诊断: added });
}
writeFileSync(join(output, 'React增量检查.json'), JSON.stringify(differences, null, 2), { flag: 'wx', mode: 0o600 });
if (differences.some(item => item.新增诊断.length)) throw Error('React增量检查有新增问题：' + output);
const manifest = 预审原画布图片闭环(false);
const report = { 日期: '2026-10-20', 差异SHA256: manifest.差异SHA256, 文件数: manifest.文件数, 检查: results,
  自有Lint文件数: own.length, 自有Lint错误及警告: 0, React增量诊断: 0, 完整虚拟类型检查通过: true,
  候选仅内存: true, 候选磁盘接入: false, 真实浏览器验收: false, 已修改日常3100: false,
  真实凭据或付费API: false, 测试服务器: '既有模块测试仅使用随机loopback模拟服务，测试后正常关闭',
  工具SHA256: 哈希(readFileSync(new URL(import.meta.url))) };
writeFileSync(join(output, '预审报告.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ 证据目录: output, ...report }, null, 2));
