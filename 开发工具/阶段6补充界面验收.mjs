import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 核验日常运行包 } from './日常运行包.mjs';
import { 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';

assert.equal(process.argv.length, 3);
const output = resolve(process.argv[2]); assert.ok(output.startsWith(join(根目录, '.运行/output/阶段6最终收口-')));
const prepared = 核验日常运行包(join(根目录, '.运行/SQLite日常准备-UWriM2/准备清单.json'), 'a44877449e31671952933ddd7a1b5e1f3acaa12aa7479a6395d4aa94d104b1ed');
const load = path => import(pathToFileURL(join(prepared.integration.副本, path)).href);
const { startIsolatedAuthorizedWorkbench: start } = await load('扩展功能/本机服务/受限工作台启动器.mjs');
const approvedStorage = await 加载SQLite写入协调隔离服务(prepared.serviceIntegration);
const { createShardedApplicationStorage } = await load('web/src/guan/sqlite/分片应用存储.mjs');
let workspace, dataService;
const storage = { ...approvedStorage,
  openWorkspace(options) { workspace = approvedStorage.openWorkspace(options); return workspace; },
  async startDataService(options) { dataService = await approvedStorage.startDataService(options); return dataService; },
};
const root = mkdtempSync(join(tmpdir(), 'guan-stage6-final-ui-')), dataRoot = join(root, '数据');
const material = randomBytes(32), credentialKeyProvider = { read: async () => Buffer.from(material), create: async () => Buffer.from(material) };
const cli = join(根目录, 'node_modules/.bin/playwright-cli'), exec = promisify(execFile);
const screenshots = join(根目录, '.运行/output/playwright', '阶段6最终补充-' + Date.now()); mkdirSync(screenshots, { recursive: true });
const runId = Date.now(), sessionBase = 'stage6-final-' + runId, results = [], blocked = [];
let session = sessionBase, sequence = 0, app, passed = false, projectPath, receipt;
async function run(args, label) {
  let stdout = '', stderr = '', failure;
  try { ({ stdout, stderr } = await exec(cli, ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), timeout: 55_000, maxBuffer: 2 * 1024 * 1024 })); }
  catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failure = error; }
  writeFileSync(join(output, `UI-${runId}-${sequence++}-${label}.log`), (stdout + stderr).replace(/[a-f0-9]{64}/g, '[内部摘要已隐去]'), { flag: 'wx', mode: 0o600 });
  if (failure || /^### Error\b/m.test(stdout)) throw Error('浏览器步骤失败：' + label);
  return stdout;
}
async function code(source, label) {
  const marker = 'STAGE6_FINAL_OK:' + label;
  const result = await run(['run-code', `async page=>{${source};return ${JSON.stringify(marker)}}`], label);
  assert.ok(result.includes(marker), label);
}
async function click(name, label, role = 'button') {
  const snapshot = await run(['snapshot'], label + '-快照');
  const line = snapshot.split('\n').find(line => line.includes(role + ' "' + name + '"') && !line.includes('[disabled]'));
  const ref = line?.match(/\[ref=([^\]]+)\]/)?.[1]; assert.ok(ref, '快照缺少可点击' + role + '：' + name);
  await run(['click', ref], label);
}
function check(name, condition = true) { assert.ok(condition, name); results.push({ name, passed: true }); console.log(name); }
const saved = "await page.waitForFunction(()=>window.__stage6Status?.state==='saved'&&window.__stage6Status.pending===0,{},{timeout:40000});";
const clean = "if(await page.evaluate(()=>window.__stage6PersistenceCalls.length))throw Error('出现浏览器存储调用');if((await page.context().cookies()).length)throw Error('出现Cookie');if(await page.locator('meta[name=guan-local-bootstrap]').count())throw Error('内部材料残留');";
async function openBrowser(url) {
  await run(['open', 'about:blank', '--headed'], '打开独立浏览器'); await run(['snapshot'], '独立浏览器初始快照');
  await code(`await page.context().addInitScript(()=>{window.__stage6Status=null;window.__stage6PersistenceCalls=[];window.addEventListener('guan:storage-status',event=>window.__stage6Status=event.detail);for(const name of ['getItem','setItem','removeItem','clear','key'])Storage.prototype[name]=function(){window.__stage6PersistenceCalls.push(name);throw Error('禁止浏览器持久化')};for(const name of ['open','deleteDatabase','databases'])if(IDBFactory.prototype[name])IDBFactory.prototype[name]=function(){window.__stage6PersistenceCalls.push('IDB:'+name);throw Error('禁止浏览器数据库')};});await page.context().route('**/*',route=>{const u=new URL(route.request().url());return [${JSON.stringify(app.origin)},${JSON.stringify(dataService.url)}].includes(u.origin)||['blob:','data:'].includes(u.protocol)?route.continue():route.abort()});await page.setViewportSize({width:1440,height:1000});await page.goto(${JSON.stringify(url)});await page.getByRole('banner',{name:'工作台顶栏'}).waitFor();${clean}`, '真实页面免填码启动');
}
async function readPersisted() {
  const application = createShardedApplicationStorage({ client: { readDocument: async (...args) => workspace.readDocument(...args), readMedia: async id => { const media = workspace.readMedia(id); return new Blob([media.bytes], { type: media.mime }); } } });
  try {
    const store = application.createInstance(), preferences = application.createInstance({ storeName: 'preferences' });
    return { canvas: JSON.parse(await store.getItem('infinite-canvas:canvas_store')), assets: JSON.parse(await store.getItem('infinite-canvas:asset_store')),
      sources: JSON.parse(await store.getItem('infinite-canvas:prompt_source_store_v2')), view: await preferences.getItem('canvas-side-panel-node-view'), width: await preferences.getItem('canvas-side-panel-width') };
  } finally { application.close(); }
}
try {
  app = await start({ webRoot: prepared.webRoot, dataRoot, initialize: true, storage, credentialKeyProvider, endpoint: { hostname: 'localhost', port: 0 } });
  await openBrowser(app.origin);
  await click('新建产品', '原UI新建产品');
  await code("await page.waitForURL('**/canvas/*');await page.getByRole('button',{name:'切换为缩略图',exact:true}).waitFor();" + saved, '原画布初始化');
  await click('文本', '新增文本节点'); await click('视频', '新增视频节点'); await click('音频', '新增音频节点'); await code(saved, '原节点落盘');
  const nodes = (await readPersisted()).canvas.state.projects[0].nodes;
  check('原UI文本、视频、音频节点新增均收到ACK并写入SQLite', ['text', 'video', 'audio'].every(type => nodes.some(node => node.type === type)));
  await click('切换为缩略图', '侧栏缩略图偏好');
  await run(['snapshot'], '调整宽度前快照');
  await code("const r=await page.getByRole('button',{name:'调整左侧面板宽度',exact:true}).boundingBox();if(!r)throw Error('缺少宽度手柄');const x=r.x+2,y=r.y+100;if(!await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('button[aria-label=\"调整左侧面板宽度\"]')!==null,{x,y}))throw Error('手柄可见部分被遮挡');await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+40,y,{steps:6});await page.mouse.up();" + saved, '实际拖动侧栏宽度');
  const preferences = await readPersisted();
  check('侧栏真实切换与拖宽写入偏好命名空间', preferences.view === 'grid' && Number(preferences.width) > 280);
  await click('资产', '打开资产侧栏'); await run(['snapshot'], '资产上传前快照');
  await code("await page.locator('aside input[type=file][accept=\"image/*,video/*\"]').setInputFiles({name:'阶段6资产验收.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2nJ6kAAAAASUVORK5CYII=','base64')});await page.getByRole('button',{name:'插入画布',exact:true}).waitFor();" + saved, '真实文件导入资产');
  const assets = (await readPersisted()).assets;
  check('原资产上传经image_files、预览与asset_store保存，未注入页面状态', assets.state.assets.length === 1 && assets.state.assets[0].title === '阶段6资产验收.png' && !!assets.state.assets[0].data.storageKey);
  await run(['snapshot'], '资产插入前快照');
  await code("await page.getByRole('button',{name:'插入画布',exact:true}).hover();", '悬浮资产按钮');
  await click('插入画布', '资产插入原画布'); await code(saved, '资产插入ACK');
  await click('画布设置', '打开原设置'); await click('提示词来源', '打开来源页签', 'tab');
  await run(['snapshot'], '来源切换前快照');
  await code("const switches=page.getByRole('tabpanel').filter({has:page.getByText('Banana Prompt Quicker',{exact:true})}).getByRole('switch');if(await switches.count()!==1)throw Error('不是单来源开关');await switches.click();" + saved, '真实来源启用状态保存');
  const sources = (await readPersisted()).sources;
  check('提示词来源原UI开关写入SQLite，未触发联网刷新', sources.state.sources.length === 1 && sources.state.sources[0].enabled === false);
  await click('本地存储', '读取本机用量', 'tab'); await run(['snapshot'], '本机用量快照');
  await code("await page.getByText('SQLite',{exact:false}).first().waitFor();", '本机用量界面');
  check('原设置本地存储页读取本机用量，不访问navigator浏览器数据库');
  await run(['snapshot'], '设置关闭前快照');
  await code("await page.getByRole('dialog').filter({has:page.getByRole('tab',{name:'本地存储',exact:true})}).getByRole('button',{name:'关闭',exact:true}).click();" + saved + clean, '关闭原设置');
  await code(`await page.reload();await page.getByRole('button',{name:'切换为列表',exact:true}).waitFor();await page.waitForFunction(()=>document.querySelectorAll('[data-node-id]').length===4);${saved}${clean}`, '刷新重建原画布');
  check('刷新后四节点与侧栏缩略图偏好恢复，Storage/IndexedDB/Cookie零调用');
  const snapshotBefore = await readPersisted();
  await code("await page.getByRole('banner',{name:'工作台顶栏'}).waitFor();console.log('STAGE6_PROJECT_PATH:'+new URL(page.url()).pathname);", '记录原画布路由');
  const urlResult = await run(['eval', 'location.pathname'], '读取画布路由'); projectPath = urlResult.match(/"(\/canvas\/[^"\s]+)"/)?.[1];
  assert.ok(projectPath, '缺少当前画布路由');
  await run(['screenshot', '--filename', join(screenshots, '补充保存.png')], '保存后截图');
  await run(['close'], '关闭第一套浏览器');
  receipt = await dataService.createBackup(); const firstId = app.workspaceId; await app.close(); app = null;
  check('独立测试工作台正常关闭，实例锁释放且完整备份保留', !existsSync(join(dataRoot, '.实例锁.json')));
  app = await start({ webRoot: prepared.webRoot, dataRoot, initialize: false, storage, credentialKeyProvider, endpoint: { hostname: 'localhost', port: 0 } });
  session = sessionBase + '-cold'; await openBrowser(app.origin + projectPath);
  await code(`await page.waitForFunction(()=>document.querySelectorAll('[data-node-id]').length===4);await page.getByRole('button',{name:'切换为列表',exact:true}).waitFor();${clean}`, '新资料冷重开');
  const snapshotAfter = await readPersisted();
  assert.deepEqual(snapshotAfter, snapshotBefore); check('新浏览器资料、冷重开和不同端口读回相同产品、资产、来源及侧栏偏好', app.workspaceId === firstId);
  await click('资产', '冷重开资产侧栏'); await run(['snapshot'], '冷重开资产快照');
  await code("await page.getByRole('button',{name:'插入画布',exact:true}).waitFor();const imgs=page.locator('aside img');await imgs.first().waitFor();if(!await imgs.first().evaluate(img=>img.complete&&img.naturalWidth>0))throw Error('资产图片未恢复');" + clean, '资产媒体真实恢复');
  check('独立新浏览器原资产图片正常解码显示，不依赖旧blob网址');
  const errors = await run(['console', 'error'], '读取控制台错误');
  check('未出现React、CSP或未处理应用异常，缺省命名空间探测404按实保留', !/TypeError|ReferenceError|Uncaught|Unhandled|Invalid hook|caught the following error|Content Security Policy|Refused to connect|Fetch API cannot load/i.test(errors));
  await run(['screenshot', '--filename', join(screenshots, '补充冷重开.png')], '冷重开截图');
  passed = true;
} catch (error) { blocked.push(error.message); process.exitCode = 1; }
finally {
  try { await run(['snapshot'], '最终快照'); await run(['screenshot', '--filename', join(screenshots, '最终状态.png')], '最终截图'); } catch { /* 原坏边界已记录。 */ }
  try { await run(['close'], '关闭独立验收浏览器'); } catch { /* 不操作其他资料。 */ }
  try { await app?.close(); } catch (error) { passed = false; blocked.push(error.message); process.exitCode = 1; }
  material.fill(0);
  const report = { passed, date: new Date().toISOString(), results, blocked, dataRoot, screenshots, receipt,
    preparedWeb: prepared.webRoot, originalReactUI: true, browserBusinessStateInjected: false, real3100Restarted: false, realKeychainAccessed: false, realCredentialsUsed: false,
    scope: '补测原UI资产、来源配置、侧栏偏好及音视频节点保存；不调用真实外部服务，不代表付费生成/音视频播放验收。' };
  const reportName = existsSync(join(output, '补充界面验收.json')) ? '补充界面复验.json' : '补充界面验收.json';
  writeFileSync(join(output, reportName), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); console.log(JSON.stringify({ passed, results: results.length, blocked, screenshots }));
}
