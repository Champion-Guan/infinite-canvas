import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { 根目录 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';
import { 安装模块取证 } from './浏览器模块取证.mjs';

if (!检查运行副本().首页替换已应用) throw Error('首页尚未接入。');
const output = join(根目录, '.运行/output/playwright', '首页接入-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
// addInitScript由CLI回调注入，工具模块本身不进入工作台产物。
const prelude = 安装模块取证.toString().replace(/^export /, '');
const code = readFileSync(join(根目录, '开发工具/浏览器首页接入验收.mjs'), 'utf8').replace('async (page) => {', `async (page) => {\nawait (${prelude})(page);`);
writeFileSync(join(output, '浏览器验收.mjs'), code.replace("'__GUAN_HOME_OUTPUT__'", JSON.stringify(output)));
const session = 'guan-home-live-' + Date.now();
const run = (args, name) => new Promise(resolve => {
  const log = createWriteStream(join(output, name + '.log'));
  const child = spawn(join(根目录, 'node_modules/.bin/playwright-cli'), ['--session', session, ...args], { cwd: join(根目录, '.运行'), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.on('error', error => log.write(error.message));
  child.on('close', code => log.end(() => resolve(code ?? -1)));
});
let report;
try {
  if (await run(['open', 'about:blank', '--headed'], '打开隔离浏览器') !== 0) throw Error('隔离浏览器启动失败');
  await run(['snapshot'], '初始快照');
  const code = await run(['run-code', '--filename', join(output, '浏览器验收.mjs')], '实际首页验收');
  await run(['--raw', 'eval', 'JSON.stringify(window.__guanHomeAcceptance ?? null)'], '读取结果');
  report = JSON.parse(JSON.parse(readFileSync(join(output, '读取结果.log'), 'utf8')));
  if (code !== 0 || !report?.passed) throw Error('首页真实接入验收未全部通过');
} catch (error) { report = { ...report, passed: false, failure: error.message }; process.exitCode = 1; }
finally {
  await run(['snapshot'], '结束快照');
  await run(['console', 'error'], '控制台错误');
  await run(['close'], '关闭自有浏览器');
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n');
  检查运行副本();
  console.log(JSON.stringify({ output, ...report }, null, 2));
}
