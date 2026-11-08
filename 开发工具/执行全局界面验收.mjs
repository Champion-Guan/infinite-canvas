import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';
import { 安装模块取证 } from './浏览器模块取证.mjs';

if (!检查运行副本().全局界面恢复已应用) throw Error('全局界面尚未接入');
const output = join(根目录, '.运行/output/playwright', '全局界面恢复-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const cli = join(根目录, 'node_modules/.bin/playwright-cli');
const session = 'guan-global-accept-' + Date.now();
const source = readFileSync(join(根目录, '开发工具/浏览器全局界面验收.mjs'), 'utf8');
writeFileSync(join(output, '浏览器验收.mjs'), source.replaceAll('__ARTIFACT_DIR__', output).replace('async (page) => {', `async (page) => {\nawait (${安装模块取证.toString()})(page);`));
const run = (args, name) => new Promise(done => {
  const log = createWriteStream(join(output, name + '.log'));
  const child = spawn(cli, ['--session', session, ...args], { cwd: join(根目录, '.运行'), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.on('error', error => log.write(error.message));
  child.on('close', code => log.end(() => done(code ?? -1)));
});
let report;
try {
  if (await run(['open', 'about:blank', '--headed'], '启动') !== 0) throw Error('独立浏览器启动失败');
  await run(['snapshot'], '初始快照');
  const code = await run(['run-code', '--filename', join(output, '浏览器验收.mjs')], '执行');
  await run(['--raw', 'eval', 'JSON.stringify(window.__guanGlobalAcceptance ?? null)'], '读回');
  report = JSON.parse(JSON.parse(readFileSync(join(output, '读回.log'), 'utf8')));
  if (code !== 0 || !report?.passed || report.results.some(item => !item.passed)) throw Error('全局界面浏览器验收未通过，证据已保留');
} catch (error) { report = { ...report, passed: false, failure: error.message }; process.exitCode = 1; }
finally {
  await run(['snapshot'], '最终快照');
  await run(['screenshot', '--filename', join(output, '最终截图.png')], '截图');
  await run(['console', 'error'], '控制台');
  await run(['close'], '关闭自有浏览器');
  writeFileSync(join(output, '验收结果.json'), JSON.stringify({ ...report, session }, null, 2) + '\n');
  console.log(JSON.stringify({ output, session, ...report }, null, 2));
}
