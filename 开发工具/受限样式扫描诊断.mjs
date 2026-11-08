import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 检查运行副本, 运行目录 } from './检查运行副本.mjs';

// 只供3100验收：上游默认Tailwind扫描在本机阻塞时缩小自动发现范围。
// 不改作者配置/CSS；显式@source继续由Tailwind处理。不是默认启动流程成功的证据。
if (process.argv.length > 2) throw Error('诊断不接受端口、目录或其他覆盖参数');
检查运行副本();
const allowed = new Set(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM']);
for (const key of Object.keys(process.env)) if (!allowed.has(key)) delete process.env[key];
process.env.NODE_ENV = 'development';
const web = join(运行目录, 'web');
const require = createRequire(join(web, 'package.json'));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const tailwind = require('@tailwindcss/postcss');
const server = await createServer({
  root: web,
  configFile: join(web, 'vite.config.ts'),
  server: { host: 'localhost', port: 3100, strictPort: true },
  css: { postcss: { plugins: [tailwind({ base: join(web, 'src') })] } },
});
await server.listen();
server.printUrls();
console.log('仅验收诊断：Tailwind自动扫描web/src，显式source保留；原启动器与作者文件未修改。');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close().then(() => process.exit(0)).catch(error => { console.error(error.message); process.exit(1); });
});
