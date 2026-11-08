import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import js from '@eslint/js';
import globals from 'globals';
import { 根目录 } from './公共.mjs';
const record = process.argv[2];
if (process.argv.length !== 3 || !record?.startsWith(join(根目录, '.运行/凭据网关任务-')) || !record.endsWith('/凭据网关任务接入记录.json')) throw Error('只接受本批隔离记录');
const output = mkdtempSync(join(根目录, '.运行/output/凭据网关接入验收-')), runs = [];
console.log('GATEWAY_ACCEPTANCE_OUTPUT ' + output);
const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [{ files: ['**/*.mjs'], ...js.configs.recommended, languageOptions: { globals: { ...globals.node, ...globals.browser } } }] });
const results = await eslint.lintFiles(['上游适配/凭据网关任务批准.mjs', '开发工具/接入凭据网关任务隔离副本.mjs',
  '开发工具/凭据网关任务隔离保护.test.mjs', '开发工具/凭据网关任务磁盘闭环.test.mjs', '开发工具/凭据网关任务原工作台夹具.mjs',
  '开发工具/凭据网关任务浏览器命令.mjs', '开发工具/执行凭据网关任务接入验收.mjs']);
const lint = { files: results.length, errors: results.reduce((sum, item) => sum + item.errorCount, 0), warnings: results.reduce((sum, item) => sum + item.warningCount, 0) };
writeFileSync(join(output, '接入工具检查.log'), await (await eslint.loadFormatter('stylish')).format(results) + JSON.stringify(lint) + '\n', { flag: 'wx' });
if (lint.errors || lint.warnings) throw Error('接入工具代码检查未通过：' + output);
for (const [label, args] of [
  ['已批准专项57项', ['--experimental-vm-modules', '--test', '--test-concurrency=1', '开发工具/生成网关.test.mjs', '开发工具/SQLite生成任务.test.mjs', '开发工具/生成HTTP闭环.test.mjs', '开发工具/画布保存核验.test.mjs', '开发工具/凭据网关候选预审.test.mjs']],
  ['批准磁盘包闭环', ['--test', '--test-reporter=spec', '开发工具/凭据网关任务磁盘闭环.test.mjs']],
]) {
  console.log(label + '开始');
  const chunks = [], begin = Date.now();
  const status = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: 根目录, env: { ...process.env, GUAN_GATEWAY_TEST_RECORD: record }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => chunks.push(chunk)); child.stderr.on('data', chunk => chunks.push(chunk));
    child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const log = Buffer.concat(chunks).toString('utf8');
  writeFileSync(join(output, label + '.log'), log, { flag: 'wx', mode: 0o600 });
  runs.push({ label, ...status, elapsedMs: Date.now() - begin });
  if (status.code !== 0) { console.log(log.slice(-6000)); throw Error(label + '未通过；保留日志：' + output); }
  console.log(label + '通过');
}
writeFileSync(join(output, '验收报告.json'), JSON.stringify({ passed: true, record, lint, runs }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ output, lint, runs }, null, 2));
