import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';
import { 安装模块取证 } from './浏览器模块取证.mjs';

if (!检查运行副本().音视频提示词与节点信息恢复已应用) throw Error('本批尚未精确接入');
const output = join(根目录, '.运行/output/playwright', '合并恢复验收-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const cli = join(根目录, 'node_modules/.bin/playwright-cli'), session = 'guan-restored-accept-' + Date.now();
const run = (args, name, timeout = 60000) => {
  const value = spawnSync(cli, ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(join(output, name + '.log'), (value.stdout || '') + (value.stderr || ''));
  if (value.status !== 0) throw Error(name + '失败：' + (value.error?.message ?? value.status));
  return value.stdout.trim();
};
const source = readFileSync(join(根目录, '开发工具/浏览器合并恢复验收.mjs'), 'utf8').replaceAll('__ARTIFACT_DIR__', output).replace('async (page) => {', `async (page) => {\nawait (${安装模块取证.toString()})(page);`);
writeFileSync(join(output, '验收.mjs'), source);
let report;
try {
  run(['open', 'about:blank', '--headed'], '启动'); run(['snapshot'], '初始快照');
  run(['run-code', '--filename', join(output, '验收.mjs')], '执行', 180000);
  report = JSON.parse(JSON.parse(run(['eval', 'JSON.stringify(window.__guanRestoredAcceptance ?? null)'], '读回')));
  if (!report?.passed || report.results.some(item => !item.passed)) throw Error('浏览器验收未通过');
} catch (error) {
  try { report = JSON.parse(JSON.parse(run(['eval', 'JSON.stringify(window.__guanRestoredAcceptance ?? null)'], '失败读回'))); } catch { /* 原始证据保留。 */ }
  report = { ...report, passed: false, failure: error.message }; process.exitCode = 1;
} finally {
  try { run(['snapshot'], '最终快照'); run(['screenshot', '--filename', join(output, '最终截图.png')], '截图'); run(['console', 'error'], '控制台'); } finally { run(['close'], '关闭自有浏览器'); }
  writeFileSync(join(output, '验收结果.json'), JSON.stringify({ ...report, session }, null, 2) + '\n');
  console.log(JSON.stringify({ output, ...report }, null, 2));
}
