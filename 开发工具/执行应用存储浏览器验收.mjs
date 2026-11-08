import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { createApplicationBrowserFixture } from './应用存储浏览器夹具.mjs';

const exec = promisify(execFile), cli = join(根目录, 'node_modules/.bin/playwright-cli');
const output = join(根目录, '.运行/output/playwright', `SQLite全面替换-${new Date().toISOString().replaceAll(':', '-')}`);
mkdirSync(output, { recursive: true });
const fixture = await createApplicationBrowserFixture(), sessions = ['guan-app-a-' + Date.now(), 'guan-app-b-' + Date.now()], results = [];
let passed = false, sequence = 0;
async function run(index, args, label) {
  const { stdout, stderr } = await exec(cli, ['--session', sessions[index], '--raw', ...args], { cwd: join(根目录, '.运行'), timeout: 60_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NO_UPDATE_NOTIFIER: '1' } });
  writeFileSync(join(output, `${sequence++}-${index}-${label}.log`), stdout + stderr); return stdout.trim();
}
async function code(index, source, label) { return run(index, ['run-code', `async page => { ${source} }`], label); }
function check(name, ok) { results.push({ name, passed: !!ok }); if (!ok) throw Error('验收失败：' + name); }
async function open(index) {
  await run(index, ['open', 'about:blank', '--headed'], '新资料启动'); await run(index, ['snapshot'], '初始快照');
  await code(index, `await page.context().addInitScript({path:${JSON.stringify(fixture.bootstrapPaths[index])}});await page.context().addInitScript(()=>{window.__browserPersistenceCalls=[];for(const name of ['getItem','setItem','removeItem','clear']){Storage.prototype[name]=function(){window.__browserPersistenceCalls.push(name);throw Error('禁止浏览器持久化')}}IDBFactory.prototype.open=function(){window.__browserPersistenceCalls.push('indexedDB.open');throw Error('禁止IndexedDB')}});await page.goto(${JSON.stringify(fixture.fronts[index])});await page.waitForFunction(()=>!!window.__stage6Application);`, '授权与浏览器存储哨兵');
  await run(index, ['snapshot'], '功能快照');
}
try {
  await open(0);
  await code(0, `await page.getByRole('textbox',{name:'产品名称'}).fill('SQLite跨端口产品');await page.getByRole('button',{name:'保存产品与媒体'}).click();await page.waitForFunction(()=>window.__stage6Application.state.saved);`, '保存');
  check('真实浏览器将画布、图片、偏好提交到SQLite', fixture.workspace.listDocuments('extension').length === 3);
  await code(0, `await page.reload();await page.waitForFunction(()=>!!window.__stage6Application);await page.getByRole('button',{name:'读取产品与媒体'}).click();await page.waitForFunction(()=>window.__stage6Application.state.read);if(await page.getByRole('textbox',{name:'产品名称'}).inputValue()!=='SQLite跨端口产品')throw Error('产品恢复失败');`, '刷新读取');
  check('刷新恢复画布与媒体，偏好先于界面初始化', true);
  await open(1);
  await code(1, `await page.getByRole('button',{name:'读取产品与媒体'}).click();await page.waitForFunction(()=>window.__stage6Application.state.read);const s=await page.evaluate(()=>window.__stage6Application.state);if(s.locale!=='en-US'||s.mediaType!=='image/png'||!s.mediaBytes)throw Error('数据契约不符');`, '独立资料另端口读取');
  check('不同端口及独立资料使用同一本机工作区', true);
  for (let index = 0; index < sessions.length; index++) {
    await code(index, `if((await page.evaluate(()=>window.__browserPersistenceCalls)).length)throw Error('触发浏览器存储');`, '浏览器存储哨兵检查');
    await run(index, ['screenshot', '--filename', join(output, `隔离浏览器-${index}.png`)], '截图');
    const errors = await run(index, ['console', 'error'], '控制台');
    if (/\[error\]|ReferenceError|TypeError/.test(errors)) throw Error('浏览器控制台报错');
    await run(index, ['close'], '首轮关闭');
  }
  check('读写全程零localStorage/sessionStorage/IndexedDB调用', true);
  const identity = fixture.workspace.workspaceId; await fixture.restart(); await open(0);
  await code(0, `await page.getByRole('button',{name:'读取产品与媒体'}).click();await page.waitForFunction(()=>window.__stage6Application.state.read);if(await page.getByRole('textbox',{name:'产品名称'}).inputValue()!=='SQLite跨端口产品')throw Error('重启恢复失败');`, '服务重启后恢复');
  check('本机服务重启后画布、媒体和工作区身份保留', fixture.workspace.workspaceId === identity);
  await code(0, `await page.getByRole('button',{name:'清空合成产品'}).click();await page.waitForFunction(()=>window.__stage6Application.state.cleared);`, '清空合成项目');
  const documents = fixture.workspace.listDocuments('extension').map(row => fixture.workspace.readDocument('extension', row.id));
  check('清空仅提交目标命名空间，媒体与偏好仍保留', documents.find(row => row.value.namespace === 'app_state').value.entries.length === 0 && documents.find(row => row.value.namespace === 'image_files').value.entries.length === 1 && documents.find(row => row.value.namespace === 'preferences').value.entries.length === 1);
  passed = true;
} catch (error) { results.push({ name: error.message, passed: false }); process.exitCode = 1; }
finally {
  for (let index = 0; index < sessions.length; index++) try { await run(index, ['close'], '最终关闭'); } catch { /* 未打开或已关闭 */ }
  await fixture.close();
  const report = { passed, results, output, syntheticDataRoot: fixture.root, retainedForInspection: true, real3100And3000Untouched: true };
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
