import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 自动入口保存恢复候选 } from './预审SQLite保存恢复.mjs';
import { 建立SQLite免填码隔离副本, 加载SQLite免填码隔离启动器 } from './接入SQLite免填码隔离副本.mjs';
import { 建立SQLite写入协调隔离服务, 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';

// 独立自有合成页面，只验证候选模块；不把待审补丁装入原画布或3100。
export async function buildSaveRecoveryPreview() {
  // macOS的/var是/private/var的别名；Vite root和Rollup真实入口必须使用同一真实路径。
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'guan-save-recovery-ui-'))), web = join(root, 'web'); mkdirSync(web); mkdirSync(join(web, 'modules'));
  const dependencies = join(根目录, '.运行', 基线.提交, 'web/node_modules'); symlinkSync(dependencies, join(web, 'node_modules'));
  for (const name of ['协议.mjs', '浏览器适配.mjs', '续期数据客户端.mjs', '应用值编码.mjs', '应用存储适配.mjs', '本机授权客户端.mjs', '可恢复应用存储.mjs']) {
    writeFileSync(join(web, 'modules', name), readFileSync(new URL('../扩展功能/本机存储/' + name, import.meta.url)));
  }
  writeFileSync(join(web, 'modules/工作台自动入口.mjs'), 自动入口保存恢复候选(readFileSync(new URL('../扩展功能/本机存储/工作台自动入口.mjs', import.meta.url), 'utf8')));
  writeFileSync(join(web, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>保存恢复候选隔离验收</title><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/入口.mjs"></script></body></html>');
  writeFileSync(join(web, '入口.mjs'), "import {mountAutomaticWorkbench} from './modules/工作台自动入口.mjs';mountAutomaticWorkbench({root:document.getElementById('root'),loadApplication:()=>import('./合成界面.tsx')});");
  writeFileSync(join(web, '合成界面.tsx'), `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {SQLiteSaveStatus} from '@/guan/保存状态条';import {initializeSQLiteApplication,sqliteStateStorage} from '@/guan/上游浏览器存储桥';
await initializeSQLiteApplication();const key='infinite-canvas:canvas_store',previous=JSON.parse(sqliteStateStorage.getItem(key)??'null')?.state??{title:'合成产品',nodes:[]};
function App(){const [draft,setDraft]=useState(previous);function save(next){setDraft(next);void sqliteStateStorage.setItem(key,JSON.stringify({state:next,version:0})).catch(()=>{});}
return <main><h1>保存恢复隔离合成界面（非原画布）</h1><p>仅合成数据，不接入3100，不迁私人数据。</p><label>合成画布名称<input aria-label="合成画布名称" value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})}/></label><p>本页合成节点：{draft.nodes.length}</p><button onClick={()=>save(draft)}>保存合成画布</button><button onClick={()=>save({...draft,nodes:[...draft.nodes,{id:crypto.randomUUID(),type:'text'}]})}>新增合成节点并保存</button><SQLiteSaveStatus/></main>}
document.body.style.cssText='font:15px system-ui;margin:60px;background:#f7f7fb;color:#202028;--background:#fff;--foreground:#202028;--border:#d6d6dc';createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`);
  const require = createRequire(join(dependencies, '../package.json')), { build } = await import(pathToFileURL(require.resolve('vite')).href), dist = join(root, 'dist');
  await build({ root: web, configFile: false, logLevel: 'warn', esbuild: { jsx: 'automatic' }, resolve: { alias: {
    '../../main': join(web, '合成界面.tsx'),
    '@/guan/保存状态条': join(根目录, '扩展功能/存储界面/保存状态条.tsx'), '@/guan/上游浏览器存储桥': join(根目录, '扩展功能/本机存储/保存恢复存储桥.ts'),
    react: join(dependencies, 'react'), 'react-dom': join(dependencies, 'react-dom'),
  } }, build: { target: 'esnext', outDir: dist, emptyOutDir: false } });
  return { root, dist };
}
export async function createSaveRecoveryFixture() {
  const { root, dist } = await buildSaveRecoveryPreview();
  const approved = await 加载SQLite写入协调隔离服务(建立SQLite写入协调隔离服务());
  // 仅加载上一轮已批准磁盘包；本轮没有更改启动器或原画布内容。
  const launcherIntegration = 建立SQLite免填码隔离副本();
  const { startIsolatedAuthorizedWorkbench } = await 加载SQLite免填码隔离启动器(launcherIntegration);
  let workspace, dataURL;
  const storage = { ...approved, openWorkspace(options) { workspace = approved.openWorkspace(options); return workspace; },
    async startDataService(options) { const service = await approved.startDataService(options); dataURL = service.url; return service; } };
  const launcher = await startIsolatedAuthorizedWorkbench({ webRoot: dist, dataRoot: join(root, '数据'), initialize: true, storage });
  return { ...launcher, root, dataRoot: join(root, '数据'), workspace, dataURL, launcherIntegration };
}
