import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { 根目录 } from './公共.mjs';
import { createCategorizedCanvasFixture } from './SQLite分类容量原画布夹具.mjs';
import { 核验分类容量完整包 } from './接入SQLite分类容量隔离副本.mjs';

if (process.argv.length !== 3 || !process.argv[2].startsWith('--隔离记录=')) throw Error('仅接受本批隔离记录');
const reviewRecord = process.argv[2].slice('--隔离记录='.length);
const exec = promisify(execFile), cli = join(根目录, 'node_modules/.bin/playwright-cli');
const output = join(根目录, '.运行/output/playwright', 'SQLite分类容量原画布-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const session = 'guan-usage-canvas-' + Date.now(), checks = [], blocked = [];
let fixture, sequence = 0, passed = false, integrity;
async function run(args, label) {
  let stdout, stderr, failure;
  try { ({ stdout, stderr } = await exec(cli, ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), timeout: 55_000, maxBuffer: 3 * 1024 * 1024 })); }
  catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failure = error; }
  const text = stdout + stderr;
  writeFileSync(join(output, `${sequence++}-${label}.log`), text.replace(/[a-f0-9]{64}/g, '[内部材料已隐去]'));
  if (failure || /^### Error\b/m.test(text)) throw Error('浏览器步骤失败：' + label);
  return text;
}
async function code(source, label) {
  const marker = 'ORIGINAL_USAGE_OK:' + label;
  if (!(await run(['run-code', `async page=>{${source};return ${JSON.stringify(marker)}}`], label)).includes(marker)) throw Error('步骤未完成：' + label);
  checks.push(label);
}
async function click(name, role = 'button') {
  const snapshot = await run(['snapshot'], '点击前快照');
  const ref = snapshot.split('\n').find(line => line.includes(role + ' "') &&
    line.match(new RegExp(role + ' "([^"]*)"'))?.[1].replaceAll(' ', '') === name && !line.includes('[disabled]') &&
    (name !== '文本' || line.includes('[cursor=pointer]')))?.match(/\[ref=([^\]]+)\]/)?.[1];
  if (!ref) throw Error('快照中控件不可见：' + name);
  await run(['click', ref], '点击-' + name);
}
const saved = "await page.waitForFunction(()=>window.__recoveryStatus?.state==='saved'&&window.__recoveryStatus.pending===0,{},{timeout:40000});";
async function closeSettings() {
  await run(['snapshot'], '关闭设置前快照');
  await code("await page.getByRole('dialog').filter({has:page.getByRole('tab',{name:'本地存储',exact:true})}).getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'})", '原设置可关闭');
}
try {
  fixture = await createCategorizedCanvasFixture({ reviewRecord });
  assert.notEqual(new URL(fixture.origin).port, '3100');
  await run(['open', 'about:blank', '--headed'], '独立浏览器'); await run(['snapshot'], '初始快照');
  await code(`await page.context().addInitScript(()=>{window.__persistenceCalls=[];window.__recoveryStatus=null;window.addEventListener('guan:storage-status',event=>window.__recoveryStatus=event.detail);for(const name of ['getItem','setItem','removeItem','clear'])Storage.prototype[name]=function(){window.__persistenceCalls.push(name);throw Error('禁止浏览器持久化')};IDBFactory.prototype.open=function(){window.__persistenceCalls.push('indexedDB');throw Error('禁止浏览器持久化')}});await page.emulateMedia({colorScheme:'light'});await page.context().route('**/*',route=>{const u=new URL(route.request().url());return [${JSON.stringify(fixture.origin)},${JSON.stringify(fixture.dataURL)}].includes(u.origin)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort()});await page.goto(${JSON.stringify(fixture.origin)});await page.getByRole('banner',{name:'工作台顶栏'}).getByRole('button',{name:'新建产品',exact:true}).waitFor();if(await page.locator('meta[name=guan-local-bootstrap]').count())throw Error('内部材料未移除')`, '原工作台免填码启动');
  await click('新建产品');
  await code("await page.waitForURL('**/canvas/*');await page.getByRole('button',{name:'文本',exact:true}).first().waitFor();" + saved, '原UI创建产品');
  for (let i = 1; i <= 3; i++) {
    await click('文本');
    await code(`await page.waitForFunction(count=>document.querySelectorAll('[data-node-id]').length===count,${i});${saved}`, '新增文本-' + i);
  }
  const canvas = await fixture.readCanvas(), nodes = canvas.state.projects[0].nodes;
  assert.equal(nodes.length, 3);
  for (const [i, a] of nodes.entries()) for (const b of nodes.slice(i + 1))
    assert.equal(a.position.x < b.position.x + b.width && a.position.x + a.width > b.position.x && a.position.y < b.position.y + b.height && a.position.y + a.height > b.position.y, false);
  checks.push('三张原UI新增卡片自动避让且经SQLite保存');
  await click('画布设置'); await click('本地存储', 'tab');
  await code("for(const text of ['本机 SQLite 存储','当前业务内容','本机实际占用（采样）','历史与保留内容','图片','图片缩略图','视频','音频','跨分类共享内容','实际占用明细'])await page.getByText(text,{exact:true}).waitFor();if(await page.getByRole('alert').count())throw Error('分类读取失败')", '原设置真实分类容量');
  await run(['screenshot', '--filename', join(output, '原设置浅色分类容量.png'), '--full-page'], '浅色截图');
  await fixture.addPrompt(); await click('刷新统计');
  await code("await page.getByText('提示词缓存',{exact:true}).locator('..').getByText('2 项记录',{exact:true}).waitFor()", '刷新看到第二条真实SQLite记录');
  await code("await page.route('**/usage',route=>route.fulfill({status:503,contentType:'application/json',headers:{'access-control-allow-origin':new URL(page.url()).origin},body:JSON.stringify({error:{code:'usage_unavailable',message:'合成读取失败'}})}))", '合成API故障');
  await click('刷新统计');
  await code("await page.getByRole('alert').filter({hasText:'容量读取失败'}).waitFor();await page.getByText(/下方保留上次结果，不代表当前容量/).waitFor();await page.getByText('提示词缓存',{exact:true}).locator('..').getByText('2 项记录',{exact:true}).waitFor()", '原设置失败保留旧结果');
  await code("await page.unroute('**/usage')", '撤销合成故障'); await click('刷新统计');
  await code("await page.getByRole('alert').waitFor({state:'detached'});await page.getByText('实际占用明细',{exact:true}).waitFor()", '原设置故障后恢复');
  await closeSettings(); await click('切换深色主题');
  await code("await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));" + saved, '原顶栏深色切换');
  await click('画布设置'); await click('本地存储', 'tab');
  await code("await page.getByText('实际占用明细',{exact:true}).waitFor();if(await page.getByRole('alert').count())throw Error('深色重开失败')", '原设置重开与深色分类容量');
  await run(['screenshot', '--filename', join(output, '原设置深色分类容量.png'), '--full-page'], '深色截图');
  await closeSettings();
  await code(`await page.reload();await page.waitForFunction(()=>document.querySelectorAll('[data-node-id]').length===3);${saved}if(await page.evaluate(()=>window.__persistenceCalls.length))throw Error('触及浏览器存储');if((await page.context().cookies()).length)throw Error('产生Cookie')`, '刷新恢复三张避让卡片且浏览器存储零调用');
  await click('画布设置'); await click('本地存储', 'tab');
  await code("await page.getByText('实际占用明细',{exact:true}).waitFor();await page.getByText('提示词缓存',{exact:true}).locator('..').getByText('2 项记录',{exact:true}).waitFor()", '刷新后分类容量仍可用');
  await run(['screenshot', '--filename', join(output, '最终分类容量.png'), '--full-page'], '最终截图');
  await closeSettings();
  await run(['screenshot', '--filename', join(output, '卡片自动避让.png'), '--full-page'], '自动避让截图');
  const errors = await run(['console', 'error'], '控制台错误');
  if (/Uncaught|Unhandled|TypeError|ReferenceError|Content Security Policy|Invalid hook/i.test(errors)) throw Error('存在非预期前端错误');
  核验分类容量完整包(fixture.integration.组合包, true);
  passed = true;
} catch (error) { blocked.push(error.stack); process.exitCode = 1; }
finally {
  try { await run(['snapshot'], '最终快照'); } catch { /* 保留首错 */ }
  try { await run(['close'], '关闭本轮浏览器'); } catch { /* 只操作本轮命名会话 */ }
  try { await fixture?.close(); } catch (error) { blocked.push(error.message); passed = false; process.exitCode = 1; }
  if (fixture && !existsSync(join(fixture.dataRoot, '.实例锁.json'))) {
    const db = new DatabaseSync(join(fixture.dataRoot, '工作台.sqlite'), { readOnly: true });
    try { integrity = { check: db.prepare('PRAGMA integrity_check').get().integrity_check, foreignKeys: db.prepare('PRAGMA foreign_key_check').all().length }; }
    finally { db.close(); }
    if (integrity.check !== 'ok' || integrity.foreignKeys) { passed = false; process.exitCode = 1; }
  }
  const report = { passed, checks, blocked, output, reviewRecord, syntheticDataRoot: fixture?.dataRoot, integrity,
    fullOriginalCanvasIntegrated: true, approvedDiskService: true, previousAutoPlacementIncluded: true, candidateOnly: false,
    real3100Untouched: true, defaultChromeUntouched: true, lockAbsent: fixture ? !existsSync(join(fixture.dataRoot, '.实例锁.json')) : null };
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
}
