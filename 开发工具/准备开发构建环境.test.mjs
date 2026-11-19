import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 准备开发构建环境 } from './准备开发构建环境.mjs';

test('冷启动补齐缺失基线，不覆盖已有装配源码；依赖安装失败不留下成功回执', async t => {
  const root = mkdtempSync(join(tmpdir(), '开发构建恢复-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const upstream = join(root, '作者'), web = join(root, '运行/画布副本/web');
  mkdirSync(join(upstream, 'web/src'), { recursive: true });
  mkdirSync(join(root, '开发工具'));
  mkdirSync(join(web, 'src'), { recursive: true });
  mkdirSync(join(root, '.运行/3100源'), { recursive: true });
  execFileSync('git', ['init', '-q', upstream]);
  writeFileSync(join(upstream, 'web/src/保留.ts'), 'baseline');
  writeFileSync(join(upstream, 'web/src/缺失.ts'), 'restored');
  writeFileSync(join(upstream, 'web/vite.config.ts'), 'config');
  execFileSync('git', ['add', '.'], { cwd: upstream });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], { cwd: upstream });
  writeFileSync(join(web, 'src/保留.ts'), 'assembled');
  writeFileSync(join(root, '开发工具/Web前端依赖.json'), '{"type":"module"}');
  writeFileSync(join(root, '开发工具/Web前端依赖锁.json'), '{"lockfileVersion":3}');
  writeFileSync(join(root, '开发工具/Web运行依赖.json'), '{"type":"module"}');
  writeFileSync(join(root, '开发工具/Web运行依赖锁.json'), '{"lockfileVersion":3}');
  let installs = 0;
  const options = { root, web, upstream, commit: 'HEAD', run: async (_command, args, options) => {
    installs++;
    assert.ok(args.includes('--ignore-scripts'));
    assert.ok(args.includes('--fetch-retries=6'));
    assert.ok(args.includes('--fetch-timeout=120000'));
    assert.equal(options.reserveBytes, 3 * 1024 ** 3);
    throw Error('fixture-install-failed');
  } };
  await assert.rejects(准备开发构建环境(options), /fixture-install-failed/);
  assert.equal(readFileSync(join(web, 'src/保留.ts'), 'utf8'), 'assembled');
  assert.equal(readFileSync(join(web, 'src/缺失.ts'), 'utf8'), 'restored');
  assert.equal(readFileSync(join(web, 'vite.config.ts'), 'utf8'), 'config');
  assert.equal(existsSync(join(web, 'node_modules/.开发依赖指纹')), false);
  await assert.rejects(准备开发构建环境(options), /fixture-install-failed/);
  assert.equal(installs, 2);
});

test('前端与服务运行依赖分别按锁文件安装，并在完整后续启动中复用', async t => {
  const root = mkdtempSync(join(tmpdir(), '开发与运行依赖-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const upstream = join(root, '作者'), web = join(root, '运行/画布副本/web');
  mkdirSync(join(upstream, 'web/src'), { recursive: true });
  mkdirSync(join(root, '开发工具'));
  mkdirSync(join(web, 'src'), { recursive: true });
  mkdirSync(join(root, '.运行/3100源'), { recursive: true });
  execFileSync('git', ['init', '-q', upstream]);
  writeFileSync(join(upstream, 'web/src/页面.tsx'), 'baseline');
  execFileSync('git', ['add', '.'], { cwd: upstream });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'fixture'], { cwd: upstream });
  for (const [source, contents] of [
    ['Web前端依赖.json', JSON.stringify({ dependencies: { vite: '7.3.0' } })],
    ['Web前端依赖锁.json', '{"lockfileVersion":3,"name":"web"}'],
    ['Web运行依赖.json', JSON.stringify({ dependencies: { yaml: '2.8.2', undici: '6.29.0' } })],
    ['Web运行依赖锁.json', '{"lockfileVersion":3,"name":"runtime"}'],
  ]) writeFileSync(join(root, '开发工具', source), contents);
  let installs = 0;
  const run = async (_command, args, options) => {
    installs++;
    assert.ok(args.includes('--ignore-scripts'));
    const packages = options.cwd === web
      ? ['vite', '@vitejs/plugin-react', '@tailwindcss/postcss', 'react', 'typescript']
      : ['yaml', 'undici'];
    for (const name of packages) {
      const directory = join(options.cwd, 'node_modules', name);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, main: 'index.js' }));
      writeFileSync(join(directory, 'index.js'), 'module.exports = {};');
    }
  };
  const options = { root, web, upstream, commit: 'HEAD', run };
  await 准备开发构建环境(options);
  assert.equal(installs, 2);
  assert.ok(existsSync(join(root, '.运行/3100源/node_modules/.运行依赖指纹')));
  await 准备开发构建环境(options);
  assert.equal(installs, 2);
});
