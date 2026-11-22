import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { 装配开发源码 } from './装配开发源码.mjs';
import { 准备开发构建环境 } from './准备开发构建环境.mjs';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const baseline = JSON.parse(readFileSync(join(root, '上游基线.json'), 'utf8'));
const upstream = join(process.env.RUNNER_TEMP || root, 'infinite-canvas-upstream');
const fixture = join(root, '.运行/3100源');
const runtime = join(root, '.运行/开发版3100');

if (!existsSync(join(upstream, '.git'))) {
  execFileSync('git', ['clone', '--filter=blob:none', '--no-checkout', baseline.仓库, upstream], { stdio: 'inherit' });
}
const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: upstream, encoding: 'utf8' }).trim();
assert.equal(origin, baseline.仓库, 'CI 上游仓库不匹配');
execFileSync('git', ['fetch', '--depth=1', 'origin', baseline.提交], { cwd: upstream, stdio: 'inherit' });

const fixtureModules = join(fixture, '画布副本/web/node_modules');
if (existsSync(fixtureModules) && lstatSync(fixtureModules).isSymbolicLink() &&
    resolve(fixture, readlinkSync(fixtureModules)) === resolve(root, 'src/canvas/node_modules')) {
  unlinkSync(fixtureModules);
}
装配开发源码({ root, activeDirectory: fixture, runtimeDirectory: runtime, upstreamDirectory: upstream });
await 准备开发构建环境({
  root,
  web: join(fixture, '画布副本/web'),
  upstream,
  commit: baseline.提交,
});
