import { mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 构建任务确认与设置边界候选, 确认边界前置记录 } from './预审任务确认与设置边界.mjs';
import { 读取迁移扩大整批收尾隔离记录 } from './接入迁移扩大整批收尾隔离副本.mjs';
import { 哈希 } from './检查运行副本.mjs';

// Vite公开插件只在内存提供待审查源码；输出/缓存全部写全新临时目录，不装配或修改运行包。
const preview = 构建任务确认与设置边界候选(), web = join(preview.integration.副本, 'web');
const overrides = new Map([...preview.delta].map(([path, item]) => [resolve(preview.integration.组合包, path), item.产物]));
const require = createRequire(join(web, 'package.json')), { build } = await import(pathToFileURL(require.resolve('vite')).href);
const output = mkdtempSync(join(tmpdir(), 'guan-confirm-review-build-'));
await build({ root: web, configFile: join(web, 'vite.config.ts'), configLoader: 'runner', cacheDir: join(output, 'cache'), logLevel: 'warn',
  build: { outDir: join(output, 'dist'), emptyOutDir: false },
  plugins: [{ name: 'guan-review-memory-candidate', enforce: 'pre',
    resolveId(specifier, importer) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('@/')) return null;
      const target = specifier.startsWith('@/') ? resolve(web, 'src', specifier.slice(2)) : resolve(importer ? dirname(importer.split('?')[0]) : web, specifier);
      for (const suffix of ['', '.ts', '.tsx', '.js', '.mjs']) if (overrides.has(target + suffix)) return target + suffix;
      return null;
    },
    load(id) { return overrides.get(id.split('?')[0]) ?? null; },
  }],
});
读取迁移扩大整批收尾隔离记录(确认边界前置记录);
console.log(JSON.stringify({ 状态: '完整Vite内存候选构建成功', 文件数: preview.delta.size, 输出: output,
  入口SHA256: 哈希(readFileSync(join(output, 'dist/index.html'))), 已装配: false, 已启动服务: false }, null, 2));
