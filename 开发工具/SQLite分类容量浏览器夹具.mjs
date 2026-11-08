import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 构建分类容量候选, 加载分类容量内存候选 } from './预审SQLite分类容量.mjs';
import { 核验卡片布局完整源码 } from './接入卡片自动避让隔离副本.mjs';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';

// 独立自有面板验收，不把六文件候选装入原React画布或任何运行副本。
export async function createUsagePanelFixture() {
  const preview = 构建分类容量候选(), candidate = await 加载分类容量内存候选(preview);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'guan-usage-panel-'))), web = join(root, 'web');
  mkdirSync(web); mkdirSync(join(web, 'modules'));
  const dependencies = join(preview.integration.副本, 'web/node_modules'), require = createRequire(join(preview.integration.副本, 'web/package.json'));
  symlinkSync(dependencies, join(web, 'node_modules'));
  for (const name of ['协议.mjs', '浏览器适配.mjs', '续期数据客户端.mjs', '应用值编码.mjs', '应用存储适配.mjs', '本机授权客户端.mjs', '工作台自动入口.mjs']) {
    writeFileSync(join(web, 'modules', name), readFileSync(join(根目录, '扩展功能/本机存储', name)));
  }
  writeFileSync(join(web, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>SQLite分类容量隔离预审</title><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/入口.mjs"></script></body></html>');
  writeFileSync(join(web, '入口.mjs'), "import {mountAutomaticWorkbench} from './modules/工作台自动入口.mjs';mountAutomaticWorkbench({root:document.getElementById('root'),loadApplication:()=>import('./面板入口.tsx')});");
  writeFileSync(join(web, '容量读取.ts'), `export type LocalStorageUsage={usage:number;quota:number|null;contentBytes:number;databases:Array<{name:string;version:number;bytes:number;stores:Array<{name:string;records:number;bytes:number}>}>};
export async function readLocalStorageUsage():Promise<LocalStorageUsage>{const app=await (window as any).__guanSQLiteHost.initialize();return app.readUsage();}`);
  writeFileSync(join(web, '面板入口.tsx'), `import {useState,StrictMode} from 'react';import {createRoot} from 'react-dom/client';import {ConfigProvider,theme,Button} from 'antd';import {ConfigLocalStorage} from '分类面板';import './样式.css';
function App(){const [dark,setDark]=useState(false),[active,setActive]=useState(true);return <ConfigProvider theme={{algorithm:dark?theme.darkAlgorithm:theme.defaultAlgorithm}}><main className={dark?'dark':''} style={{minHeight:'100vh',background:dark?'#171717':'#fafaf9',color:dark?'#fafaf9':'#292524',padding:'24px'}}><div style={{maxWidth:800,margin:'auto'}}><h1 style={{fontSize:18,marginBottom:8}}>SQLite 分类容量 · 自有面板隔离预审</h1><p style={{fontSize:12,marginBottom:16}}>仅合成数据，不是已接入3100的设置页面。</p><div style={{display:'flex',gap:8,marginBottom:16}}><Button onClick={()=>setDark(v=>!v)}>切换测试主题</Button><Button onClick={()=>setActive(v=>!v)}>{active?'关闭测试页签':'打开测试页签'}</Button></div><div hidden={!active}><ConfigLocalStorage active={active}/></div></div></main></ConfigProvider>}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);`);
  writeFileSync(join(web, '样式.css'), '@import "tailwindcss";\n@custom-variant dark (&:where(.dark, .dark *));\n@source "' + join(根目录, '扩展功能/存储界面/SQLite分类容量面板.tsx') + '";\nbody{margin:0;font-family:system-ui,sans-serif}\n');
  const { build } = await import(pathToFileURL(require.resolve('vite')).href), dist = join(root, 'dist');
  await build({ root: web, configFile: false, logLevel: 'warn', esbuild: { jsx: 'automatic' }, resolve: { alias: {
    '../../main': join(web, '面板入口.tsx'), '分类面板': join(根目录, '扩展功能/存储界面/SQLite分类容量面板.tsx'), '@/services/local-storage-usage': join(web, '容量读取.ts'),
    react: join(dependencies, 'react'), 'react-dom': join(dependencies, 'react-dom'), antd: join(dependencies, 'antd'), 'lucide-react': join(dependencies, 'lucide-react'),
  } }, css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: web })] } }, build: { target: 'esnext', outDir: dist, emptyOutDir: false,
    rollupOptions: { onwarn(warning, warn) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning); } } } });
  核验卡片布局完整源码(preview.integration.副本, true);
  const { startIsolatedAuthorizedWorkbench } = await import(pathToFileURL(join(preview.integration.副本, '扩展功能/本机服务/受限工作台启动器.mjs')).href);
  const material = randomBytes(32), credentialKeyProvider = { read: async () => Buffer.from(material), create: async () => Buffer.from(material) };
  let workspace, service, launcher, app;
  try {
    launcher = await startIsolatedAuthorizedWorkbench({ webRoot: dist, dataRoot: join(root, '数据'), initialize: true, credentialKeyProvider, endpoint: { hostname: 'localhost', port: 0 },
      storage: { ...candidate, openWorkspace(options) { workspace = candidate.openWorkspace(options); return workspace; }, async startDataService(options) { service = await candidate.startDataService(options); return service; } } });
    const client = { readDocument: (...args) => workspace.readDocument(...args), writeDocument: value => workspace.writeDocument(value), async writeMedia(blob) { return workspace.writeMedia(Buffer.from(await blob.arrayBuffer()), blob.type); } };
    app = createShardedApplicationStorage({ client });
    const store = name => app.createInstance({ storeName: name });
    const image = new Blob(['synthetic-shared-image'], { type: 'image/png' });
    await store('image_files').setItem('image-one', image); await store('image_files').setItem('image-two', image); await store('image_previews').setItem('preview-one', image);
    await store('media_files').setItem('video-one', new Blob(['synthetic-video'], { type: 'video/mp4' }));
    await store('media_files').setItem('audio-one', new Blob(['synthetic-audio'], { type: 'audio/ogg' }));
    await store('prompt_cache').setItem('prompt-one', '合成提示词缓存'); await store('image_generation_logs').setItem('log-one', { status: 'success' });
    await store('app_state').setItem('test-state', { title: '仅供分类容量验收' }); await app.flush();
    return { ...launcher, root, dataRoot: join(root, '数据'), workspace, dataURL: service.url,
      async addPrompt() { await store('prompt_cache').setItem('prompt-two', '手动刷新后可见的第二条'); },
      async close() { try { app.close(); await launcher.close(); } finally { material.fill(0); } } };
  } catch (error) { try { app?.close(); await launcher?.close(); } finally { material.fill(0); } throw error; }
}
