// 独立预审工具，来源 开发工具/镜像虚拟构建状态通知与设置子层.mjs SHA256 b593c1ba4976f56eb22d9a5111c7f629bdef249b173f74d89166b03a205990b7；原件保持。
// 独立后继，原虚拟构建器 SHA256 7adc1e3ec90ce8e1d2e2217889389f7bfb9508a006a586ec8f616e32f4429af4；不装配本次待批源码。
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 生成审查差异 } from './检查首批功能适配.mjs';
import { 构建模型价格与成功图片清理候选, 价格清理前置记录 } from './预审模型价格与成功图片清理.mjs';
import { 读取状态通知与设置子层隔离记录 } from './接入状态通知与设置子层隔离副本.mjs';
import { 创建完整构建镜像 } from './模型价格构建依赖只读镜像.mjs';

// 后继验证工具。保留已冻结的直接构建器；仅替换本轮构建依赖读取方式。
// 真实运行包只读，候选仍由Vite公开插件在内存提供，没有把待批核心写入镜像源码。
const preview = 构建模型价格与成功图片清理候选();
const manifest = JSON.parse(readFileSync(join(根目录, '上游适配/待审查/模型价格与成功图片清理.json')));
if (哈希(生成审查差异(preview.delta)) !== manifest.差异SHA256 || manifest.文件.length !== preview.delta.size) throw Error('虚拟构建必须匹配冻结候选');
const mirror = 创建完整构建镜像(preview.integration), web = mirror.web;
const overrides = new Map([...preview.delta].map(([path, item]) => [resolve(mirror.root, path), item.产物]));
const require = createRequire(join(web, 'package.json')), { build } = await import(pathToFileURL(require.resolve('vite')).href);
const output = mkdtempSync(join(tmpdir(), 'guan-status-layer-build-'));
// Tailwind扫描磁盘而非Vite虚拟模块。用公开@source指令补充候选的静态类名，
// 仅写构建用的纯类名文本，不将待批组件装配到任何源码目录。
const classes = [...new Set([...preview.delta.values()].flatMap(item => [...item.产物.matchAll(/\bclassName="([^"]+)"/g)].flatMap(match => match[1].split(/\s+/))))].sort();
const classSource = join(output, '候选类名.txt');
writeFileSync(classSource, classes.join('\n') + '\n', { flag: 'wx' });
const globalCSS = join(web, 'src/styles/globals.css');
overrides.set(globalCSS, readFileSync(globalCSS, 'utf8') + '\n@source ' + JSON.stringify(classSource) + ';\n');
writeFileSync(join(output, '构建依赖.json'), JSON.stringify(mirror.report, null, 2) + '\n', { flag: 'wx' });
await build({ root: web, configFile: join(web, 'vite.config.ts'), cacheDir: join(output, 'cache'), logLevel: 'warn',
  css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } },
  build: { outDir: join(output, 'dist'), emptyOutDir: false },
  plugins: [{ name: 'guan-status-layer-review-memory-candidate', enforce: 'pre',
    resolveId(specifier, importer) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/') && !specifier.startsWith('@/')) return null;
      const target = specifier.startsWith('@/') ? resolve(web, 'src', specifier.slice(2)) : resolve(importer ? dirname(importer.split('?')[0]) : web, specifier);
      for (const suffix of ['', '.ts', '.tsx', '.js', '.mjs']) if (overrides.has(target + suffix)) return target + suffix;
      return null;
    },
    load(id) { return overrides.get(id.split('?')[0]) ?? null; },
  }],
});
读取状态通知与设置子层隔离记录(价格清理前置记录);
const result = { 状态: '完整Vite内存候选构建成功', 文件数: preview.delta.size, 差异SHA256: manifest.差异SHA256,
  输出: output, 入口SHA256: 哈希(readFileSync(join(output, 'dist/index.html'))),
  依赖实例数: mirror.report.实例数, 安装脚本已执行: false, 已装配候选源码: false, 已启动服务: false };
writeFileSync(join(output, '构建结果.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
