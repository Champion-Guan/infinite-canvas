import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { 根目录 } from './公共.mjs';

const output = join(根目录, '.运行/output/playwright', '首页顶栏原样对照-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const code = readFileSync(join(根目录, '开发工具/浏览器首页原样对照.mjs'), 'utf8').replace('__OUTPUT__', output);
const callback = join(output, '只读同尺寸对照.mjs');
writeFileSync(callback, code);
const run = session => {
  const r = spawnSync(join(根目录, 'node_modules/.bin/playwright-cli'), ['-s=' + session, '--raw', 'run-code', '--filename', callback], { cwd: 根目录, encoding: 'utf8', timeout: 45000 });
  writeFileSync(join(output, session + '.log'), r.stdout + '\n' + r.stderr);
  if (r.status !== 0) throw Error('首页对照失败：' + session + '\n' + r.stdout + r.stderr);
  return JSON.parse(r.stdout.trim());
};
const old = run('guan-home-original'), current = run('guan-home-check');
const deltas = Object.fromEntries(Object.entries(old.areas).map(([selector, rect]) => [selector, Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, current.areas[selector][key] - rect[key]]))]));
const imageDeltas = old.images.map((img, i) => ({ width: current.images[i].width - img.width, height: current.images[i].height - img.height, metadataEqual: ['alt', 'fit', 'naturalWidth', 'naturalHeight'].every(key => current.images[i][key] === img[key]) }));
const layoutEqual = Object.values(deltas).every(rect => Object.values(rect).every(value => Math.abs(value) < .01));
const report = { old, current, deltas, imageDeltas, layoutEqual, imageFramesEqual: imageDeltas.every(item => item.metadataEqual && Math.abs(item.width) < .01 && Math.abs(item.height) < .01), measurementToleranceCssPixels: .01, limitation: '导入、Excel、回收站业务尚未迁入；主题切换按已选功能策略禁用。测量只证明记录的布局与图片一致，不表示全部旧业务完成。' };
writeFileSync(join(output, '同尺寸对照.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output, deltas, layoutEqual, imageFramesEqual: report.imageFramesEqual, limitation: report.limitation }, null, 2));
if (!layoutEqual || !report.imageFramesEqual) process.exitCode = 1;
