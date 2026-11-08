import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';

if (!检查运行副本().全局界面恢复已应用) throw Error('全局界面恢复尚未完整接入');
const reference = join(根目录, '.运行/output/playwright/首页顶栏原样对照-2026-10-16T01-14-40.967Z');
const old = JSON.parse(readFileSync(join(reference, '同尺寸对照.json'), 'utf8')).old;
const output = join(根目录, '.运行/output/playwright', '全局界面视觉复验-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const session = 'guan-global-visual-' + Date.now();
const cli = join(根目录, 'node_modules/.bin/playwright-cli');
const run = (args, name) => {
  const result = spawnSync(cli, ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), encoding: 'utf8', timeout: 45_000 });
  writeFileSync(join(output, name + '.log'), (result.stdout || '') + (result.stderr || ''));
  if (result.status !== 0) throw Error(name + '失败，保留日志：' + output);
  return result.stdout.trim();
};
const compare = readFileSync(join(根目录, '开发工具/浏览器首页原样对照.mjs'), 'utf8').replace('__OUTPUT__', output);
const callback = join(output, '同尺寸复验.mjs');
writeFileSync(callback, `async (page) => {
  if (page.url() !== 'about:blank') throw Error('必须使用全新隔离浏览器');
  await page.context().route('**/*', route => new URL(route.request().url()).origin === 'http://localhost:3100' ? route.continue() : route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('infinite-canvas:theme_store', JSON.stringify({state:{theme:'dark'},version:0}));
    const ids = ['banana-prompt-quicker','davidwu-gpt-image2-prompts','freestylefly-gpt-image-2','awesome-gpt-image','awesome-gpt4o-image-prompts','youmind-gpt-image-2','youmind-nano-banana-pro'];
    localStorage.setItem('infinite-canvas:prompt_source_store_v2', JSON.stringify({state:{sources:ids.map(id=>({id,builtIn:true,enabled:false})),schedule:{intervalMinutes:0,lastFetchedAt:''}},version:0}));
  });
  await page.goto('http://localhost:3100/', {waitUntil:'domcontentloaded'});
  await page.getByRole('banner', {name:'工作台顶栏',exact:true}).waitFor();
  return (${compare})(page);
}`);
try {
  run(['open', 'about:blank', '--headed'], '启动');
  run(['snapshot'], '初始快照');
  const current = JSON.parse(run(['run-code', '--filename', callback], '同尺寸测量'));
  const deltas = Object.fromEntries(Object.entries(old.areas).map(([name, rect]) => [name, Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, current.areas[name][key] - rect[key]]))]));
  const imageFramesEqual = old.images.length === current.images.length && old.images.every((img, i) => ['alt', 'fit', 'naturalWidth', 'naturalHeight'].every(key => img[key] === current.images[i][key]) && ['width', 'height'].every(key => Math.abs(img[key] - current.images[i][key]) < .01));
  const layoutEqual = Object.values(deltas).every(rect => Object.values(rect).every(delta => Math.abs(delta) < .01));
  const report = { reference, old, current, deltas, layoutEqual, imageFramesEqual, toleranceCssPixels: .01, limitation: '旧参照使用已归档的旧实现截图和测量；不运行旧后端、不读取用户数据。此检查证明布局和图片尺寸，不宣称所有旧业务已经迁入或颜色逐像素相同。' };
  copyFileSync(join(reference, '旧首页-深色.png'), join(output, '旧首页-深色.png'));
  writeFileSync(join(output, '同尺寸对照.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, deltas, layoutEqual, imageFramesEqual }, null, 2));
  if (!layoutEqual || !imageFramesEqual) process.exitCode = 1;
} finally {
  run(['snapshot'], '最终快照');
  run(['close'], '关闭自有浏览器');
}
