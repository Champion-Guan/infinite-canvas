import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

// 只运行前端编译；外层有界构建守护负责容量、余量、超时和所有者退出。
const [mode, web, cache, output] = process.argv.slice(2);
assert.ok(['开发', '客户'].includes(mode) && [web, cache, output].every(isAbsolute));
const require = createRequire(join(web, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('vite')).href);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseManifest = JSON.parse(readFileSync(join(projectRoot, '开发文档/Web发布版本.json'), 'utf8'));
assert.equal(typeof releaseManifest.版本, 'string');
if (mode === '客户') process.env.VITE_BASE = '/';
await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: cache, logLevel: 'warn',
  ...(mode === '客户' ? { envDir: false, envPrefix: '__GUAN_NO_PUBLIC_ENV__' } : {}),
  // 上游 VERSION 只表示作者基线；工作台自身版本必须来自根目录发布清单，
  // 否则页面在更新服务状态尚未返回时会回退显示 v0.20.0。
  define: { __APP_VERSION__: JSON.stringify(releaseManifest.版本) },
  build: { outDir: output, emptyOutDir: mode === '开发',
    ...(mode === '开发' ? { minify: false, reportCompressedSize: false } : {}) },
  css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } } });
