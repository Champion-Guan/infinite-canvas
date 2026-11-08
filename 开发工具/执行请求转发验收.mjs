import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';
import { 安装模块取证 } from './浏览器模块取证.mjs';
import { 建立请求转发夹具 } from './请求转发隔离夹具.mjs';
if (!检查运行副本().请求转发已恢复) throw Error('请求转发补丁尚未接入');
const exec = promisify(execFile);
const output = join(根目录, '.运行/output/playwright', '请求转发验收-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const session = 'guan-relay-' + Date.now();
const cli = join(根目录, 'node_modules/.bin/playwright-cli');
const run = async (args, name, timeout = 60000) => {
  try {
    const result = await exec(cli, ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
    writeFileSync(join(output, name + '.log'), (result.stdout || '') + (result.stderr || ''));
    return result.stdout.trim();
  } catch (error) { writeFileSync(join(output, name + '.log'), (error.stdout || '') + (error.stderr || '') + error.message); throw error; }
};
const fixture = await 建立请求转发夹具();
let report;
try {
  const source = readFileSync(join(根目录, '开发工具/浏览器请求转发验收.mjs'), 'utf8')
    .replaceAll('__ARTIFACT_DIR__', output).replaceAll('__PROXY_URL__', fixture.proxyUrl).replaceAll('__UPSTREAM_URL__', fixture.upstreamUrl)
    .replace('async (page) => {', `async (page) => {\nawait (${安装模块取证.toString()})(page);`);
  const script = join(output, '验收.mjs'); writeFileSync(script, source);
  await run(['open', 'about:blank', '--headed'], '启动'); await run(['snapshot'], '初始快照');
  await run(['run-code', '--filename', script], '执行', 180000);
  report = JSON.parse(JSON.parse(await run(['eval', 'JSON.stringify(window.__guanRelayAcceptance ?? null)'], '读回')));
  if (!report?.passed || report.results.some(item => !item.passed)) throw Error('浏览器验收未通过');
  if (fixture.requests.length !== 1 || fixture.requests[0].path !== '/v1/models' || fixture.requests[0].authorization !== 'Bearer ' + 'synthetic-fixture-only') throw Error('浏览器请求没有命中真实隔离上游或认证未透传');
  report.actualUpstream = fixture.requests.map(({ method, path }) => ({ method, path, syntheticAuthVerified: true }));
} catch (error) {
  try { report = JSON.parse(JSON.parse(await run(['eval', 'JSON.stringify(window.__guanRelayAcceptance ?? null)'], '失败读回'))); } catch { /* 原始证据保留 */ }
  report = { ...report, passed: false, failure: error.message }; process.exitCode = 1;
} finally {
  try { await run(['snapshot'], '最终快照'); await run(['console', 'error'], '控制台'); }
  finally { try { await run(['close'], '关闭自有浏览器'); } finally { await fixture.close(); } }
  writeFileSync(join(output, '验收结果.json'), JSON.stringify({ ...report, session }, null, 2) + '\n');
  console.log(JSON.stringify({ output, ...report }, null, 2));
}
