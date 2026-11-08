import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 构建分片候选 } from './预审SQLite分片存储.mjs';
import { 建立SQLite免填码隔离副本, 加载SQLite免填码隔离启动器 } from './接入SQLite免填码隔离副本.mjs';
import { 建立SQLite写入协调隔离服务, 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';

// 仅新模块的合成React界面；不装入原画布，不接入3100或真实数据。
export async function createShardedPreviewFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'guan-sharded-preview-'))), web = join(root, 'web'); mkdirSync(web); mkdirSync(join(web, 'modules'));
  const dependencies = join(根目录, '.运行', 基线.提交, 'web/node_modules'); symlinkSync(dependencies, join(web, 'node_modules'));
  const { combined } = 构建分片候选();
  for (const [path, item] of combined) if (path.startsWith('web/src/guan/sqlite/') && path.endsWith('.mjs')) writeFileSync(join(web, 'modules', path.split('/').at(-1)), item.产物);
  writeFileSync(join(web, '分片合成数据.mjs'), readFileSync(new URL('./分片合成数据.mjs', import.meta.url)));
  writeFileSync(join(web, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>SQLite分片候选预审</title><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/入口.mjs"></script></body></html>');
  writeFileSync(join(web, '入口.mjs'), "import {mountAutomaticWorkbench} from './modules/工作台自动入口.mjs';mountAutomaticWorkbench({root:document.getElementById('root'),loadApplication:()=>import('./合成界面.tsx')});");
  writeFileSync(join(web, '合成界面.tsx'), `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {SQLiteSaveStatus} from '@/guan/保存状态条';import {initializeSQLiteApplication,sqliteStateStorage,sqliteForage} from '@/guan/上游浏览器存储桥';
import {syntheticCanvas,capacityCases} from './分片合成数据.mjs';
await initializeSQLiteApplication();const key='infinite-canvas:canvas_store',previous=JSON.parse(sqliteStateStorage.getItem(key)??'null')??{state:{projects:[],deletedProjects:[]},version:0};
const media=sqliteForage.createInstance({storeName:'image_files'}),previousImage=await media.getItem('synthetic-png');
function App(){const [draft,setDraft]=useState(previous),[image,setImage]=useState(previousImage?URL.createObjectURL(previousImage):null);
function save(next){setDraft(next);void sqliteStateStorage.setItem(key,JSON.stringify(next)).catch(()=>{});}
function rename(){const next=structuredClone(draft);next.state.projects[0].title+='-修改';save(next);}
function edit(){const next=structuredClone(draft);next.state.projects[0].nodes[0].metadata.text+='-尺寸关键词';save(next);}
async function picture(){const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2nJ6kAAAAASUVORK5CYII='),c=>c.charCodeAt(0)),blob=new Blob([bytes],{type:'image/png'});await media.setItem('synthetic-png',blob);setImage(URL.createObjectURL(blob));}
return <main><h1>SQLite分片隔离合成界面（非原画布）</h1><p>仅合成数据，真实默认HTTP限流，未接入3100。</p><p>产品数量：{draft.state.projects.length}</p><p>节点数量：{draft.state.projects.reduce((sum,p)=>sum+p.nodes.length,0)}</p><p>首产品：{draft.state.projects[0]?.title??'无'}</p>
<button onClick={()=>save(JSON.parse(syntheticCanvas(capacityCases[4])))}>保存20产品5000节点</button><button disabled={!draft.state.projects.length} onClick={rename}>修改首产品名称</button><button disabled={!draft.state.projects.length} onClick={edit}>修改一个节点</button><button onClick={()=>void picture().catch(()=>{})}>保存合成图片</button>{image&&<img alt="SQLite合成图片" src={image} width="48" height="48"/>}<SQLiteSaveStatus/></main>}
document.body.style.cssText='font:15px system-ui;margin:60px;background:#f7f7fb;color:#202028;--background:#fff;--foreground:#202028;--border:#d6d6dc';createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`);
  const require = createRequire(join(dependencies, '../package.json')), { build } = await import(pathToFileURL(require.resolve('vite')).href), dist = join(root, 'dist');
  await build({ root: web, configFile: false, logLevel: 'warn', esbuild: { jsx: 'automatic' }, resolve: { alias: {
    '../../main': join(web, '合成界面.tsx'), '@/guan/保存状态条': join(根目录, '扩展功能/存储界面/保存状态条.tsx'),
    '@/guan/上游浏览器存储桥': join(根目录, '扩展功能/本机存储/保存恢复存储桥.ts'), react: join(dependencies, 'react'), 'react-dom': join(dependencies, 'react-dom'),
  } }, build: { target: 'esnext', outDir: dist, emptyOutDir: false } });
  const approved = await 加载SQLite写入协调隔离服务(建立SQLite写入协调隔离服务());
  const launcherIntegration = 建立SQLite免填码隔离副本(), { startIsolatedAuthorizedWorkbench } = await 加载SQLite免填码隔离启动器(launcherIntegration);
  let workspace, dataURL, dataService;
  const storage = { ...approved, openWorkspace(options) { workspace = approved.openWorkspace(options); return workspace; },
    async startDataService(options) { dataService = await approved.startDataService(options); dataURL = dataService.url; return dataService; } };
  const launcher = await startIsolatedAuthorizedWorkbench({ webRoot: dist, dataRoot: join(root, '数据'), initialize: true, storage });
  return { ...launcher, root, dataRoot: join(root, '数据'), workspace, dataURL, launcherIntegration, createBackup: () => dataService.createBackup() };
}
