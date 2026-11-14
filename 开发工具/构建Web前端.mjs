import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readWebReleaseDefinitions } from './Web版本说明.mjs';
import { startupPreloadPlugin } from './首屏资源预载.mjs';

// 只运行前端编译；外层有界构建守护负责容量、余量、超时和所有者退出。
const [mode, web, cache, output] = process.argv.slice(2);
assert.ok(['开发', '客户'].includes(mode) && [web, cache, output].every(isAbsolute));
const require = createRequire(join(web, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('vite')).href);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { parseChangelog } = await import(pathToFileURL(join(web, 'src/lib/release.ts')).href);
const releaseDefinitions = readWebReleaseDefinitions(projectRoot, parseChangelog);
if (mode === '客户') process.env.VITE_BASE = '/';
await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: cache, logLevel: 'warn',
  ...(mode === '客户' ? { envDir: false, envPrefix: '__GUAN_NO_PUBLIC_ENV__' } : {}),
  // 上游版本与开发草稿不属于客户发布历史；版本号和离线说明使用同一发布来源。
  define: releaseDefinitions,
  plugins: [startupPreloadPlugin()],
  build: { outDir: output, emptyOutDir: mode === '开发',
    minify: 'esbuild', reportCompressedSize: false },
  css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } } });
