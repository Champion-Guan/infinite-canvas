import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 构建SQLite会话恢复候选 } from './预审SQLite会话恢复.mjs';
import { 核验Excel勾选完整包 } from './接入Excel勾选事件隔离副本.mjs';

// Vite仅从内存读取候选覆盖，绝不将候选写入已批准包；构建结果只供审查。
const preview = 构建SQLite会话恢复候选(), web = join(preview.integration.副本, 'web');
const require = createRequire(join(web, 'package.json')), { build } = await import(pathToFileURL(require.resolve('vite')).href);
const output = mkdtempSync(join(tmpdir(), 'guan-session-virtual-build-'));
const overrides = new Map([...preview.delta].filter(([path]) => path.startsWith('web/')).map(([path, item]) => [resolve(preview.integration.副本, path), item.产物]));
await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: join(output, '.vite'), logLevel: 'warn',
  plugins: [{ name: 'review-only-memory-overrides', enforce: 'pre', load(id) { return overrides.get(id.split('?')[0]) ?? null; } }],
  build: { outDir: join(output, 'dist'), emptyOutDir: false },
  css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } },
});
核验Excel勾选完整包(preview.integration.组合包, true);
console.log(JSON.stringify({ 完整Vite候选构建通过: true, 输出: output, 已接入工作台包: false, 已接入3100: false }));
