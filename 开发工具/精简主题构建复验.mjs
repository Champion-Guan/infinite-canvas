import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 运行目录 } from './检查运行副本.mjs';

检查运行副本();
const web = join(运行目录, 'web'), require = createRequire(join(web, 'package.json'));
const { build, createLogger } = await import(pathToFileURL(require.resolve('vite')).href);
const tailwind = require('@tailwindcss/postcss');
const output = join(根目录, '.运行/output/精简主题构建', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const logger = createLogger(), messages = [];
for (const method of ['info', 'warn', 'warnOnce', 'error']) {
  const original = logger[method].bind(logger);
  logger[method] = (message, options) => { messages.push(message); writeFileSync(join(output, '构建.log'), messages.join('\n')); original(message, options); };
}
let passed = false;
try {
  await build({ root: web, configFile: join(web, 'vite.config.ts'), customLogger: logger, css: { postcss: { plugins: [tailwind({ base: join(web, 'src') })] } }, build: { outDir: join(output, 'dist'), rollupOptions: { maxParallelFileOps: 32 } } });
  passed = true;
} finally {
  writeFileSync(join(output, '结果.json'), JSON.stringify({ passed, limitation: '使用3100同样的受限Tailwind自动发现范围web/src，保留显式source；完整Vite模块构建，但不是默认构建已恢复的证据。', maxParallelFileOps: 32 }, null, 2) + '\n');
  检查运行副本(); console.log(JSON.stringify({ output, passed }));
}
