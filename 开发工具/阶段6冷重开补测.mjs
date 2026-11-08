import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 核验日常运行包 } from './日常运行包.mjs';
import { 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';

assert.equal(process.argv.length, 3);
const output = resolve(process.argv[2]);
assert.ok(output.startsWith(join(根目录, '.运行/output/阶段6最终收口-')));
const prepared = 核验日常运行包(join(根目录, '.运行/SQLite日常准备-UWriM2/准备清单.json'), 'a44877449e31671952933ddd7a1b5e1f3acaa12aa7479a6395d4aa94d104b1ed');
const load = path => import(pathToFileURL(join(prepared.integration.副本, path)).href);
const { startIsolatedAuthorizedWorkbench: start } = await load('扩展功能/本机服务/受限工作台启动器.mjs');
const storage = await 加载SQLite写入协调隔离服务(prepared.serviceIntegration);
const root = mkdtempSync(join(tmpdir(), 'guan-stage6-cold-reopen-')), dataRoot = join(root, '数据');
const material = randomBytes(32), credentialKeyProvider = { read: async () => Buffer.from(material), create: async () => Buffer.from(material) };
const cli = join(根目录, 'node_modules/.bin/playwright-cli'), exec = promisify(execFile);
const screenshots = join(根目录, '.运行/output/playwright', '阶段6冷重开补测-' + Date.now()); mkdirSync(screenshots, { recursive: true });
const runId = Date.now(), results = [], blocked = [];
let session = 'stage6-cold-' + runId, sequence = 0, app, dataService, workspace, projectPath, passed = false;
const run = async (args, label) => {
  let stdout, stderr, failure;
  try { const result = await exec(cli, ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), timeout: 55_000, maxBuffer: 2 * 1024 * 1024 }); stdout = result.stdout; stderr = result.stderr; }
  catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failure = error; }
  writeFileSync(join(output, `UI-${runId}-${sequence++}-${label}.log`), (stdout + stderr).replace(/[a-f0-9]{64}/g, '[内部摘要已隐去]'), { flag: 'wx', mode: 0o600 });
  if (failure || /^### Error\b/m.test(stdout)) throw Error('浏览器步骤失败：' + label);
  return stdout;
};
const code = async (source, label) => {
  const marker = 'STAGE6_COLD_OK:' + label;
  const text = await run(['run-code', `async page=>{${source};return ${JSON.stringify(marker)}}`], label);
  assert.ok(text.includes(marker), label);
};
const click = async (name, label, role = 'button') => {
  const snapshot = await run(['snapshot'], label + '-快照');
  const line = snapshot.split('\n').find(line => line.includes(role + ' "' + name + '"') && !line.includes('[disabled]'));
  const ref = line?.match(/\[ref=([^\]]+)\]/)?.[1]; assert.ok(ref, '快照缺少可点击' + role + '：' + name);
  await run(['click', ref], label);
};
const check = (name, condition = true) => { assert.ok(condition, name); results.push({ name, passed: true }); };
const saved = "await page.waitForFunction(()=>window.__stage6Status?.state==='saved'&&window.__stage6Status.pending===0,{},{timeout:40000});";
const clean = "if(await page.evaluate(()=>window.__stage6PersistenceCalls.length))throw Error('出现浏览器存储调用');if((await page.context().cookies()).length)throw Error('出现Cookie');if(await page.locator('meta[name=guan-local-bootstrap]').count())throw Error('内部材料残留');";
async function openBrowser(url) {
  await run(['open', 'about:blank', '--headed'], '打开独立浏览器');
  await code(`await page.context().addInitScript(()=>{window.__stage6Status=null;window.__stage6PersistenceCalls=[];window.addEventListener('guan:storage-status',event=>window.__stage6Status=event.detail);for(const name of ['getItem','setItem','removeItem','clear','key'])Storage.prototype[name]=function(){window.__stage6PersistenceCalls.push(name);throw Error('禁止浏览器持久化')};for(const name of ['open','deleteDatabase','databases'])if(IDBFactory.prototype[name])IDBFactory.prototype[name]=function(){window.__stage6PersistenceCalls.push('IDB:'+name);throw Error('禁止浏览器数据库')};});await page.context().route('**/*',route=>{const u=new URL(route.request().url());return [${JSON.stringify(app.origin)},${JSON.stringify(dataService.url)}].includes(u.origin)||['blob:','data:'].includes(u.protocol)?route.continue():route.abort()});await page.setViewportSize({width:1440,height:1000});await page.goto(${JSON.stringify(url)});await page.getByRole('banner',{name:'工作台顶栏'}).waitFor();${clean}`, '打开隔离工作台');
}
try {
  const observedStorage = { ...storage, openWorkspace(options) { workspace = storage.openWorkspace(options); return workspace; }, async startDataService(options) { dataService = await storage.startDataService(options); return dataService; } };
  app = await start({ webRoot: prepared.webRoot, dataRoot, initialize: true, storage: observedStorage, credentialKeyProvider, endpoint: { hostname: 'localhost', port: 0 } });
  await openBrowser(app.origin);
  await click('新建产品', '冷重开前新建产品');
  await code("await page.waitForURL('**/canvas/*');await page.getByRole('button',{name:'切换为缩略图',exact:true}).waitFor();" + saved, '冷重开前进入画布');
  await click('文本', '冷重开前文本节点'); await click('视频', '冷重开前视频节点'); await click('音频', '冷重开前音频节点');
  await click('切换为缩略图', '冷重开前保存侧栏偏好');
  await click('资产', '冷重开前打开资产');
  await code("await page.locator('aside input[type=file][accept=\"image/*,video/*\"]').setInputFiles({name:'阶段6冷重开资产.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2nJ6kAAAAASUVORK5CYII=','base64')});await page.getByRole('button',{name:'插入画布',exact:true}).waitFor();" + saved, '冷重开前上传资产');
  await click('插入画布', '冷重开前插入资产');
  await click('画布设置', '冷重开前打开设置'); await click('提示词来源', '冷重开前打开来源', 'tab');
  await code("const switches=page.getByRole('tabpanel').filter({has:page.getByText('Banana Prompt Quicker',{exact:true})}).getByRole('switch');if(await switches.count()!==1)throw Error('不是单来源开关');await switches.click();" + saved + clean, '冷重开前保存来源');
  const raw = await run(['eval', 'new URL(location.href).pathname'], '读取冷重开路由');
  projectPath = raw.match(/\/canvas\/[^"\\s]+/)?.[0]; assert.ok(projectPath, '缺少当前画布路由');
  await run(['screenshot', '--filename', join(screenshots, '冷重开前.png')], '冷重开前截图');
  await run(['close'], '关闭冷重开前浏览器');
  const firstId = app.workspaceId; await app.close(); app = null;
  app = await start({ webRoot: prepared.webRoot, dataRoot, initialize: false, storage: observedStorage, credentialKeyProvider, endpoint: { hostname: 'localhost', port: 0 } });
  session += '-new'; await openBrowser(app.origin + projectPath);
  await code("await page.waitForFunction(()=>document.querySelectorAll('[data-node-id]').length===4);await page.getByRole('button',{name:'切换为列表',exact:true}).waitFor();" + clean, '独立浏览器冷重开读回');
  check('独立浏览器冷重开读回产品、文本/视频/音频节点与侧栏偏好', app.workspaceId === firstId);
  await click('资产', '冷重开后打开资产');
  await code("await page.getByRole('button',{name:'插入画布',exact:true}).waitFor();const img=page.locator('aside img').first();await img.waitFor();if(!await img.evaluate(node=>node.complete&&node.naturalWidth>0))throw Error('资产图片未恢复');" + clean, '冷重开后验证媒体');
  check('独立浏览器冷重开后资产媒体正常解码');
  await run(['screenshot', '--filename', join(screenshots, '冷重开后.png')], '冷重开后截图');
  passed = true;
} catch (error) { blocked.push(error.message); process.exitCode = 1; }
finally {
  try { await run(['close'], '关闭冷重开浏览器'); } catch { /* 已关闭或无会话。 */ }
  try { await app?.close(); } catch (error) { passed = false; blocked.push(error.message); process.exitCode = 1; }
  material.fill(0);
  const report = { passed, date: new Date().toISOString(), results, blocked, dataRoot, projectPath, screenshots, originalReactUI: true, browserBusinessStateInjected: false, real3100Restarted: false, realKeychainAccessed: false, realCredentialsUsed: false, scope: '仅补测原UI保存后正常停服、同工作区冷重开、新浏览器读回节点、侧栏偏好与媒体；不调用外部服务。' };
  writeFileSync(join(output, '冷重开补测.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ passed, results: results.length, blocked, screenshots }));
}
