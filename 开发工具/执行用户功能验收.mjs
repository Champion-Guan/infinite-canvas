import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { 根目录 } from './公共.mjs';
import { 运行目录, 检查运行副本 } from './检查运行副本.mjs';
import { 安装模块取证 } from './浏览器模块取证.mjs';

const state = 检查运行副本();
if (!state.用户功能关闭已应用) throw Error('尚未接入批准差异。');
const output = join(根目录, '.运行/output/playwright', '阶段5-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const session = 'guan-stage5-' + Date.now();
const cli = join(根目录, 'node_modules/.bin/playwright-cli');
const 浏览器原文 = readFileSync(join(根目录, '开发工具/浏览器用户功能验收.mjs'), 'utf8');
// 测试取证模块沿已加载的Vite指纹导入，不重复初始化页面store。
const 浏览器产物 = 浏览器原文.replaceAll("await import('/src/", "await window.__guanImport('/src/").replace('async (page) => {', `async (page) => {\nawait (${安装模块取证.toString()})(page);`);
writeFileSync(join(output, '浏览器验收.mjs'), 浏览器产物);
const run = (args, name) => new Promise(resolve => {
  const stream = createWriteStream(join(output, name + '.log'));
  const child = spawn(cli, ['--session', session, ...args], { cwd: join(根目录, '.运行'), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false });
  child.on('error', error => stream.write(error.message));
  child.on('close', code => stream.end(() => resolve(code ?? -1)));
});
let report;
try {
  if (await run(['open', 'about:blank', '--headed'], '打开隔离浏览器') !== 0) throw Error('浏览器启动失败');
  const code = await run(['run-code', '--filename', join(output, '浏览器验收.mjs')], '验收原始');
  await run(['--raw', 'eval', 'JSON.stringify(window.__guanSelectionAcceptance ?? null)'], '读取结果');
  report = JSON.parse(JSON.parse(readFileSync(join(output, '读取结果.log'), 'utf8')));
  if (code !== 0 || !report?.results.length || report.results.some(item => !item.passed) || report.errors.length) throw Error('浏览器验收存在失败，保留现场和日志。');
  const require = createRequire(join(运行目录, 'web/package.json'));
  const { unzipSync } = require('fflate');
  const zip = unzipSync(readFileSync(join(根目录, '.运行/output/playwright/阶段5-合成画布.zip')));
  const exported = JSON.parse(Buffer.from(zip['projects.json']).toString('utf8'));
  const project = exported.projects.find(p => p.project.id === report.fixture.id);
  if (!project || project.project.nodes.length !== 4 || project.project.connections.length !== 2) throw Error('实际ZIP结构不符');
  const image = project.files.find(item => item.storageKey.startsWith('image:'));
  const bytes = zip[image?.path];
  if (!bytes || bytes.length !== report.fixture.imageBytes || createHash('sha256').update(bytes).digest('hex') !== report.fixture.imageSha256) throw Error('实际ZIP图片不完整');
  if (project.project.nodes.find(n => n.id === 'select-missing')?.metadata.customValue !== 123) throw Error('实际ZIP丢失插件数据');
  report.zipVerified = { nodes: 4, connections: 2, imageBytes: bytes.length, imageSha256: report.fixture.imageSha256, pluginMetadataRetained: true };
  report.passed = true;
} catch (error) {
  report = { ...report, passed: false, failure: error.message };
  process.exitCode = 1;
} finally {
  await run(['snapshot'], '结束快照');
  await run(['screenshot', '--filename', join(output, '验收截图.png')], '截图');
  await run(['console', 'error'], '控制台错误');
  await run(['close'], '关闭自有浏览器');
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n');
  检查运行副本();
  console.log(JSON.stringify({ output, passed: report?.passed, failure: report?.failure, results: report?.results, errors: report?.errors, forbiddenRequests: report?.forbiddenRequests, zipVerified: report?.zipVerified }, null, 2));
}
