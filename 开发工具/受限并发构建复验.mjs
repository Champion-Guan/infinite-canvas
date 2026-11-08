import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 运行目录 } from './检查运行副本.mjs';

// 本机文件读取受阻时的独立诊断：不修改作者Vite配置、不跳过构建，仅限制Rollup文件并发。
检查运行副本();
const web = join(运行目录, 'web');
const require = createRequire(join(web, 'package.json'));
const { build, createLogger } = await import(pathToFileURL(require.resolve('vite')).href);
const output = join(根目录, '.运行/output/首页构建复验', new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const logger = createLogger();
const messages = [];
for (const method of ['info', 'warn', 'warnOnce', 'error']) {
  const original = logger[method].bind(logger);
  logger[method] = (message, options) => {
    messages.push(message); writeFileSync(join(output, '构建.log'), messages.join('\n'));
    original(message, options);
  };
}
const start = performance.now();
let passed = false;
try {
  await build({ root: web, configFile: join(web, 'vite.config.ts'), customLogger: logger, build: { rollupOptions: { maxParallelFileOps: 32 } } });
  passed = true;
} finally {
  writeFileSync(join(output, '结果.json'), JSON.stringify({ passed, maxParallelFileOps: 32, milliseconds: Math.round(performance.now() - start), scope: '同一Vite配置和完整产物，受限文件并发复验；不是原默认命令成功的证据' }, null, 2) + '\n');
  检查运行副本(); console.log(JSON.stringify({ passed, output }));
}
