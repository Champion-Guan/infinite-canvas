import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import js from '@eslint/js';
import globals from 'globals';
import { 根目录 } from './公共.mjs';
import { reviewCombinedCandidate, buildCombinedCandidate } from './预审代理与Fallback闭环.mjs';

if (process.argv.length !== 2) throw Error('本工具只验证候选，不接受端口、数据根或接入参数');
const output = mkdtempSync(join(根目录, '.运行/output/代理Fallback预审-')), runs = [];
console.log('FALLBACK_REVIEW_OUTPUT ' + output);
async function run(label, binary, args) {
  const chunks = [], begin = Date.now();
  const status = await new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: 根目录, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', value => chunks.push(value)); child.stderr.on('data', value => chunks.push(value));
    child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const text = Buffer.concat(chunks).toString('utf8');
  writeFileSync(join(output, label + '.log'), text, { flag: 'wx', mode: 0o600 });
  runs.push({ label, ...status, elapsedMs: Date.now() - begin });
  if (status.code !== 0) { console.log(text.slice(-8000)); throw Error(label + '失败，证据保留：' + output); }
  console.log(label + '通过'); return text;
}
const before = await run('3100前态只读监听', '/usr/sbin/lsof', ['-nP', '-iTCP:3100', '-sTCP:LISTEN', '-Fpcn']);
await run('保护检查前', process.execPath, ['开发工具/检查运行副本.mjs']);
await run('Fallback专项', process.execPath, ['--test', '--test-reporter=spec', '开发工具/代理与Fallback闭环.test.mjs']);
await run('代理与图片原回归', process.execPath, ['--test', '--test-reporter=spec', '--test-concurrency=1', '开发工具/内置网络代理.test.mjs', '开发工具/原画布图片闭环.test.mjs']);
await run('生成与保存原回归', process.execPath, ['--test', '--test-reporter=spec', '--test-concurrency=1', '开发工具/生成网关.test.mjs', '开发工具/SQLite生成任务.test.mjs', '开发工具/生成HTTP闭环.test.mjs', '开发工具/画布保存核验.test.mjs']);
const lintJS = new ESLint({ overrideConfigFile: true, overrideConfig: [js.configs.recommended, { languageOptions: { globals: { ...globals.node, ...globals.browser } } }] });
const lintTS = new ESLint({ overrideConfigFile: join(根目录, '开发工具/代码检查配置.mjs') });
const results = await lintJS.lintFiles(['扩展功能/故障切换/*.mjs', '开发工具/预审代理与Fallback闭环.mjs', '开发工具/代理与Fallback闭环.test.mjs', '开发工具/执行代理与Fallback预审.mjs']);
results.push(...await lintTS.lintFiles(['扩展功能/故障切换/*.ts', '扩展功能/故障切换/*.tsx']));
// 检查真正交付的内存产物，不以自有源文件通过代替转换结果通过。
const preview = buildCombinedCandidate();
for (const [path, value] of preview.delta) {
  if (path.endsWith('.mjs')) results.push(...await lintJS.lintText(value.产物, { filePath: '扩展功能/故障切换/候选-' + path.split('/').at(-1) }));
  if (/\.tsx?$/.test(path)) results.push(...await lintTS.lintText(value.产物, { filePath: '扩展功能/故障切换/候选-' + path.split('/').at(-1) }));
}
const lint = { files: results.length, errors: results.reduce((n, r) => n + r.errorCount, 0), warnings: results.reduce((n, r) => n + r.warningCount, 0) };
writeFileSync(join(output, '代码检查.log'), await (await lintJS.loadFormatter('stylish')).format(results) + JSON.stringify(lint) + '\n', { flag: 'wx', mode: 0o600 });
if (lint.errors || lint.warnings) throw Error('代码检查未通过：' + output);
console.log('自有源码及实际候选代码检查通过');
const manifest = reviewCombinedCandidate(false);
writeFileSync(join(output, '虚拟类型与候选.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log('完整虚拟类型检查通过');
await run('保护检查后', process.execPath, ['开发工具/检查运行副本.mjs']);
const after = await run('3100后态只读监听', '/usr/sbin/lsof', ['-nP', '-iTCP:3100', '-sTCP:LISTEN', '-Fpcn']);
if (after !== before) throw Error('3100监听发生改变，保留证据；本工具未对其执行控制操作');
const report = { passed: true, output, runs, lint, fileCount: manifest.文件数, patchSHA256: manifest.差异SHA256, virtualTypesPassed: true,
  realLocalCONNECTTLS: true, realMihomo: false, realPaidProvider: false, realSubscription: false, browserVisualVerified: false, candidateIntegrated: false, daily3100Changed: false };
writeFileSync(join(output, '预审报告.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
