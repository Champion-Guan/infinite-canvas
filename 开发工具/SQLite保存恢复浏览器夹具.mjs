import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, realpathSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 自动入口保存恢复候选 } from './预审SQLite保存恢复.mjs';
import { 当前存储基线完整匹配 } from '../上游适配/SQLite当前存储基线批准.mjs';
import { SQLite安全指纹 } from '../上游适配/SQLite全面替换批准.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { startDataService } from '../扩展功能/本机服务/数据服务.mjs';
import { startIsolatedAuthorizedWorkbench } from '../扩展功能/本机服务/受限工作台启动器.mjs';

// 独立自有合成页面，只验证候选模块；不把待审补丁装入原画布或3100。
async function buildSaveRecoveryPreview(root) {
  // macOS的/var是/private/var的别名；Vite root和Rollup真实入口必须使用同一真实路径。
  const web = join(root, 'web'); mkdirSync(web); mkdirSync(join(web, 'modules'));
  const dependencies = join(根目录, '.运行', 基线.提交, 'web/node_modules'); symlinkSync(dependencies, join(web, 'node_modules'));
  for (const name of [
    '协议.mjs', '浏览器适配.mjs', '续期数据客户端.mjs', '应用值编码.mjs', '应用存储适配.mjs',
    '分片值编码.mjs', '命名空间快照.mjs', '媒体批次协议.mjs', '画布媒体延迟恢复.mjs',
    '本机授权客户端.mjs', '页面授权生命周期.mjs', '启动计时.mjs', '开发构建自动刷新.mjs',
    '启动画面.mjs', '可恢复应用存储.mjs',
  ]) {
    writeFileSync(join(web, 'modules', name), readFileSync(new URL('../扩展功能/本机存储/' + name, import.meta.url)));
  }
  mkdirSync(join(web, '本机凭据'));
  mkdirSync(join(web, '本机存储'));
  writeFileSync(join(web, '本机存储/协议.mjs'),
    readFileSync(new URL('../扩展功能/本机存储/协议.mjs', import.meta.url)));
  for (const name of ['页面凭据引用.mjs', '凭据协议.mjs', '密钥脱敏.mjs']) {
    writeFileSync(join(web, '本机凭据', name), readFileSync(new URL('../扩展功能/本机凭据/' + name, import.meta.url)));
  }
  mkdirSync(join(web, '故障切换')); mkdirSync(join(web, '软件更新'));
  writeFileSync(join(web, '故障切换/切换客户端.mjs'),
    "export function createFallbackClient(){return {read:async()=>null}}");
  writeFileSync(join(web, '软件更新/自动更新重启.mjs'),
    "export function bindAutomaticUpdateRestart(){return ()=>{}}");
  mkdirSync(join(web, '测试替身'));
  writeFileSync(join(web, '测试替身/本机授权客户端依赖.mjs'),
    'export const createCredentialClient=()=>({});export const createGenerationClient=()=>({});export const createNetworkProxyClient=()=>({});export const createMediaConversionClient=()=>({});');
  writeFileSync(join(web, 'modules/工作台自动入口.mjs'), 自动入口保存恢复候选(readFileSync(new URL('../扩展功能/本机存储/工作台自动入口.mjs', import.meta.url), 'utf8')));
  writeFileSync(join(web, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>保存恢复候选隔离验收</title><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/入口.mjs"></script></body></html>');
  writeFileSync(join(web, '入口.mjs'), "import {mountAutomaticWorkbench} from './modules/工作台自动入口.mjs';mountAutomaticWorkbench({root:document.getElementById('root'),loadApplication:()=>import('./合成界面.tsx')});");
  writeFileSync(join(web, '合成界面.tsx'), `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {SQLiteSaveStatus} from '@/guan/保存状态条';import {initializeSQLiteApplication,sqliteStateStorage,storageStatus} from '@/guan/上游浏览器存储桥';
await initializeSQLiteApplication();const key='infinite-canvas:canvas_store',previous=JSON.parse(sqliteStateStorage.getItem(key)??'null')?.state??{title:'合成产品',nodes:[]};
window.__candidateStatus=storageStatus;
function App(){const [draft,setDraft]=useState(previous);function save(next){setDraft(next);void sqliteStateStorage.setItem(key,JSON.stringify({state:next,version:0})).catch(()=>{});}
return <main><h1>保存恢复隔离合成界面（非原画布）</h1><p>仅合成数据，不接入3100，不迁私人数据。</p><label>合成画布名称<input aria-label="合成画布名称" value={draft.title} onChange={event=>setDraft({...draft,title:event.target.value})}/></label><p>本页合成节点：{draft.nodes.length}</p><button onClick={()=>save(draft)}>保存合成画布</button><button onClick={()=>save({...draft,nodes:[...draft.nodes,{id:crypto.randomUUID(),type:'text'}]})}>新增合成节点并保存</button><SQLiteSaveStatus/></main>}
document.body.style.cssText='font:15px system-ui;margin:60px;background:#f7f7fb;color:#202028;--background:#fff;--foreground:#202028;--border:#d6d6dc';createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`);
  const require = createRequire(join(dependencies, '../package.json')), { build } = await import(pathToFileURL(require.resolve('vite')).href), dist = join(root, 'dist');
  await build({ root: web, configFile: false, logLevel: 'warn', esbuild: { jsx: 'automatic' }, resolve: { alias: {
    '../../main': join(web, '合成界面.tsx'),
    '@/guan/保存状态条': join(根目录, '扩展功能/存储界面/保存状态条.tsx'), '@/guan/上游浏览器存储桥': join(根目录, '扩展功能/本机存储/保存恢复存储桥.ts'),
    '../本机凭据/凭据客户端.mjs': join(web, '测试替身/本机授权客户端依赖.mjs'),
    '../生成任务/生成任务客户端.mjs': join(web, '测试替身/本机授权客户端依赖.mjs'),
    '../网络代理/代理客户端.mjs': join(web, '测试替身/本机授权客户端依赖.mjs'),
    '../媒体交付/HEIC转换客户端.mjs': join(web, '测试替身/本机授权客户端依赖.mjs'),
    react: join(dependencies, 'react'), 'react-dom': join(dependencies, 'react-dom'),
    'lucide-react': join(dependencies, 'lucide-react'),
    antd: join(dependencies, 'antd'),
    motion: join(dependencies, 'motion'),
    'motion/react': join(dependencies, 'motion/react'),
  } }, build: { target: 'esnext', outDir: dist, emptyOutDir: false } });
  return dist;
}
export async function createSaveRecoveryFixture() {
  if (!当前存储基线完整匹配(根目录, SQLite安全指纹)) throw Error('当前存储源码与验收基线不符。');
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'guan-save-recovery-ui-'))), dataRoot = join(root, '数据');
  try {
    const webRoot = await buildSaveRecoveryPreview(root);
    let workspace, dataURL;
    const storage = { openWorkspace: options => (workspace = openWorkspace(options)),
      async startDataService(options) { const service = await startDataService(options); dataURL = service.url; return service; } };
    const key = randomBytes(32);
    const credentialKeyProvider = { read: async () => Buffer.from(key), create: async () => Buffer.from(key) };
    try {
      const currentVersion = JSON.parse(readFileSync(new URL('../开发文档/Web发布版本.json', import.meta.url), 'utf8')).版本;
      const launcher = await startIsolatedAuthorizedWorkbench({ webRoot, dataRoot, initialize: true, storage, credentialKeyProvider,
        softwareUpdateOptions: { currentVersion, webPackage: true } });
      return { ...launcher, root, dataRoot, workspace, dataURL };
    } finally { key.fill(0); }
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
