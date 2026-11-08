import { createRequire } from 'node:module';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { 根目录 } from './公共.mjs';
import { 运行目录, 检查运行副本 } from './检查运行副本.mjs';

检查运行副本();
const require = createRequire(join(运行目录, 'web/package.json'));
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild');
const output = join(根目录, '.运行/output/playwright', '首页候选-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
await esbuild.build({
  entryPoints: [join(根目录, '开发工具/首页预览入口.tsx')], outdir: output,
  bundle: true, format: 'esm', platform: 'browser', jsx: 'automatic',
  alias: { '@': join(运行目录, 'web/src') }, nodePaths: [join(运行目录, 'web/node_modules')],
  define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env': '{}' },
});
writeFileSync(join(output, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><title>首页候选隔离验收</title><link rel="stylesheet" href="/__guan_home_preview.css"><style>html,body,#root{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button{font-family:inherit}</style></head><body><div id="root"></div><script type="module" src="/__guan_home_preview.js"></script></body></html>');
const browserCode = readFileSync(join(根目录, '开发工具/浏览器首页候选验收.mjs'), 'utf8').replace("'__GUAN_PREVIEW_OUTPUT__'", JSON.stringify(output)).replace("'__GUAN_HOME_ASSETS__'", JSON.stringify(join(根目录, '界面资源/首页轮播')));
writeFileSync(join(output, '浏览器验收.mjs'), browserCode);
const session = 'guan-home-preview-' + Date.now();
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
  const code = await run(['run-code', '--filename', join(output, '浏览器验收.mjs')], '候选验收');
  await run(['--raw', 'eval', 'JSON.stringify(window.__guanHomeCandidateResult ?? null)'], '读取结果');
  report = JSON.parse(JSON.parse(readFileSync(join(output, '读取结果.log'), 'utf8')));
  if (code !== 0 || !report?.passed) throw Error('首页候选验收未全部通过，保留日志');
} catch (error) {
  report = { ...report, passed: false, failure: error.message }; process.exitCode = 1;
} finally {
  await run(['snapshot'], '结束快照');
  await run(['console', 'error'], '控制台错误');
  await run(['close'], '关闭自有浏览器');
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n');
  检查运行副本();
  console.log(JSON.stringify({ output, ...report }, null, 2));
}
