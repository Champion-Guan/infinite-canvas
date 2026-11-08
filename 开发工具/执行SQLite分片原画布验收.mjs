import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { 根目录 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';
import { createShardedCanvasFixture } from './SQLite分片原画布夹具.mjs';
import { createShardedApplicationStorage } from '../扩展功能/本机存储/分片应用存储.mjs';
import { restoreBackup } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { canvasSemanticSnapshot, validRefreshTimes } from './原画布存储语义比较.mjs';

检查运行副本();
const exec = promisify(execFile), cli = join(根目录, 'node_modules/.bin/playwright-cli');
const output = join(根目录, '.运行/output/playwright', 'SQLite分片原画布-' + new Date().toISOString().replaceAll(':', '-')); mkdirSync(output, { recursive: true });
const session = 'guan-sharded-canvas-' + Date.now(), results = [], blocked = [], rootId = 'app-' + createHash('sha256').update('app_state').digest('hex');
let fixture, sequence = 0, passed = false, receipt, coldChecks, finalCanvas, beforeRefresh, afterRefresh, requestEvidence;
async function run(args, label) {
  let stdout, stderr, failure;
  try { ({ stdout, stderr } = await exec(cli, ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), timeout: 55_000, maxBuffer: 3 * 1024 * 1024 })); }
  catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failure = error; }
  writeFileSync(join(output, `${sequence++}-${label}.log`), (stdout + stderr).replace(/[a-f0-9]{64}/g, '[内部材料已隐去]'), { flag: 'wx' });
  if (failure || /^### Error\b/m.test(stdout)) throw Error('浏览器步骤失败：' + label); return stdout;
}
function check(name, condition) { results.push({ name, passed: !!condition }); if (!condition) throw Error(name); }
async function code(source, label) {
  const marker = 'SHARDED_CANVAS_OK:' + label;
  if (!(await run(['run-code', `async page=>{${source};return ${JSON.stringify(marker)}}`], label)).includes(marker)) throw Error('缺少完成证明：' + label);
}
async function click(name, label) {
  const snapshot = await run(['snapshot'], label + '-快照');
  const ref = snapshot.split('\n').find(line => line.includes('button "' + name + '"') && !line.includes('[disabled]') &&
    (name !== '文本' || line.includes('[cursor=pointer]')))?.match(/\[ref=([^\]]+)\]/)?.[1];
  if (!ref) throw Error('快照缺少可点击按钮：' + name); await run(['click', ref], label);
}
async function readState(client) {
  const app = createShardedApplicationStorage({ client });
  try {
    const store = app.createInstance();
    const result = new Map(await Promise.all(['infinite-canvas:canvas_store', 'infinite-canvas:theme_store'].map(async key => [key, JSON.parse(await store.getItem(key))])));
    const snapshot = await canvasSemanticSnapshot(result.get('infinite-canvas:canvas_store'));
    result.set('infinite-canvas:canvas_store', snapshot.value); result.set('__canvasSnapshot', snapshot); return result;
  } finally { app.close(); }
}
async function liveState() { return readState({ readDocument: async (...args) => fixture.workspace.readDocument(...args), readMedia: async id => {
  const media = fixture.workspace.readMedia(id); return new Blob([media.bytes], { type: media.mime });
} }); }
async function nodeCount() { return (await liveState()).get('infinite-canvas:canvas_store')?.state.projects[0]?.nodes.length ?? 0; }
async function waitCanvas(count) {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) { if (await nodeCount() === count) return; await new Promise(done => setTimeout(done, 100)); }
  throw Error('真实SQLite画布节点保存未确认：' + count);
}
const noManual = "if(await page.locator('input[type=password],meta[name=guan-local-bootstrap]').count())throw Error('仍有手填码或内部材料');";
const saved = "await page.waitForFunction(()=>window.__recoveryStatus?.state==='saved'&&window.__recoveryStatus.pending===0,{},{timeout:40000});if(await page.evaluate(()=>window.__persistenceCalls.length))throw Error('访问浏览器存储');";
const failed = "await page.getByRole('alert').filter({hasText:'保存尚未确认'}).waitFor({timeout:40000});";
async function inspectCold(root) {
  const db = new DatabaseSync(join(root, '工作台.sqlite'), { readOnly: true });
  try {
    const state = await readState({ readDocument: async (collection, id) => {
      const row = db.prepare('SELECT * FROM documents WHERE collection=? AND id=?').get(collection, id); if (!row) return null;
      return { collection, id, value: JSON.parse(row.body), revision: row.revision, mediaIds: db.prepare('SELECT media_id FROM document_media WHERE collection=? AND document_id=? ORDER BY media_id').all(collection, id).map(row => row.media_id) };
    }, readMedia: async id => new Blob([readFileSync(join(root, '媒体', id))]) });
    const media = db.prepare('SELECT * FROM media').all(), canvas = state.get('infinite-canvas:canvas_store'); assert.deepEqual(canvas, finalCanvas);
    return { integrity: db.prepare('PRAGMA integrity_check').get().integrity_check, foreignKeys: db.prepare('PRAGMA foreign_key_check').all().length,
      exactCanvas: true, nodeCount: canvas.state.projects[0].nodes.length, themeMode: state.get('infinite-canvas:theme_store')?.state.mode,
      fragments: db.prepare("SELECT count(*) AS n FROM documents WHERE id LIKE 'app-part-%'").get().n,
      validMedia: media.every(row => { const bytes = readFileSync(join(root, '媒体', row.id)); return bytes.length === row.size && createHash('sha256').update(bytes).digest('hex') === row.id; }),
      mediaCount: media.length, lockAbsent: !existsSync(join(root, '.实例锁.json')) };
  } finally { db.close(); }
}
try {
  fixture = await createShardedCanvasFixture();
  check('全部批准前置和4文件同笔事务装配，真实Vite构建成功', fixture.integration.分片存储已接入 && fixture.integration.分片存储文件数 === 4);
  check('批准磁盘启动器先完成首份备份再开放工作台', fixture.getStatus().backup.lastBackup?.reason === 'startup');
  await run(['open', 'about:blank', '--headed'], '独立浏览器'); await run(['snapshot'], '初始快照');
  await code(`await page.context().addInitScript(()=>{window.__persistenceCalls=[];window.__recoveryStatus=null;window.__documentIdentity=crypto.randomUUID();window.__http=[];window.addEventListener('guan:storage-status',event=>window.__recoveryStatus=event.detail);for(const name of ['getItem','setItem','removeItem','clear'])Storage.prototype[name]=function(){window.__persistenceCalls.push(name);throw Error('禁止浏览器持久化')};IDBFactory.prototype.open=function(){window.__persistenceCalls.push('indexedDB');throw Error('禁止浏览器持久化')};const request=window.fetch;window.fetch=async(...args)=>{const u=new URL(args[0],location.href),observed=/^\\/v1\\/workspaces\\/|^\\/usage$/.test(u.pathname),time=performance.now();try{const response=await request(...args);if(observed)window.__http.push({time,status:response.status,method:args[1]?.method??'GET'});return response}catch(error){if(observed)window.__http.push({time,status:0,method:args[1]?.method??'GET'});throw error}}});await page.emulateMedia({colorScheme:'light'});await page.context().route('**/*',route=>{const u=new URL(route.request().url());return [${JSON.stringify(fixture.origin)},${JSON.stringify(fixture.dataURL)}].includes(u.origin)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort()});await page.goto(${JSON.stringify(fixture.origin)});await page.getByRole('banner',{name:'工作台顶栏'}).getByRole('button',{name:'新建产品',exact:true}).waitFor();${noManual}`, '免填码进入真实首页');
  check('未注入host或授权材料，直接进入真实首页', fixture.getStatus().authorization.authorizedPages >= 1);
  await click('新建产品', '实际新建产品'); await code("await page.waitForURL('**/canvas/*');await page.getByRole('button',{name:'文本',exact:true}).waitFor();" + saved, '实际画布基线保存');
  const initialRevision = fixture.workspace.readDocument('extension', rootId).revision;
  check('原UI创建的产品已按v2分片落盘', await nodeCount() === 0 && fixture.workspace.readDocument('extension', rootId).value.format === 'guan-app-storage.v2');
  await code("await page.evaluate(()=>window.__partIds=[]);let drop=true;await page.route('**/documents/extension/app-part-*',async route=>{if(route.request().method()!=='PUT')return route.continue();const body=route.request().postDataJSON();await page.evaluate(x=>window.__partIds.push(x),{id:route.request().url().split('/').at(-1),operationId:body.operationId});if(drop){drop=false;await route.fetch();return route.abort()}return route.continue()})", '块落盘后丢ACK');
  await click('文本', '实际新增文本块丢ACK'); await code(failed, '块失败提示');
  check('块落盘但未ACK时根仍是完整旧代，真实画布显示失败', await nodeCount() === 0 && fixture.workspace.readDocument('extension', rootId).revision === initialRevision);
  await click('文本', '块失败后继续编辑'); await click('重试未确认保存', '原块重试'); await waitCanvas(2);
  await code(`${saved}const ids=await page.evaluate(()=>window.__partIds);if(ids.length<2||ids[0].operationId!==ids[1].operationId||ids[0].id!==ids[1].id)throw Error('块请求ID改变');await page.unroute('**/documents/extension/app-part-*')`, '块原ID与后续编辑ACK');
  check('块原ID重试后后续编辑FIFO保存，根只增加两代', fixture.workspace.readDocument('extension', rootId).revision === initialRevision + 2);
  await code(`await page.evaluate(()=>window.__rootIds=[]);let drop=true;await page.route('**/documents/extension/${rootId}',async route=>{if(route.request().method()!=='PUT')return route.continue();await page.evaluate(id=>window.__rootIds.push(id),route.request().postDataJSON().operationId);if(drop){drop=false;await route.fetch();return route.abort()}return route.continue()})`, '根提交后丢ACK');
  await click('文本', '实际第三节点根丢ACK'); await code(failed, '根失败提示'); await waitCanvas(3);
  check('根已落盘丢ACK仍不假报成功', fixture.workspace.readDocument('extension', rootId).revision === initialRevision + 3);
  await click('文本', '根失败后继续编辑'); await click('重试未确认保存', '原根重试'); await waitCanvas(4);
  await code(`${saved}const ids=await page.evaluate(()=>window.__rootIds);if(ids.length!==3||ids[0]!==ids[1]||ids[1]===ids[2])throw Error('根请求ID不符');await page.unroute('**/documents/extension/${rootId}')`, '根原ID与后续ACK');
  check('根原ID重试不重复revision，后续第四节点确认', fixture.workspace.readDocument('extension', rootId).revision === initialRevision + 4);
  await code("await page.route('**/documents/extension/*',route=>route.request().method()==='PUT'?route.abort():route.continue())", '持续断线');
  await click('文本', '断线第五节点'); await code(failed, '断线提示'); await click('重试未确认保存', '断线重试'); await code(failed, '断线仍失败');
  check('持续断线不覆盖四节点原库或假报成功', await nodeCount() === 4);
  await code("await page.unroute('**/documents/extension/*')", '恢复连接'); await click('重试未确认保存', '恢复后重试'); await waitCanvas(5); await code(saved, '第五节点确认');
  await code(`await page.locator('input[type=file][accept*="image/"]').first().setInputFiles({name:'分片原画布临时图片.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2nJ6kAAAAASUVORK5CYII=','base64')})`, '真实上传图片');
  await waitCanvas(6); await code(saved, '媒体ACK');
  check('真实上传图片同时保存媒体及根引用', (await liveState()).get('infinite-canvas:canvas_store').state.projects[0].nodes.some(node => node.type === 'image' && node.metadata?.storageKey?.startsWith('image:')) && fixture.workspace.readDocument('extension', rootId).mediaIds.length > 0);
  await click('切换深色主题', '顶栏深色主题'); await code("await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));" + saved, '主题ACK');
  check('原顶栏主题写入SQLite', (await liveState()).get('infinite-canvas:theme_store')?.state.mode === 'dark');
  beforeRefresh = (await liveState()).get('__canvasSnapshot'); finalCanvas = beforeRefresh.value;
  const evidenceText = await run(['eval', 'JSON.stringify(window.__http)'], 'HTTP计数');
  requestEvidence = JSON.parse(JSON.parse(evidenceText.split('\n').find(line => line.startsWith('"['))));
  check('默认限流保持，除主动断线和空记录外无429或503', requestEvidence.length > 0 && requestEvidence.every(row => [200, 201, 404, 0].includes(row.status)));
  await code(`${saved}const old=await page.evaluate(()=>window.__documentIdentity);await page.reload();await page.waitForFunction(old=>window.__documentIdentity!==old,old);await page.getByRole('button',{name:'文本',exact:true}).first().waitFor();await page.waitForFunction(()=>document.querySelectorAll('[data-node-id]').length===6);await page.waitForFunction(()=>[...document.images].some(img=>img.src.startsWith('blob:')&&img.complete&&img.naturalWidth>0));await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));${noManual}${saved}`, '刷新恢复实际画布');
  afterRefresh = (await liveState()).get('__canvasSnapshot');
  assert.deepEqual(afterRefresh.value, finalCanvas); assert.equal(validRefreshTimes(beforeRefresh.projectTimes, afterRefresh.projectTimes), true);
  check('新文档自动恢复精确五文本一图片与深色主题', true);
  receipt = await fixture.createBackup(); check('协调后完整备份全部分片与媒体', receipt.documentCount > 0 && receipt.mediaCount > 0);
  await run(['screenshot', '--filename', join(output, '原画布分片恢复刷新.png')], '恢复截图');
  // 独立临时竞争写者仅对同一已保存根做CAS，不注入浏览器数据或授权材料。
  const originalRoot = fixture.workspace.readDocument('extension', rootId);
  await fixture.workspace.writeDocument({ collection: 'extension', id: rootId, value: originalRoot.value, mediaIds: originalRoot.mediaIds, expectedRevision: originalRoot.revision, operationId: crypto.randomUUID() });
  await click('文本', '竞争写入后的实际编辑'); await code(failed + "await page.getByText('其他窗口已修改数据。请保留本页，不要刷新、关闭或强制覆盖；需要先处理版本冲突。',{exact:true}).waitFor();", '真实冲突保护');
  await click('重试未确认保存', '冲突重试不强制覆盖'); await code(failed, '冲突仍保留');
  check('真实画布收到409后阻止覆盖，重试不丢弃冲突记录', await nodeCount() === 6 && fixture.workspace.readDocument('extension', rootId).revision === originalRoot.revision + 1);
  await code(`if(await page.evaluate(()=>window.__persistenceCalls.length))throw Error('浏览器库非零');if((await page.context().cookies()).length)throw Error('出现Cookie');${noManual}`, '浏览器库与材料核验');
  check('全程Storage及IDB零调用、Cookie零，无残留启动材料', true);
  const errors = await run(['console', 'error'], '控制台异常');
  check('无React、CSP或未处理异常，主动断线404和409保留', !/TypeError|ReferenceError|Uncaught|Unhandled|Invalid hook|caught the following error|Content Security Policy|Refused to connect|Fetch API cannot load/i.test(errors));
  passed = true;
} catch (error) { blocked.push({ boundary: '四文件精确装配→真实原画布→SQLite与块根ACK重试→刷新→冲突', reason: error.message }); process.exitCode = 1; }
finally {
  try { await run(['snapshot'], '最终快照'); await run(['console', 'error'], '最终错误'); await run(['screenshot', '--filename', join(output, '最终状态.png')], '最终截图'); } catch { /* 构建可能尚未完成。 */ }
  try { await run(['close'], '关闭本轮独立浏览器'); } catch { /* 不触碰其他浏览器。 */ }
  try {
    if (fixture) {
      await fixture.close();
      if (passed) {
        const restored = join(fixture.root, '冷读恢复'); restoreBackup({ backupRoot: receipt.path, targetRoot: restored });
        coldChecks = { original: await inspectCold(fixture.dataRoot), restored: await inspectCold(restored) };
        check('原库及冷恢复完整性ok、精确六节点深色、全部块及媒体有效且无锁', Object.values(coldChecks).every(value => value.integrity === 'ok' && !value.foreignKeys && value.validMedia && value.lockAbsent && value.exactCanvas && value.nodeCount === 6 && value.themeMode === 'dark' && value.mediaCount > 0 && value.fragments > 0));
      }
    }
  } catch (error) { passed = false; blocked.push({ boundary: '正常关闭与冷备份恢复', reason: error.message }); process.exitCode = 1; }
  const report = { passed, results, blocked, coldChecks, output, syntheticDataRoot: fixture?.dataRoot, integration: fixture?.integration, serviceIntegration: fixture?.serviceIntegration,
    application: '四文件批准磁盘包与真实原React画布，不是合成应用', candidateOnly: false, authorizationRuntimeInjected: false, browserBusinessDataInjected: false,
    competingWriter: '仅新临时库，末尾相同已保存根的独立CAS用于测试409；冲突页内编辑未声称已保存', defaultServiceRateLimit: 120, requestEvidence,
    refreshSemantics: { before: beforeRefresh, after: afterRefresh, rule: '业务字段精确相等、媒体按实际字节哈希/尺寸/MIME比较；仅图片空images列表规范化及项目更新时间独立核验' },
    actualIsolatedOrigin: fixture?.origin, real3100Untouched: true, production3100TakenOver: false };
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify({ ...report, requestEvidence: requestEvidence ? '逐请求记录保存在验收结果.json' : null }, null, 2));
}
