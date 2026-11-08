import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { 根目录 } from './公共.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 读取Excel删除字体平滑隔离记录 } from './接入Excel删除字体平滑隔离副本.mjs';
import { 网关任务前置, 预审凭据网关任务 } from './预审凭据网关任务端口.mjs';

const newOnly = process.argv.length === 3 && process.argv[2] === '--仅复核新增';
if (process.argv.length !== 2 && !newOnly) throw Error('预审只接受固定的仅复核新增标志，不接受数据根、凭据、接入、启动或重启参数');
const output = mkdtempSync(join(根目录, '.运行/output/凭据网关预审-'));
const listener = () => spawnSync('lsof', ['-t', '-nP', '-iTCP:3100', '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout.trim();
const before = listener();
读取Excel删除字体平滑隔离记录(网关任务前置);
const runs = [];
const run = async (name, args, timeout = 180_000) => {
  console.log(name + '开始；证据目录：' + output);
  const begin = Date.now();
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: 根目录, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let bytes = 0, error = null, timedOut = false, limitExceeded = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeout);
    const collect = chunk => {
      bytes += chunk.length;
      if (bytes <= 32 * 1024 * 1024) chunks.push(chunk);
      else { limitExceeded = true; child.kill('SIGTERM'); }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', value => { error = value.code || value.message; });
    child.once('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, error, timedOut, limitExceeded, text: Buffer.concat(chunks).toString('utf8') }); });
  });
  const { text, ...diagnostic } = result;
  const entry = { name, args, timeoutMs: timeout, elapsedMs: Date.now() - begin, ...diagnostic };
  runs.push(entry);
  writeFileSync(join(output, name + '.log'), text, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(output, name + '.执行.json'), JSON.stringify(entry, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  if (result.status !== 0 || result.error || result.timedOut || result.limitExceeded) throw Error(name + '未通过；保留日志和退出原因：' + output);
  console.log(name + '通过'); return text;
};
await run('新增代码检查', ['开发工具/检查凭据网关代码.mjs']);
const added = await run('新增专项与候选内存预审', ['--experimental-vm-modules', '--test', '--test-concurrency=1',
  '开发工具/生成网关.test.mjs', '开发工具/SQLite生成任务.test.mjs', '开发工具/生成HTTP闭环.test.mjs', '开发工具/画布保存核验.test.mjs', '开发工具/凭据网关候选预审.test.mjs']);
const regressions = [];
for (const [name, args, timeout] of [
  ['既有凭据及写入协调回归', ['--test', '--test-concurrency=1', '开发工具/SQLite凭据保管.test.mjs', '开发工具/SQLite凭据链路.test.mjs', '开发工具/写入协调.test.mjs'], 180_000],
  // 历史原测试把66个受真实限流的场景塞入单一60秒窗口，已有两次超时证据。
  // 保留原文件/阈值，明确排除这一条；下面另跑既有独立矩阵，不把排除项算作通过。
  ['既有分片存储回归', ['--test', '--test-concurrency=1', '--test-skip-pattern=^所有实际块与根写入边界的前/后故障均不发布半代，原请求重试不重复revision$', '开发工具/SQLite分片存储.test.mjs'], 300_000],
  // 外层容纳全部矩阵；每个故障场景原有60秒上限和96/10050ms预算均不变。
  ['既有分片故障矩阵', ['--test', '--test-concurrency=1', '开发工具/SQLite分片故障矩阵.test.mjs'], 600_000],
]) if (!newOnly) regressions.push(await run(name, args, timeout));
const preview = 预审凭据网关任务(false);
writeFileSync(join(output, '候选清单预览.json'), JSON.stringify(preview, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
读取Excel删除字体平滑隔离记录(网关任务前置);
const after = listener(); if (before !== after) throw Error('3100监听状态变化，请只读核对；预审未执行启停');
const count = (text, label) => Number(text.match(new RegExp('(?:ℹ|#) ' + label + ' (\\d+)'))?.[1] ?? NaN);
const report = { date: new Date().toISOString(), passed: true, newTests: count(added, 'pass'), regressionTests: regressions.reduce((sum, text) => sum + count(text, 'pass'), 0),
  regressionSkipped: regressions.reduce((sum, text) => sum + count(text, 'skipped'), 0),
  regressionExcluded: newOnly ? 0 : 1, // Node24的skip-pattern不把未运行条目计入skipped，单独登记。
  regressionScope: newOnly ? '仅复核新增代码及完整候选；未在本次重复运行既有回归，须结合单独记录' : '既有凭据/写入协调/分片；历史单60秒串行故障条目跳过1项，独立矩阵全部运行，不是全项目回归全绿', deltaSHA256: preview.差异SHA256,
  files: preview.文件数, active3100Before: before, active3100After: after, active3100Changed: false, realProviderCalled: false, keychainAccessed: false,
  runtimePackageModified: false, authorCoreModified: false, originalCanvasGenerationConnected: false,
  runs, logs: runs.map(({ name }) => name + '.log').map(file => ({ file, sha256: 哈希(readFileSync(join(output, file))) })) };
if (!Number.isInteger(report.newTests) || !Number.isInteger(report.regressionTests) || report.regressionSkipped !== 0 || regressions.some(text => count(text, 'fail') !== 0 || count(text, 'cancelled') !== 0)) throw Error('测试计数无法核实');
writeFileSync(join(output, '预审报告.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ output, ...report }, null, 2));
