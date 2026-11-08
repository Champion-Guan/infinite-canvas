import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';
import { createShardedPreviewFixture } from './SQLite分片浏览器夹具.mjs';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';
import { openWorkspace, restoreBackup } from '../扩展功能/本机存储/SQLite工作区.mjs';

检查运行副本();
const exec = promisify(execFile), cli = join(根目录, 'node_modules/.bin/playwright-cli');
const output = join(根目录, '.运行/output/playwright', 'SQLite分片预审-' + new Date().toISOString().replaceAll(':', '-')); mkdirSync(output, { recursive: true });
const session = 'guan-sharded-' + Date.now(), results = [], blocked = [], rootId = 'app-' + createHash('sha256').update('app_state').digest('hex');
let fixture, sequence = 0, passed = false, backup, finalCanvas, httpEvidence, coldResult;
async function run(args, label) {
  let stdout, stderr, failure;
  try { ({ stdout, stderr } = await exec(cli, ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), timeout: 45_000, maxBuffer: 3 * 1024 * 1024 })); }
  catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failure = error; }
  writeFileSync(join(output, `${sequence++}-${label}.log`), (stdout + stderr).replace(/[a-f0-9]{64}/g, '[内部材料已隐去]'), { flag: 'wx' });
  if (failure || /^### Error\b/m.test(stdout)) throw Error('浏览器步骤失败：' + label); return stdout;
}
async function code(source, label) { const marker = 'SHARDED_OK:' + label; if (!(await run(['run-code', `async page=>{${source};return ${JSON.stringify(marker)}}`], label)).includes(marker)) throw Error('缺少完成证明：' + label); }
function check(name, condition) { results.push({ name, passed: !!condition }); if (!condition) throw Error(name); }
async function click(name, label) {
  const snapshot = await run(['snapshot'], label + '-快照'), ref = snapshot.split('\n').find(line => line.includes('button "' + name + '"') && !line.includes('[disabled]'))?.match(/\[ref=([^\]]+)\]/)?.[1];
  if (!ref) throw Error('未找到可点击按钮：' + name); await run(['click', ref], label);
}
async function readCanvas(workspace) {
  const app = createShardedApplicationStorage({ client: { readDocument: async (...args) => workspace.readDocument(...args), writeDocument: async () => { throw Error('只读核验禁止写'); } } });
  try { return JSON.parse(await app.createInstance().getItem('infinite-canvas:canvas_store')); } finally { app.close(); }
}
const saved = "await page.getByRole('status').filter({hasText:'已保存到本机'}).waitFor({timeout:40000});";
const failed = "await page.getByRole('alert').filter({hasText:'保存尚未确认'}).waitFor({timeout:40000});";
try {
  fixture = await createShardedPreviewFixture();
  check('合成候选构建和批准磁盘包启动，不更改原画布或默认120次限流', fixture.getStatus().backup.lastBackup?.reason === 'startup');
  await run(['open', 'about:blank', '--headed'], '独立浏览器'); await run(['snapshot'], '初始快照');
  await code(`await page.context().addInitScript(()=>{window.__storageCalls=[];window.__http=[];for(const name of ['getItem','setItem','removeItem','clear'])Storage.prototype[name]=function(){window.__storageCalls.push(name);throw Error('禁止浏览器持久化')};IDBFactory.prototype.open=function(){window.__storageCalls.push('indexedDB');throw Error('禁止浏览器持久化')};const request=window.fetch;window.fetch=async(...args)=>{const u=new URL(args[0],location.href),observed=/^\\/v1\\/workspaces\\/|^\\/usage$/.test(u.pathname),time=performance.now();try{const response=await request(...args);if(observed)window.__http.push({time,status:response.status,method:args[1]?.method??'GET'});return response}catch(error){if(observed)window.__http.push({time,status:0,method:args[1]?.method??'GET'});throw error}}});await page.context().route('**/*',route=>{const u=new URL(route.request().url());return [${JSON.stringify(fixture.origin)},${JSON.stringify(fixture.dataURL)}].includes(u.origin)||['blob:','data:'].includes(u.protocol)?route.continue():route.abort()});await page.goto(${JSON.stringify(fixture.origin)});await page.getByRole('heading',{name:'SQLite分片隔离合成界面（非原画布）',exact:true}).waitFor()`, '无注入免填码启动');
  await click('保存20产品5000节点', '首次大画布保存'); await code(saved, '大画布真实HTTP确认');
  let canvas = await readCanvas(fixture.workspace);
  check('默认HTTP安全限制下5000节点完整落盘并收到ACK', canvas.state.projects.length === 20 && canvas.state.projects.every(p => p.nodes.length === 250) && fixture.workspace.readDocument('extension', rootId).revision === 1);
  await code("await page.evaluate(()=>window.__lostWrites=[]);let once=true;await page.route('**/documents/extension/*',async route=>{if(route.request().method()!=='PUT')return route.continue();const body=route.request().postDataJSON();await page.evaluate(x=>window.__lostWrites.push(x),{id:route.request().url().split('/').at(-1),operationId:body.operationId});if(once){once=false;await route.fetch();return route.abort()}return route.continue()})", '块落盘后丢ACK');
  await click('修改首产品名称', '块丢ACK的编辑'); await code(failed, '块失败状态');
  check('块已写入但根仍指向完整旧代，UI没有谎报成功', fixture.workspace.readDocument('extension', rootId).revision === 1 && (await readCanvas(fixture.workspace)).state.projects[0].title === '合成产品0');
  await click('修改首产品名称', '失败后的新编辑'); await click('重试未确认保存', '原块请求重试');
  await code(`${saved}const writes=await page.evaluate(()=>window.__lostWrites);if(writes.length<3||writes[0].operationId!==writes[1].operationId||writes[0].id!==writes[1].id)throw Error('块请求ID改变');await page.unroute('**/documents/extension/*')`, '旧块确认后继续新编辑');
  check('原块operationId重试及新编辑FIFO，根revision恰为3', fixture.workspace.readDocument('extension', rootId).revision === 3 && (await readCanvas(fixture.workspace)).state.projects[0].title === '合成产品0-修改-修改');
  await code(`await page.evaluate(()=>window.__lostRoots=[]);let once=true;await page.route('**/documents/extension/${rootId}',async route=>{if(route.request().method()!=='PUT')return route.continue();const id=route.request().postDataJSON().operationId;await page.evaluate(id=>window.__lostRoots.push(id),id);if(once){once=false;await route.fetch();return route.abort()}return route.continue()})`, '根落盘后丢ACK');
  await click('修改一个节点', '根丢ACK的节点编辑'); await code(failed, '根失败状态');
  check('根已提交但ACK丢失时仍明确提示未确认', fixture.workspace.readDocument('extension', rootId).revision === 4);
  await click('修改首产品名称', '根失败后新编辑'); await click('重试未确认保存', '原根请求重试');
  await code(`${saved}const ids=await page.evaluate(()=>window.__lostRoots);if(ids.length!==3||ids[0]!==ids[1]||ids[1]===ids[2])throw Error('根请求ID/revision错误');await page.unroute('**/documents/extension/${rootId}')`, '原根重试及后续提交');
  finalCanvas = await readCanvas(fixture.workspace);
  check('根原ID重试不重复revision，后续编辑全部确认', fixture.workspace.readDocument('extension', rootId).revision === 5 && finalCanvas.state.projects[0].title === '合成产品0-修改-修改-修改' && finalCanvas.state.projects[0].nodes[0].metadata.text.endsWith('-尺寸关键词'));
  await click('保存合成图片', '真实媒体保存');
  await code(`${saved}await page.getByAltText('SQLite合成图片').waitFor();await page.waitForFunction(()=>[...document.images].some(img=>img.complete&&img.naturalWidth===1))`, '图片真实落盘显示');
  const evidenceText = await run(['eval', 'JSON.stringify(window.__http)'], 'HTTP计数');
  const jsonLine = evidenceText.split('\n').find(line => line.startsWith('"[')); httpEvidence = JSON.parse(JSON.parse(jsonLine));
  check('全过程没有429/503，客户端排队而不是放宽服务限制', httpEvidence.length > 240 && httpEvidence.every(row => [200, 201, 404, 0].includes(row.status)));
  await code(`await page.reload();await page.getByRole('heading',{name:'SQLite分片隔离合成界面（非原画布）',exact:true}).waitFor({timeout:40000});await page.getByText('节点数量：5000',{exact:true}).waitFor();await page.getByText('首产品：合成产品0-修改-修改-修改',{exact:true}).waitFor();await page.waitForFunction(()=>[...document.images].some(img=>img.complete&&img.naturalWidth===1));if(await page.evaluate(()=>window.__storageCalls.length))throw Error('调用浏览器库');if((await page.context().cookies()).length)throw Error('出现Cookie');if(await page.locator('meta[name=guan-local-bootstrap],input[type=password]').count())throw Error('残留启动材料')`, '新文档冷读取5000节点和图片');
  assert.deepEqual(await readCanvas(fixture.workspace), finalCanvas); check('刷新恢复精确5000节点及媒体，Storage/IDB零调用、Cookie零', true);
  const errors = await run(['console', 'error'], '控制台'); check('无React/CSP/未处理异常，预期断线和404日志保留', !/Uncaught|Unhandled|TypeError|ReferenceError|Content Security Policy|Invalid hook/i.test(errors));
  await run(['screenshot', '--filename', join(output, '分片保存与刷新.png')], '最终截图'); backup = await fixture.createBackup(); passed = true;
} catch (error) { blocked.push({ boundary: '分片合成React→真实默认HTTP→SQLite→ACK→刷新', reason: error.message }); process.exitCode = 1; }
finally {
  try { await run(['snapshot'], '最终快照'); await run(['console', 'error'], '最终错误'); } catch { /* 尚未启动时仅记录已有证据。 */ }
  try { await run(['close'], '关闭本轮浏览器'); } catch { /* 不接触其他浏览器。 */ }
  try {
    await fixture?.close();
    if (passed) {
      const restored = join(fixture.root, '冷恢复'); restoreBackup({ backupRoot: backup.path, targetRoot: restored });
      const workspace = openWorkspace({ dataRoot: restored });
      try { assert.deepEqual(await readCanvas(workspace), finalCanvas); const app = createShardedApplicationStorage({ client: { readDocument: async (...args) => workspace.readDocument(...args), writeDocument: async () => { throw Error('只读核验'); }, readMedia: async id => { const media = workspace.readMedia(id); return new Blob([media.bytes], { type: media.mime }); } } });
        try { const blob = await app.createInstance({ storeName: 'image_files' }).getItem('synthetic-png'); check('完整备份冷恢复全部分片及真实媒体内容', blob.type === 'image/png' && blob.size === 68); } finally { app.close(); }
        coldResult = { restored, exactCanvas: true, mediaChecked: true };
      } finally { workspace.close(); }
      check('原库与冷恢复库正常解锁，没有自动清锁', !existsSync(join(fixture.dataRoot, '.实例锁.json')) && !existsSync(join(restored, '.实例锁.json')));
    }
  } catch (error) { passed = false; blocked.push({ boundary: '关闭及备份冷读', reason: error.message }); process.exitCode = 1; }
  const report = { passed, results, blocked, output, httpRequests: httpEvidence?.length, httpEvidence, coldResult, syntheticDataRoot: fixture?.dataRoot,
    candidateOnly: true, application: '合成React界面，不是原画布', defaultServiceRateLimit: 120, real3100Untouched: true, authorizationRuntimeInjected: false, productionTakenOver: false };
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify({ ...report, httpEvidence: httpEvidence ? '逐请求时间与状态保存在验收结果.json' : null }, null, 2));
}
