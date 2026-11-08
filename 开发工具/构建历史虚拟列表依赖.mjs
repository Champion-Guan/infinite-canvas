import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(resolve(root, '.运行/3100源/画布副本/web/package.json'));
const { build } = createRequire(require.resolve('vite'))('esbuild');
const packageRoot = resolve(dirname(createRequire(resolve(root, 'package.json')).resolve('@tanstack/react-virtual')), '../..');
const library = resolve(packageRoot, 'dist/esm/index.js');
const license = await readFile(resolve(packageRoot, 'LICENSE'), 'utf8');
const result = await build({
    stdin: { contents: `export { useVirtualizer, observeElementRect, defaultRangeExtractor, Virtualizer } from ${JSON.stringify(library)};`, resolveDir: root },
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    external: ['react', 'react-dom', 'react/jsx-runtime'], write: false, minify: true,
    banner: { js: `/* @tanstack/react-virtual 3.14.22; @tanstack/virtual-core 3.19.7\n${license}*/` },
});
await writeFile(resolve(root, '扩展功能/生成历史/虚拟列表依赖.js'), result.outputFiles[0].contents);
console.log(`虚拟列表依赖：${result.outputFiles[0].contents.length} 字节，React 使用工作台已有实例。`);
