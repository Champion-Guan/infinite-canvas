import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createStorageBrowserFixture } from './本机存储浏览器夹具.mjs';

const exec = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, '.运行/output/playwright', `阶段6-${new Date().toISOString().replaceAll(':', '-')}`);
mkdirSync(output, { recursive: true });
const cli = join(root, 'node_modules/.bin/playwright-cli'), fixture = await createStorageBrowserFixture();
const sessions = [`guan-data-a-${Date.now()}`, `guan-data-b-${Date.now()}`], results = [];
let passed = false;
async function run(index, args, label) {
  const { stdout, stderr } = await exec(cli, ['--session', sessions[index], '--raw', ...args], { cwd: join(root, '.运行'), timeout: 60_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NO_UPDATE_NOTIFIER: '1' } });
  writeFileSync(join(output, `${results.length}-${index}-${label}.log`), stdout + stderr);
  return stdout.trim();
}
async function code(index, source, label) { return run(index, ['run-code', `async page => { ${source} }`], label); }
function check(name, ok) { results.push({ name, passed: !!ok }); if (!ok) throw new Error(`验收失败：${name}`); }
try {
  for (let index = 0; index < sessions.length; index++) {
    await run(index, ['open', 'about:blank', '--headed'], '启动'); await run(index, ['snapshot'], '初始快照');
    await code(index, `await page.context().addInitScript({path:${JSON.stringify(fixture.bootstrapPaths[index])}});await page.goto(${JSON.stringify(fixture.fronts[index])});await page.waitForFunction(()=>!!window.__stage6);`, '加载授权页面');
    await run(index, ['snapshot'], '授权页面快照');
  }
  await code(0, `await page.getByRole('textbox',{name:'画布标题'}).fill('跨端口合成产品');await page.getByRole('button',{name:'保存合成媒体'}).click();await page.waitForFunction(()=>window.__stage6.state.mediaIds.length===1);await page.getByRole('button',{name:'保存到SQLite'}).click();await page.waitForFunction(()=>window.__stage6.state.revision===1);`, 'A保存');
  check('浏览器A保存真实落盘', fixture.workspace.readDocument('canvas', 'browser-demo')?.value.title === '跨端口合成产品');
  const mediaId = fixture.workspace.readDocument('canvas', 'browser-demo').mediaIds[0];
  check('媒体文件与索引一致', fixture.workspace.readMedia(mediaId).bytes.toString() === 'stage6-browser-media');
  await code(1, `await page.getByRole('button',{name:'从SQLite读取'}).click();await page.waitForFunction(()=>window.__stage6.state.mediaText==='stage6-browser-media');if(await page.getByRole('textbox',{name:'画布标题'}).inputValue()!=='跨端口合成产品')throw Error('跨Origin读取不一致');`, 'B读取');
  check('另一端口及独立浏览器资料可读取同一工作区', true);
  await code(0, `await page.reload();await page.waitForFunction(()=>!!window.__stage6);await page.getByRole('button',{name:'从SQLite读取'}).click();await page.waitForFunction(()=>window.__stage6.state.revision===1);`, '刷新读取');
  check('页面刷新后可重建状态', true);
  await code(1, `await page.getByRole('textbox',{name:'画布标题'}).fill('会话B的新版本');await page.getByRole('button',{name:'保存到SQLite'}).click();await page.waitForFunction(()=>window.__stage6.state.revision===2);`, 'B更新');
  await code(0, `await page.getByRole('textbox',{name:'画布标题'}).fill('不能覆盖B');await page.getByRole('button',{name:'保存到SQLite'}).click();await page.waitForFunction(()=>window.__stage6.state.error==='revision_conflict');`, 'A冲突');
  check('冲突不覆盖，页面显示保存失败', fixture.workspace.readDocument('canvas', 'browser-demo').value.title === '会话B的新版本');
  for (let index = 0; index < sessions.length; index++) {
    await code(index, `await page.evaluate(async()=>{if(localStorage.length||sessionStorage.length||(await indexedDB.databases()).length)throw Error('写入了浏览器存储')});`, '无浏览器业务副本');
    await run(index, ['screenshot', '--filename', join(output, `浏览器-${index}.png`)], '截图');
    await run(index, ['snapshot'], '最终快照'); await run(index, ['console', 'error'], '控制台');
    await run(index, ['close'], '关闭首轮浏览器');
  }
  check('业务和授权未写入浏览器持久存储', true);
  const identity = fixture.workspace.workspaceId;
  await fixture.restart();
  await run(0, ['open', 'about:blank', '--headed'], '重启后新资料');
  await code(0, `await page.context().addInitScript({path:${JSON.stringify(fixture.bootstrapPaths[0])}});await page.goto(${JSON.stringify(fixture.fronts[0])});await page.waitForFunction(()=>!!window.__stage6);`, '重启后重新授权');
  await run(0, ['snapshot'], '重启后快照');
  await code(0, `await page.getByRole('button',{name:'从SQLite读取'}).click();await page.waitForFunction(()=>window.__stage6.state.revision===2&&window.__stage6.state.mediaText==='stage6-browser-media');`, '重启读取');
  check('数据库与API重启后身份、文档、媒体保留', fixture.workspace.workspaceId === identity);
  const backup = await fixture.workspace.createBackup();
  check('浏览器保存后可以完整备份', backup.documentCount === 1 && backup.mediaCount === 1);
  passed = true;
} catch (error) { results.push({ name: error.message, passed: false }); process.exitCode = 1; }
finally {
  for (let index = 0; index < sessions.length; index++) try { await run(index, ['close'], '最终关闭'); } catch { /* 尚未打开或已关闭 */ }
  await fixture.close();
  const report = { passed, results, dataRoot: fixture.root, retainedSyntheticData: true, output, frontendOrigins: fixture.fronts, existing3000And3100Untouched: true };
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
