import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';
import { 安装模块取证 } from './浏览器模块取证.mjs';

if (!检查运行副本().脚本与提示词来源关闭已应用) throw Error('三项未接入');
const output = join(根目录, '.运行/output/playwright', '三项关闭-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const cli = join(根目录, 'node_modules/.bin/playwright-cli');
const session = 'guan-source-three-' + Date.now();
const source = readFileSync(join(根目录, '开发工具/浏览器三项关闭验收.mjs'), 'utf8');
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
  if (await run(['open', 'about:blank', '--headed'], '启动') !== 0) throw Error('浏览器启动失败');
  const code = await run(['run-code', '--filename', join(output, '浏览器验收.mjs')], '执行');
  await run(['--raw', 'eval', 'JSON.stringify(window.__guanThreeAcceptance ?? null)'], '读回');
  report = JSON.parse(JSON.parse(readFileSync(join(output, '读回.log'), 'utf8')));
  if (code !== 0 || !report?.passed || report.results.some(item => !item.passed)) throw Error('浏览器验收失败，保留证据');
  const config = JSON.parse(readFileSync(join(output, '合成配置.json'), 'utf8'));
  if (config.config.channels[0].models[0].script !== report.fixture.script || !config.promptSources.sources.some(s => s.id === report.fixture.source.id) || config.promptSources.schedule.intervalMinutes !== 30) throw Error('真实配置导出丢失已禁用字段');
  report.backupVerified = true;
} catch (error) { report = { ...report, passed: false, failure: error.message }; process.exitCode = 1; }
finally {
  await run(['snapshot'], '最终快照');
  await run(['screenshot', '--filename', join(output, '最终截图.png')], '截图');
  await run(['console', 'error'], '控制台');
  await run(['close'], '关闭自有浏览器');
  writeFileSync(join(output, '验收结果.json'), JSON.stringify({ ...report, session }, null, 2) + '\n');
  console.log(JSON.stringify({ output, session, ...report }, null, 2));
}
