import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { 根目录 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';
import { createCredentialCanvasFixture } from './SQLite凭据原画布夹具.mjs';
import { createCoalescedCredentialCanvasFixture } from './SQLite配置合并原画布夹具.mjs';
import { createDailyCanvasFixture } from './SQLite日常启动原画布夹具.mjs';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';
import { openSQLiteCredentialVault } from '../扩展功能/本机凭据/SQLite凭据保管.mjs';
import { openWorkspace, restoreBackup } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { canvasSemanticSnapshot } from './原画布存储语义比较.mjs';

检查运行副本();
const argumentsList = process.argv.slice(2);
const option = argumentsList[0], coalesced = option?.startsWith('--配置合并前置=') || option?.startsWith('--配置合并复验=');
const daily = option?.startsWith('--日常启动复验=');
if (argumentsList.length > 1 || option && !['--复验记录=', '--配置合并前置=', '--配置合并复验=', '--日常启动复验='].some(prefix => option.startsWith(prefix))) throw Error('只支持新隔离副本或严格核验的批准接入记录');
const reviewRecord = option?.slice(option.indexOf('=') + 1);
const exec = promisify(execFile), cli = join(根目录, 'node_modules/.bin/playwright-cli');
const output = join(根目录, '.运行/output/playwright', (daily ? 'SQLite日常启动原画布-' : coalesced ? 'SQLite配置合并原画布-' : 'SQLite凭据原画布-') + new Date().toISOString().replaceAll(':', '-')); mkdirSync(output, { recursive: true });
const session = 'guan-credential-canvas-' + Date.now(), results = [], blocked = [];
const firstSecret = 'synthetic-canvas-key-第一份-非真实凭据', secondSecret = 'synthetic-canvas-key-第二份-非真实凭据';
let fixture, sequence = 0, passed = false, receipt, coldChecks;
const sanitize = text => text.replaceAll(firstSecret, '[虚构凭据1]').replaceAll(secondSecret, '[虚构凭据2]').replace(/[a-f0-9]{64}/g, '[内部材料已隐去]');
async function run(args, label) {
  let stdout, stderr, failure;
  try { ({ stdout, stderr } = await exec(cli, ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), timeout: 55_000, maxBuffer: 3 * 1024 * 1024 })); }
  catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failure = error; }
  writeFileSync(join(output, `${sequence++}-${label}.log`), sanitize(stdout + stderr), { flag: 'wx', mode: 0o600 });
  if (failure || /^### Error\b/m.test(stdout)) throw Error('浏览器步骤失败：' + label); return stdout;
}
function check(name, condition) { results.push({ name, passed: !!condition }); if (!condition) throw Error(name); }
async function code(source, label) {
  const marker = 'CREDENTIAL_CANVAS_OK:' + label;
  if (!(await run(['run-code', `async page=>{${source};return ${JSON.stringify(marker)}}`], label)).includes(marker)) throw Error('缺少完成证明：' + label);
}
async function click(name, label) {
  const snapshot = await run(['snapshot'], label + '-快照');
  const ref = snapshot.split('\n').find(line => line.match(/button "([^"]*)"/)?.[1].replaceAll(' ', '') === name && !line.includes('[disabled]') &&
    (name !== '文本' || line.includes('[cursor=pointer]')))?.match(/\[ref=([^\]]+)\]/)?.[1];
  if (!ref) throw Error('快照缺少可点击按钮：' + name); await run(['click', ref], label);
}
const saved = "await page.waitForFunction(()=>window.__recoveryStatus?.state==='saved'&&window.__recoveryStatus.pending===0,{},{timeout:40000});";
const failed = "await page.getByRole('alert').filter({hasText:'保存尚未确认'}).waitFor({timeout:40000});";
const clean = "if(await page.locator('meta[name=guan-local-bootstrap]').count())throw Error('内部材料残留');if(await page.evaluate(()=>window.__persistenceCalls.length))throw Error('访问浏览器存储');if((await page.context().cookies()).length)throw Error('出现Cookie');";
async function readState(workspace) {
  const vault = await openSQLiteCredentialVault({ workspace, keyProvider: fixture.testKeyProvider });
  const app = createShardedApplicationStorage({ client: { readDocument: async (...args) => workspace.readDocument(...args), readMedia: async id => {
    const media = workspace.readMedia(id); return new Blob([media.bytes], { type: media.mime });
  } }, secretPort: vault });
  try {
    const store = app.createInstance(), result = {};
    for (const key of ['ai_config_store', 'canvas_store', 'theme_store']) result[key] = JSON.parse(await store.getItem('infinite-canvas:' + key));
    if (result.canvas_store) result.canvas_store = (await canvasSemanticSnapshot(result.canvas_store)).value;
    return result;
  } finally { app.close(); vault.close(); }
}
function secretRows() { return fixture.workspace.listDocuments('extension').filter(row => row.id.startsWith('secret:')); }
function noPlaintext() {
  return fixture.workspace.listDocuments('extension').every(row => {
    const text = JSON.stringify(fixture.workspace.readDocument('extension', row.id)); return !text.includes(firstSecret) && !text.includes(secondSecret);
  });
}
async function editSecret(value, label) {
  await click('画布设置', label + '-设置'); await run(['snapshot'], label + '-设置展开');
  await click('编辑', label + '-编辑渠道'); await run(['snapshot'], label + '-渠道展开');
  // 已由快照和真实源码确认的原生API Key输入，不注入应用状态。
  await code(`await page.getByPlaceholder('sk-...',{exact:true}).fill(${JSON.stringify(value)});`, label + '-填写');
  await click('保存', label + '-保存渠道');
}
async function closeSettings() {
  await run(['snapshot'], '设置关闭前快照');
  await code("await page.getByRole('dialog').filter({has:page.getByRole('tab',{name:'渠道',exact:true})}).getByRole('button',{name:'关闭',exact:true}).click();", '关闭设置');
}
try {
  fixture = daily ? await createDailyCanvasFixture({ reviewRecord }) : coalesced ? await createCoalescedCredentialCanvasFixture(option.startsWith('--配置合并复验=') ? { reviewRecord } : { prerequisiteRecord: reviewRecord }) : await createCredentialCanvasFixture({ reviewRecord });
  if (daily) check('批准日常启动3文件磁盘事务、完整类型和原React构建通过，使用随机localhost隔离入口', fixture.integration.日常启动已完成 && fixture.integration.日常启动文件数 === 3 && /^http:\/\/localhost:\d+$/.test(fixture.origin) && new URL(fixture.origin).port !== '3100');
  if (coalesced) check('批准配置合并1文件隔离事务、完整类型和原React构建通过', fixture.integration.配置合并已完成 && fixture.integration.配置合并文件数 === 1);
  check('10文件完整批准磁盘装配和原React构建通过', fixture.integration.凭据接入已完成 && fixture.integration.凭据接入文件数 === 10);
  check('首备份含加密凭据库标记，启动不访问Keychain', fixture.getStatus().backup.lastBackup?.documentCount === 1);
  await run(['open', 'about:blank', '--headed'], '独立浏览器'); await run(['snapshot'], '初始快照');
  await code(`await page.context().addInitScript(()=>{window.__persistenceCalls=[];window.__recoveryStatus=null;window.__credentialHTTP=[];window.__documentIdentity=crypto.randomUUID();window.addEventListener('guan:storage-status',event=>window.__recoveryStatus=event.detail);for(const name of ['getItem','setItem','removeItem','clear'])Storage.prototype[name]=function(){window.__persistenceCalls.push(name);throw Error('禁止浏览器持久化')};IDBFactory.prototype.open=function(){window.__persistenceCalls.push('indexedDB');throw Error('禁止浏览器持久化')};const request=window.fetch;window.fetch=async(...args)=>{const u=new URL(args[0],location.href),observed=u.pathname==='/__guan-local/credentials';try{const response=await request(...args);if(observed)window.__credentialHTTP.push({status:response.status,operation:JSON.parse(args[1].body).operation});return response}catch(error){if(observed)window.__credentialHTTP.push({status:0});throw error}}});await page.emulateMedia({colorScheme:'light'});await page.context().route('**/*',route=>{const u=new URL(route.request().url());return [${JSON.stringify(fixture.origin)},${JSON.stringify(fixture.dataURL)}].includes(u.origin)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort()});await page.goto(${JSON.stringify(fixture.origin)});await page.getByRole('banner',{name:'工作台顶栏'}).getByRole('button',{name:'新建产品',exact:true}).waitFor();${clean}`, '免填码首页');
  check('真实导航自动握手，不注入host或会话材料', fixture.getStatus().authorization.authorizedPages >= 1);
  await click('新建产品', '原UI新建产品'); await code("await page.waitForURL('**/canvas/*');await page.getByRole('button',{name:'文本',exact:true}).first().waitFor();" + saved, '基线保存');
  await editSecret(firstSecret, '首份虚构凭据'); await code(saved, '首份配置ACK');
  const state = await readState(fixture.workspace);
  check('原渠道编辑保存经HTTP凭据端口加密落盘并能解密还原', state.ai_config_store.state.config.channels[0].apiKey === firstSecret && secretRows().length === 1 && noPlaintext());
  await closeSettings();
  await click('文本', '实际新增文本'); await code(saved, '文本ACK');
  await code(`await page.locator('input[type=file][accept*="image/"]').first().setInputFiles({name:'凭据测试图片.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2nJ6kAAAAASUVORK5CYII=','base64')});await page.waitForFunction(()=>document.querySelectorAll('[data-node-id]').length===2);` + saved, '真实图片保存');
  await click('切换深色主题', '原主题切换'); await code(saved, '主题ACK');
  check('凭据接入后原画布文本图片主题仍保存', (await readState(fixture.workspace)).canvas_store.state.projects[0].nodes.length === 2);
  await code(`${saved}const old=await page.evaluate(()=>window.__documentIdentity);await page.reload();await page.waitForFunction(old=>window.__documentIdentity!==old,old);await page.waitForFunction(()=>document.querySelectorAll('[data-node-id]').length===2);await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));${saved}${clean}`, '刷新原画布');
  await click('画布设置', '刷新后设置'); await run(['snapshot'], '刷新后设置快照'); await click('编辑', '刷新后渠道'); await run(['snapshot'], '刷新后渠道快照');
  await code(`if(await page.getByPlaceholder('sk-...',{exact:true}).inputValue()!==${JSON.stringify(firstSecret)})throw Error('凭据刷新不一致');await page.getByRole('button',{name:'取 消',exact:true}).click();`, '原输入框恢复凭据');
  check('刷新新文档经HTTP解密恢复原渠道输入框，业务数据不丢', (await readState(fixture.workspace)).ai_config_store.state.config.channels[0].apiKey === firstSecret);
  await closeSettings();
  // 设置开关本身也会持久化配置，不能把旧凭据的重复保存误当成第二份凭据落盘。
  // 只对本次编辑值丢ACK，并核实转发成功；不改变应用、网关或授权材料。
  await code(`let drop=true;const diagnostics=[];await page.exposeFunction('__credentialFaultDiagnostics',()=>diagnostics);await page.route('**/__guan-local/credentials',async route=>{const command=route.request().postDataJSON();if(command.operation!=='store')return route.continue();const target=command.value===${JSON.stringify(secondSecret)};if(!target){diagnostics.push({target:false});return route.continue()}if(drop){drop=false;const response=await route.fetch();diagnostics.push({target:true,status:response.status()});if(response.status()!==200)return route.fulfill({response});return route.abort()}return route.continue()})`, '凭据落盘丢ACK');
  await editSecret(secondSecret, '第二份虚构凭据'); await code(failed, '凭据未确认提示');
  await code("const rows=await page.evaluate(()=>window.__credentialFaultDiagnostics());console.log(JSON.stringify(rows));if(!rows.some(row=>row.target&&row.status===200))throw Error('丢ACK夹具没有证明目标凭据HTTP200')", '目标凭据故障诊断');
  check('凭据密文已写但丢ACK时配置保留旧值，不假报成功', secretRows().length === 2 && (await readState(fixture.workspace)).ai_config_store.state.config.channels[0].apiKey === firstSecret && noPlaintext());
  // 原设置模态遮罩按设计拦截页面点击，先通过原关闭按钮退出，再重试；不强制穿透遮罩。
  await closeSettings();
  await click('重试未确认保存', '原UI重试凭据'); await code(saved, '重试完整ACK');
  check('原UI重试复用密文引用，配置最终确认新凭据', secretRows().length === 2 && secretRows().every(row => row.revision === 1) && (await readState(fixture.workspace)).ai_config_store.state.config.channels[0].apiKey === secondSecret && noPlaintext());
  await code("await page.unroute('**/__guan-local/credentials')", '移除丢ACK夹具');
  await code("await page.route('**/__guan-local/credentials',route=>route.request().postDataJSON().operation==='store'?route.abort():route.continue())", '凭据持续断线');
  await editSecret(firstSecret, '断线修改'); await code(failed, '断线保存提示');
  check('持续凭据断线不覆盖已确认配置，不明文降级', (await readState(fixture.workspace)).ai_config_store.state.config.channels[0].apiKey === secondSecret && noPlaintext());
  await closeSettings();
  await code("await page.unroute('**/__guan-local/credentials')", '恢复凭据连接'); await click('重试未确认保存', '恢复凭据重试'); await code(saved, '恢复后ACK');
  check('恢复后原队列重新确认，复用历史密文无额外条目', (await readState(fixture.workspace)).ai_config_store.state.config.channels[0].apiKey === firstSecret && secretRows().length === 2);
  receipt = await fixture.createBackup();
  const restored = join(fixture.root, '冷恢复'); restoreBackup({ backupRoot: receipt.path, targetRoot: restored });
  const cold = openWorkspace({ dataRoot: restored });
  try {
    const original = await readState(fixture.workspace), recovered = await readState(cold); assert.deepEqual(recovered, original);
    coldChecks = { exactState: true, secretCount: cold.listDocuments('extension').filter(row => row.id.startsWith('secret:')).length };
  } finally { cold.close(); }
  const db = new DatabaseSync(join(restored, '工作台.sqlite'), { readOnly: true });
  try { coldChecks.integrity = db.prepare('PRAGMA integrity_check').get().integrity_check; coldChecks.foreignKeys = db.prepare('PRAGMA foreign_key_check').all().length; } finally { db.close(); }
  check('备份冷恢复在同测试主密钥下精确恢复配置画布主题，数据库完整', coldChecks.exactState && coldChecks.secretCount === 2 && coldChecks.integrity === 'ok' && coldChecks.foreignKeys === 0 && !existsSync(join(restored, '.实例锁.json')));
  await code(`${saved}${clean}const rows=await page.evaluate(()=>window.__credentialHTTP);if(!rows.some(row=>row.operation==='read'&&row.status===200)||rows.some(row=>row.status===429))throw Error('凭据HTTP异常');`, '最终浏览器核验');
  check('全程浏览器持久化及Cookie零、无残留内部材料', true);
  const errors = await run(['console', 'error'], '控制台异常');
  check('无React、CSP或未处理异常，主动断线记录保留', !/TypeError|ReferenceError|Uncaught|Unhandled|Invalid hook|caught the following error|Content Security Policy|Refused to connect|Fetch API cannot load/i.test(errors));
  await run(['screenshot', '--filename', join(output, '凭据原画布验收.png')], '最终画布截图'); passed = true;
} catch (error) { blocked.push({ boundary: '磁盘批准装配→原渠道UI→加密SQLite→刷新→失败重试→冷恢复', reason: error.message }); process.exitCode = 1; }
finally {
  try { await run(['snapshot'], '最终快照'); await run(['console', 'error'], '最终错误'); await run(['screenshot', '--filename', join(output, '最终状态.png')], '最终截图'); } catch { /* 构建可能尚未完成。 */ }
  try { await run(['close'], '关闭本轮独立浏览器'); } catch { /* 不触碰其他浏览器。 */ }
  try { await fixture?.close(); } catch (error) { passed = false; blocked.push({ boundary: '正常停止', reason: error.message }); process.exitCode = 1; }
  const report = { passed, results, blocked, coldChecks, output, syntheticDataRoot: fixture?.dataRoot, integration: fixture?.integration, serviceIntegration: fixture?.serviceIntegration,
    application: daily ? '批准日常启动3文件磁盘后继与localhost真实原React画布' : coalesced ? '批准配置合并1文件后继与真实原React画布' : '批准磁盘10文件与真实原React画布', candidateOnly: false, authorizationRuntimeInjected: false, browserBusinessDataInjected: false, reviewRecord,
    credentialProvider: '显式随机内存测试主密钥；未访问Keychain', realCredentialUsed: false, defaultServiceRateLimit: 120,
    actualIsolatedOrigin: fixture?.origin, real3100Untouched: true, production3100TakenOver: false };
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); console.log(JSON.stringify(report, null, 2));
}
