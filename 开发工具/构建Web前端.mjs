import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// 只运行前端编译；外层有界构建守护负责容量、余量、超时和所有者退出。
const [mode, web, cache, output] = process.argv.slice(2);
assert.ok(['开发', '客户'].includes(mode) && [web, cache, output].every(isAbsolute));
const require = createRequire(join(web, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('vite')).href);
if (mode === '客户') process.env.VITE_BASE = '/';
await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: cache, logLevel: 'warn',
  ...(mode === '客户' ? { envDir: false, envPrefix: '__GUAN_NO_PUBLIC_ENV__' } : {}),
  build: { outDir: output, emptyOutDir: mode === '开发' },
  css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } } });
