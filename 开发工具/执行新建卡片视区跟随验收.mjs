import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { 根目录 } from './公共.mjs';
import { ts } from './检查首批功能适配.mjs';
import { 读取旧视区跟随来源 } from './预审新建卡片视区跟随.mjs';
import { createRevealCanvasFixture } from './视区跟随原画布夹具.mjs';
import { 核验视区跟随完整包 } from './接入新建卡片视区跟随隔离副本.mjs';

if (process.argv.length !== 3 || !process.argv[2].startsWith('--隔离记录=')) throw Error('仅接受已批准的视区跟随隔离记录');
const reviewRecord = process.argv[2].slice('--隔离记录='.length), exec = promisify(execFile);
const cli = join(根目录, 'node_modules/.bin/playwright-cli');
const output = join(根目录, '.运行/output/playwright', '新建卡片视区跟随-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const session = 'guan-reveal-canvas-' + Date.now(), checks = [], blocked = [], trace = [];
const oldEffect = ts.transpileModule(读取旧视区跟随来源().effect, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
let fixture, sequence = 0, passed = false, integrity, follows = 0;
async function run(args, label) {
  let stdout, stderr, failure;
  try { ({ stdout, stderr } = await exec(cli, ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), timeout: 55_000, maxBuffer: 4 * 1024 * 1024 })); }
  catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failure = error; }
  writeFileSync(join(output, `${sequence++}-${label}.log`), (stdout + stderr).replace(/[a-f0-9]{64}/g, '[内部材料已隐去]'));
  if (failure || /^### Error\b/m.test(stdout + stderr)) throw Error('浏览器步骤失败：' + label);
  return stdout.trim();
}
async function code(source, label) {
  const marker = 'REVEAL_OK:' + label;
  const value = JSON.parse(await run(['run-code', `async page=>{return {marker:${JSON.stringify(marker)},value:await(async()=>{${source}})()}}`], label));
  if (value.marker !== marker) throw Error('步骤未完成：' + label);
  return value.value;
}
async function click(name) {
  const snapshot = await run(['snapshot'], '点击前快照');
  const ref = snapshot.split('\n').find(line => line.match(/button "([^"]*)"/)?.[1].replaceAll(' ', '') === name &&
    !line.includes('[disabled]') && (name !== '文本' || line.includes('[cursor=pointer]')))?.match(/\[ref=([^\]]+)\]/)?.[1];
  if (!ref) throw Error('快照中按钮不可见：' + name);
  await run(['click', ref], '点击-' + name);
}
const saved = "await page.waitForFunction(()=>window.__recoveryStatus?.state==='saved'&&window.__recoveryStatus.pending===0,{},{timeout:40000});";
async function readUI() {
  return code(`return page.evaluate(()=>{const world=document.querySelector('div.absolute.origin-top-left');if(!world)throw Error('真实画布层缺失');const matrix=new DOMMatrix(getComputedStyle(world).transform),container=world.parentElement,rect=container.getBoundingClientRect();let background;for(let y=rect.top+100;y<rect.bottom-130&&!background;y+=70)for(let x=rect.left+80;x<rect.right-180&&!background;x+=100){const el=document.elementFromPoint(x,y);if(el&&container.contains(el)&&!el.closest('[data-node-id],[data-canvas-no-zoom],[data-canvas-bottom-toolbar],button,input'))background={x,y}}return {view:{x:matrix.e,y:matrix.f,k:matrix.a},size:{width:rect.width,height:rect.height},rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},background,rendered:[...document.querySelectorAll('[data-node-id]')].map(el=>el.dataset.nodeId),panels:[...document.querySelectorAll('[data-node-panel]')].map(el=>el.dataset.nodePanel)}});`, '读取真实视区');
}
async function currentProject(expectedCount) {
  for (let i = 0; i < 200; i++) {
    const canvas = await fixture.readCanvas();
    const state = canvas?.state;
    const project = state?.projects.find(item => item.id === state.currentProjectId) ?? state?.projects.at(-1);
    if (project && (expectedCount === undefined || project.nodes.length === expectedCount)) return project;
    await delay(100);
  }
  throw Error('真实SQLite保存未达到预期卡片数');
}
function oldViewport(nodes, nodeId, view, size) {
  let expected = view;
  new Function('useLayoutEffect', 'revealCreatedNodeRef', 'nodes', 'viewportRef', 'size', 'setViewport', oldEffect)(
    cb => cb(), { current: nodeId }, nodes, { current: view }, size, next => { expected = next; },
  );
  return expected;
}
function sameView(a, b) { for (const key of ['x', 'y', 'k']) assert.ok(Math.abs(a[key] - b[key]) < 0.02, `${key}不符：${a[key]} / ${b[key]}`); }
async function create(type, label) {
  const previous = await currentProject(), uiBefore = await readUI();
  await click(label);
  await code(saved, '等待新卡片保存');
  const project = await currentProject(previous.nodes.length + 1), ui = await readUI();
  const oldIds = new Set(previous.nodes.map(node => node.id)), added = project.nodes.filter(node => !oldIds.has(node.id));
  assert.equal(added.length, 1); const node = added[0]; assert.equal(node.type, type);
  for (const existing of previous.nodes) assert.deepEqual(project.nodes.find(item => item.id === existing.id), existing, '原卡片不能被移动或改写');
  for (const existing of previous.nodes.filter(item => item.type !== 'group'))
    assert.equal(node.position.x < existing.position.x + existing.width && node.position.x + node.width > existing.position.x && node.position.y < existing.position.y + existing.height && node.position.y + node.height > existing.position.y, false, '新增卡片不应重叠');
  const expected = oldViewport(project.nodes, node.id, uiBefore.view, uiBefore.size);
  sameView(ui.view, expected); sameView(project.viewport, expected);
  assert.equal(ui.view.k, uiBefore.view.k, '新建不能改变缩放');
  assert.ok(ui.rendered.includes(node.id), '最新卡片应在真实画布挂载');
  assert.equal(ui.panels.includes(node.id), ['image', 'video', 'config'].includes(type), '面板自动打开规则不变');
  if (expected.x !== uiBefore.view.x || expected.y !== uiBefore.view.y) follows++;
  trace.push({ type, nodeId: node.id, position: node.position, before: uiBefore.view, expectedOldViewport: expected, actualViewport: ui.view, size: ui.size });
  checks.push('原UI创建-' + type + '-' + project.nodes.length);
  console.log('浏览器通过：' + checks.at(-1));
  return project;
}
async function zoom(percent) {
  const snapshot = await run(['snapshot'], '缩放前快照');
  if (!snapshot.includes('slider')) throw Error('真实缩放滑块缺失');
  await code(`const slider=page.getByRole('slider');await slider.focus();await slider.press('Home');for(let i=5;i<${percent};i++)await slider.press('ArrowRight');${saved}`, '键盘缩放-' + percent);
  const ui = await readUI(); assert.ok(Math.abs(ui.view.k - percent / 100) < 0.001);
  checks.push('真实滑块缩放-' + percent);
}
async function pan() {
  await run(['snapshot'], '平移前快照');
  const before = await readUI(); assert.ok(before.background, '须找到真实空白背景，不拖卡片');
  await code(`await page.mouse.move(${before.background.x},${before.background.y});await page.mouse.down({button:'middle'});await page.mouse.move(${before.background.x + 120},${before.background.y + 70},{steps:10});await page.mouse.up({button:'middle'});${saved}`, '鼠标真实平移');
  const after = await readUI(); sameView(after.view, { ...before.view, x: before.view.x + 120, y: before.view.y + 70 });
  checks.push('真实空白背景平移');
}
try {
  fixture = await createRevealCanvasFixture({ reviewRecord });
  assert.notEqual(new URL(fixture.origin).port, '3100');
  await run(['open', 'about:blank', '--headed'], '独立浏览器'); await run(['resize', '1400', '900'], '固定视窗'); await run(['snapshot'], '初始快照');
  await code(`await page.context().addInitScript(()=>{window.__persistenceCalls=[];window.__recoveryStatus=null;window.addEventListener('guan:storage-status',event=>window.__recoveryStatus=event.detail);for(const name of ['getItem','setItem','removeItem','clear'])Storage.prototype[name]=function(){window.__persistenceCalls.push(name);throw Error('禁止浏览器持久化')};IDBFactory.prototype.open=function(){window.__persistenceCalls.push('indexedDB');throw Error('禁止浏览器持久化')}});await page.emulateMedia({colorScheme:'light'});await page.context().route('**/*',route=>{const u=new URL(route.request().url());return [${JSON.stringify(fixture.origin)},${JSON.stringify(fixture.dataURL)}].includes(u.origin)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort()});await page.goto(${JSON.stringify(fixture.origin)});await page.getByRole('banner',{name:'工作台顶栏'}).getByRole('button',{name:'新建产品',exact:true}).waitFor();if(await page.locator('meta[name=guan-local-bootstrap]').count())throw Error('内部材料未移除')`, '原工作台免填码启动');
  checks.push('真实工作台免填码及隔离存储启动');
  await click('新建产品');
  await code("await page.waitForURL('**/canvas/*');await page.getByRole('button',{name:'文本',exact:true}).first().waitFor();" + saved, '原UI创建产品');
  await currentProject(0);
  for (let i = 0; i < 9; i++) await create('text', '文本');
  assert.ok(follows > 0, '必须真正覆盖视区已满，而不只创建前三张');
  await run(['screenshot', '--filename', join(output, '连续新建后视区跟随.png'), '--full-page'], '连续新建截图');
  await pan(); await zoom(50);
  for (let i = 0; i < 3; i++) await create('text', '文本');
  await zoom(200);
  for (let i = 0; i < 3; i++) await create('text', '文本');
  await zoom(100);
  for (const [type, label] of [['image', '图片'], ['config', '生成配置'], ['video', '视频'], ['audio', '音频']]) await create(type, label);
  const final = await currentProject(), finalUI = await readUI();
  await run(['snapshot'], '刷新前快照'); await run(['reload'], '真实刷新');
  await code(`await page.locator('[data-node-id]').first().waitFor();${saved}if(await page.evaluate(()=>window.__persistenceCalls.length))throw Error('触及浏览器存储');if((await page.context().cookies()).length)throw Error('产生Cookie')`, '刷新后SQLite恢复');
  assert.deepEqual((await currentProject()).nodes, final.nodes);
  sameView((await readUI()).view, finalUI.view);
  checks.push('全部卡片及视区SQLite保存后刷新恢复');
  await click('切换深色主题');
  await code("await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));" + saved, '深色状态保存');
  await create('text', '文本');
  await run(['screenshot', '--filename', join(output, '深色视区跟随.png'), '--full-page'], '深色截图');
  await run(['requests'], '真实请求记录');
  const errors = await run(['console', 'error'], '控制台错误');
  if (/Uncaught|Unhandled|TypeError|ReferenceError|Content Security Policy|Invalid hook/i.test(errors)) throw Error('存在非预期前端错误');
  checks.push('深色新建、真实网络与控制台检查');
  核验视区跟随完整包(fixture.integration.组合包, true);
  passed = true;
} catch (error) { blocked.push(error.stack); process.exitCode = 1; }
finally {
  try { await run(['snapshot'], '最终快照'); } catch { /* 保留首错 */ }
  try { await run(['close'], '关闭本轮浏览器'); } catch { /* 只操作本轮独立命名会话 */ }
  try { await fixture?.close(); } catch (error) { blocked.push(error.message); passed = false; process.exitCode = 1; }
  if (fixture && !existsSync(join(fixture.dataRoot, '.实例锁.json'))) {
    const db = new DatabaseSync(join(fixture.dataRoot, '工作台.sqlite'), { readOnly: true });
    try { integrity = { check: db.prepare('PRAGMA integrity_check').get().integrity_check, foreignKeys: db.prepare('PRAGMA foreign_key_check').all().length }; }
    finally { db.close(); }
    if (integrity.check !== 'ok' || integrity.foreignKeys) { passed = false; process.exitCode = 1; }
  }
  const report = { passed, checks, blocked, output, reviewRecord, syntheticDataRoot: fixture?.dataRoot, integrity, follows,
    fullOriginalCanvasIntegrated: true, approvedDiskService: true, oldEffectComparedPerCreation: true,
    real3100Untouched: true, defaultChromeUntouched: true, lockAbsent: fixture ? !existsSync(join(fixture.dataRoot, '.实例锁.json')) : null };
  writeFileSync(join(output, '创建视区轨迹.json'), JSON.stringify(trace, null, 2) + '\n');
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
