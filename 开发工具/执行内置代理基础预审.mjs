import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import js from '@eslint/js';
import globals from 'globals';
import { 根目录 } from './公共.mjs';
import { 预审内置网络代理 } from './预审内置网络代理.mjs';

// 只验证自有候选和既有批准前置，不生成/接入运行副本，不打开日常数据根。
if (process.argv.length !== 2) throw Error('本工具不接受接入、端口或用户数据参数');
const output = mkdtempSync(join(根目录, '.运行/output/内置代理基础预审-')), runs = [];
console.log('PROXY_REVIEW_OUTPUT ' + output);
async function run(label, binary, args) {
  const chunks = [], begin = Date.now();
  const status = await new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: 根目录, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => chunks.push(chunk)); child.stderr.on('data', chunk => chunks.push(chunk));
    child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const text = Buffer.concat(chunks).toString('utf8');
  writeFileSync(join(output, label + '.log'), text, { flag: 'wx', mode: 0o600 });
  runs.push({ label, ...status, elapsedMs: Date.now() - begin });
  if (status.code !== 0) { console.log(text.slice(-6000)); throw Error(label + '失败，日志保留：' + output); }
  console.log(label + '通过'); return text;
}
const beforeDaily = await run('3100前态只读监听', '/usr/sbin/lsof', ['-nP', '-iTCP:3100', '-sTCP:LISTEN', '-Fpcn']);
await run('保护检查前', process.execPath, ['开发工具/检查运行副本.mjs']);
await run('代理专项', process.execPath, ['--test', '--test-reporter=spec', '开发工具/内置网络代理.test.mjs']);
await run('既有生成与保存专项', process.execPath, ['--test', '--test-reporter=spec', '--test-concurrency=1',
  '开发工具/生成网关.test.mjs', '开发工具/SQLite生成任务.test.mjs', '开发工具/生成HTTP闭环.test.mjs', '开发工具/画布保存核验.test.mjs']);
const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [js.configs.recommended, { languageOptions: { globals: { ...globals.node, ...globals.browser } } }] });
const results = await eslint.lintFiles(['扩展功能/网络代理/*.mjs', '开发工具/内置网络代理.test.mjs', '开发工具/内置代理模拟核心.mjs', '开发工具/预审内置网络代理.mjs', '开发工具/执行内置代理基础预审.mjs']);
const tsLint = new ESLint({ overrideConfigFile: join(根目录, '开发工具/代码检查配置.mjs') });
results.push(...await tsLint.lintFiles(['扩展功能/网络代理/原版网络代理面板.tsx']));
const lint = { files: results.length, errors: results.reduce((sum, item) => sum + item.errorCount, 0), warnings: results.reduce((sum, item) => sum + item.warningCount, 0) };
writeFileSync(join(output, '代码检查.log'), await (await eslint.loadFormatter('stylish')).format(results) + JSON.stringify(lint) + '\n', { flag: 'wx', mode: 0o600 });
if (lint.errors || lint.warnings) throw Error('代码检查未通过，保留日志：' + output);
console.log('代码检查通过');
const manifest = 预审内置网络代理(false);
writeFileSync(join(output, '虚拟类型与候选.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
await run('保护检查后', process.execPath, ['开发工具/检查运行副本.mjs']);
const afterDaily = await run('3100后态只读监听', '/usr/sbin/lsof', ['-nP', '-iTCP:3100', '-sTCP:LISTEN', '-Fpcn']);
if (afterDaily !== beforeDaily) throw Error('3100监听状态改变，保留证据；本工具未对日常服务执行写入或控制');
const report = { passed: true, output, lint, runs, fileCount: manifest.文件数, patchSHA256: manifest.差异SHA256,
  virtualTypesPassed: true, oldSourceAndCSSVerified: true, realMihomo: false, realSubscription: false, browserVisualVerified: false,
  candidateIntegrated: false, gatewayImageConnected: false, daily3100Changed: false };
writeFileSync(join(output, '预审报告.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
