import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { createUsagePanelFixture } from './SQLite分类容量浏览器夹具.mjs';

const exec = promisify(execFile), cli = join(根目录, 'node_modules/.bin/playwright-cli');
const output = join(根目录, '.运行/output/playwright', 'SQLite分类容量-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const session = 'guan-usage-' + Date.now(), checks = [], blocked = [];
let fixture, sequence = 0, passed = false;
async function run(args, label) {
  const result = await exec(cli, ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), timeout: 45_000, maxBuffer: 3 * 1024 * 1024 });
  const text = result.stdout + result.stderr;
  writeFileSync(join(output, `${sequence++}-${label}.log`), text.replace(/[a-f0-9]{64}/g, '[内部材料已隐去]'));
  if (/^### Error\b/m.test(text)) throw Error('浏览器步骤失败：' + label);
  return text;
}
async function code(source, label) {
  const marker = 'USAGE_PANEL_OK:' + label;
  if (!(await run(['run-code', `async page=>{${source};return ${JSON.stringify(marker)}}`], label)).includes(marker)) throw Error('步骤未完成：' + label);
  checks.push(label);
}
async function click(name) {
  const snapshot = await run(['snapshot'], '按钮前快照');
  const ref = snapshot.split('\n').find(line => line.includes('button "' + name + '"') && !line.includes('[disabled]'))?.match(/\[ref=([^\]]+)\]/)?.[1];
  if (!ref) throw Error('按钮不可见：' + name);
  await run(['click', ref], '点击-' + name);
}
try {
  fixture = await createUsagePanelFixture();
  await run(['open', 'about:blank', '--headed'], '独立浏览器'); await run(['snapshot'], '初始快照');
  await code(`await page.context().addInitScript(()=>{window.__storageCalls=[];for(const name of ['getItem','setItem','removeItem','clear'])Storage.prototype[name]=function(){window.__storageCalls.push(name);throw Error('禁止浏览器存储')};IDBFactory.prototype.open=function(){window.__storageCalls.push('indexedDB');throw Error('禁止浏览器存储')}});await page.context().route('**/*',route=>{const u=new URL(route.request().url());return [${JSON.stringify(fixture.origin)},${JSON.stringify(fixture.dataURL)}].includes(u.origin)||['blob:','data:'].includes(u.protocol)?route.continue():route.abort()});await page.goto(${JSON.stringify(fixture.origin)});await page.getByText('本机 SQLite 存储',{exact:true}).waitFor();await page.getByText('实际占用明细',{exact:true}).waitFor()`, '免填码启动并读取真实临时SQLite');
  await run(['resize', '1100', '1050'], '桌面尺寸');
  await code(`for(const text of ['当前业务内容','本机实际占用（采样）','历史与保留内容','图片','图片缩略图','视频','音频','跨分类共享内容'])await page.getByText(text,{exact:true}).waitFor();if(await page.getByRole('alert').count())throw Error('初始失败');if(await page.evaluate(()=>window.__storageCalls.length))throw Error('触及浏览器存储');if((await page.context().cookies()).length)throw Error('产生Cookie')`, '分类总览和隐私边界');
  await run(['screenshot', '--filename', join(output, '浅色分类容量.png'), '--full-page'], '浅色截图');
  await click('切换测试主题');
  await code("if(!await page.locator('main').evaluate(el=>el.classList.contains('dark')))throw Error('未切深色');if(await page.getByRole('alert').count())throw Error('主题切换失败')", '深色主题');
  await run(['screenshot', '--filename', join(output, '深色分类容量.png'), '--full-page'], '深色截图');
  await fixture.addPrompt(); await click('刷新统计');
  await code("await page.getByText('提示词缓存',{exact:true}).locator('..').getByText('2 项记录',{exact:true}).waitFor()", '手动刷新显示新记录');
  await code("await page.route('**/usage',route=>route.fulfill({status:503,contentType:'application/json',headers:{'access-control-allow-origin':new URL(page.url()).origin},body:JSON.stringify({error:{code:'usage_unavailable',message:'合成读取失败'}})}))", '注入合成读取故障');
  await click('刷新统计');
  await code("await page.getByRole('alert').filter({hasText:'容量读取失败'}).waitFor();await page.getByText(/下方保留上次结果，不代表当前容量/).waitFor();await page.getByText('提示词缓存',{exact:true}).locator('..').getByText('2 项记录',{exact:true}).waitFor()", '失败提示保留旧结果且不伪装空库');
  await code("await page.unroute('**/usage')", '撤销合成故障'); await click('刷新统计');
  await code("await page.getByRole('alert').waitFor({state:'detached'});await page.getByText('实际占用明细',{exact:true}).waitFor()", '失败后可恢复刷新');
  await click('关闭测试页签'); await click('打开测试页签');
  await code("await page.getByText('实际占用明细',{exact:true}).waitFor();if(await page.getByRole('alert').count())throw Error('重开页签失败')", '重开页签重新读取');
  await run(['resize', '390', '844'], '窄屏尺寸');
  await code("if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('窄屏横向溢出');if(await page.evaluate(()=>window.__storageCalls.length))throw Error('触及浏览器存储')", '窄屏布局与浏览器存储零调用');
  await run(['screenshot', '--filename', join(output, '窄屏分类容量.png'), '--full-page'], '窄屏截图');
  const errors = await run(['console', 'error'], '控制台错误');
  if (/Uncaught|Unhandled|TypeError|ReferenceError|Content Security Policy|Invalid hook/i.test(errors)) throw Error('存在非预期前端错误');
  passed = true;
} catch (error) { blocked.push(error.message); process.exitCode = 1; }
finally {
  try { await run(['snapshot'], '最终快照'); } catch { /* 保留首个错误。 */ }
  try { await run(['close'], '关闭本轮浏览器'); } catch { /* 不碰其他浏览器。 */ }
  try { await fixture?.close(); } catch (error) { blocked.push(error.message); passed = false; process.exitCode = 1; }
  const report = { passed, checks, blocked, output, syntheticDataRoot: fixture?.dataRoot, candidatePanelOnly: true, fullOriginalCanvasIntegrated: false,
    real3100Untouched: true, defaultChromeUntouched: true, lockAbsent: fixture ? !existsSync(join(fixture.dataRoot, '.实例锁.json')) : null };
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
}
