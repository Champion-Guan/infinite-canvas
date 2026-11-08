import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { 根目录 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';
import { createRecoveryCanvasFixture } from './SQLite保存恢复原画布夹具.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { restoreBackup } from '../扩展功能/本机存储/SQLite工作区.mjs';

检查运行副本();
const exec = promisify(execFile), cli = join(根目录, 'node_modules/.bin/playwright-cli');
const output = join(根目录, '.运行/output/playwright', 'SQLite保存恢复原画布-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const session = 'guan-recovery-canvas-' + Date.now(), results = [], blocked = [];
let fixture, sequence = 0, passed = false, receipt, coldChecks;
async function run(args, label) {
  let stdout, stderr, failure;
  try { ({ stdout, stderr } = await exec(cli, ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), timeout: 45_000, maxBuffer: 3 * 1024 * 1024 })); }
  catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failure = error; }
  writeFileSync(join(output, `${sequence++}-${label}.log`), (stdout + stderr).replace(/[a-f0-9]{64}/g, '[内部材料已隐去]'));
  if (failure || /^### Error\b/m.test(stdout)) throw Error('浏览器步骤失败：' + label);
  return stdout;
}
function check(name, condition) { results.push({ name, passed: !!condition }); if (!condition) throw Error(name); }
async function code(source, label) {
  const marker = 'RECOVERY_CANVAS_OK:' + label;
  if (!(await run(['run-code', `async page=>{${source};return ${JSON.stringify(marker)}}`], label)).includes(marker)) throw Error('缺少完成证明：' + label);
}
async function click(name, label) {
  const snapshot = await run(['snapshot'], label + '-快照');
  const ref = snapshot.split('\n').find(line => line.includes('button "' + name + '"') && !line.includes('[disabled]') &&
    (name !== '文本' || line.includes('[cursor=pointer]')))?.match(/\[ref=([^\]]+)\]/)?.[1];
  if (!ref) throw Error('快照缺少可点击按钮：' + name);
  await run(['click', ref], label);
}
async function decodeState(documents, mediaReader) {
  const doc = documents.find(item => item.value.namespace === 'app_state'), result = new Map();
  if (!doc) return result;
  const codec = createValueCodec({ client: { readMedia: mediaReader } });
  try { for (const [key, item] of doc.value.entries) result.set(key, await codec.decode(item.tree)); } finally { codec.close(); }
  return result;
}
async function liveState() {
  return decodeState(fixture.workspace.listDocuments('extension').map(row => fixture.workspace.readDocument('extension', row.id)), async id => {
    const media = fixture.workspace.readMedia(id); return new Blob([media.bytes], { type: media.mime });
  });
}
async function waitCanvas(count) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const state = (await liveState()).get('infinite-canvas:canvas_store');
    if (state?.state.projects[0]?.nodes.length === count) return state;
    await new Promise(done => setTimeout(done, 50));
  }
  throw Error('真实SQLite画布节点保存未确认：' + count);
}
const noManual = "if(await page.locator('input[type=password],meta[name=guan-local-bootstrap]').count())throw Error('仍有手填码或内部材料');";
const saved = "await page.waitForFunction(()=>window.__recoveryStatus?.state==='saved'&&window.__recoveryStatus.pending===0);if(await page.evaluate(()=>window.__persistenceCalls.length))throw Error('访问浏览器存储');";
const failed = "await page.getByRole('alert').filter({hasText:'保存尚未确认'}).waitFor();await page.getByText('编辑仍保留在本页内存中。请勿刷新或关闭，连接恢复后点击重试。',{exact:true}).waitFor();";
const restoreCanvas = "await page.getByRole('button',{name:'文本',exact:true}).first().waitFor();await page.waitForFunction(()=>document.querySelectorAll('[data-node-id]').length===4);await page.waitForFunction(()=>[...document.images].some(img=>img.src.startsWith('blob:')&&img.complete&&img.naturalWidth>0));await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));" + noManual + saved;
async function inspectCold(root) {
  const db = new DatabaseSync(join(root, '工作台.sqlite'), { readOnly: true });
  try {
    const documents = db.prepare("SELECT body FROM documents WHERE collection='extension'").all().map(row => ({ value: JSON.parse(row.body) }));
    const media = db.prepare('SELECT * FROM media').all(), state = await decodeState(documents, async id => new Blob([readFileSync(join(root, '媒体', id))]));
    return { integrity: db.prepare('PRAGMA integrity_check').get().integrity_check, foreignKeys: db.prepare('PRAGMA foreign_key_check').all().length,
      nodeCount: state.get('infinite-canvas:canvas_store')?.state.projects[0]?.nodes.length ?? 0,
      themeMode: state.get('infinite-canvas:theme_store')?.state.mode,
      mediaCount: media.length, validMedia: media.every(row => { const bytes = readFileSync(join(root, '媒体', row.id)); return bytes.length === row.size && createHash('sha256').update(bytes).digest('hex') === row.id; }),
      lockAbsent: !existsSync(join(root, '.实例锁.json')) };
  } finally { db.close(); }
}
try {
  fixture = await createRecoveryCanvasFixture();
  check('完整批准前置和5文件同笔快照事务装配，真实Vite构建成功', fixture.integration.保存恢复已接入 && fixture.integration.保存恢复文件数 === 5);
  check('批准磁盘启动器先完成首份备份再开放工作台', fixture.getStatus().backup.lastBackup?.reason === 'startup');
  await run(['open', 'about:blank', '--headed'], '独立浏览器'); await run(['snapshot'], '初始快照');
  await code(`await page.context().addInitScript(()=>{window.__persistenceCalls=[];window.__recoveryStatus=null;window.__documentIdentity=crypto.randomUUID();window.addEventListener('guan:storage-status',event=>window.__recoveryStatus=event.detail);for(const name of ['getItem','setItem','removeItem','clear'])Storage.prototype[name]=function(){window.__persistenceCalls.push(name);throw Error('禁止浏览器持久化')};IDBFactory.prototype.open=function(){window.__persistenceCalls.push('indexedDB');throw Error('禁止浏览器持久化')}});await page.emulateMedia({colorScheme:'light'});await page.context().route('**/*',route=>{const u=new URL(route.request().url());return [${JSON.stringify(fixture.origin)},${JSON.stringify(fixture.dataURL)}].includes(u.origin)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort()});await page.goto(${JSON.stringify(fixture.origin)});await page.getByRole('banner',{name:'工作台顶栏'}).getByRole('button',{name:'新建产品',exact:true}).waitFor();${noManual}`, '免填码进入实际首页');
  check('未注入host或授权材料，直接进入原首页', fixture.getStatus().authorization.authorizedPages >= 1);
  await click('新建产品', '实际新建产品');
  await code("await page.waitForURL('**/canvas/*');await page.getByRole('button',{name:'文本',exact:true}).waitFor();" + saved, '实际画布基线保存');
  await code(`await page.evaluate(()=>window.__writeIds=[]);let drop=true;await page.route('**/documents/extension/*',async route=>{const request=route.request();if(request.method()!=='PUT'||request.postDataJSON().value.namespace!=='app_state')return route.continue();const id=request.postDataJSON().operationId;await page.evaluate(id=>window.__writeIds.push(id),id);if(drop){drop=false;await route.fetch();return route.abort()}return route.continue()})`, '设置提交后丢ACK');
  await click('文本', '实际新增文本后丢ACK'); await code(failed, '原画布失败提示'); await waitCanvas(1);
  check('实际节点已落盘但丢ACK时原画布不假报已保存', true);
  await click('文本', '失败后继续实际新增文本'); await code(failed, '失败后新编辑提示保留');
  check('失败后的实际第二节点保留页内，不擅自覆盖SQLite首节点', (await liveState()).get('infinite-canvas:canvas_store').state.projects[0].nodes.length === 1);
  await run(['screenshot', '--filename', join(output, '原画布保存失败与两节点.png')], '原画布失败截图');
  await click('重试未确认保存', '原画布重试'); await waitCanvas(2);
  await code(`${saved}const ids=await page.evaluate(()=>window.__writeIds);if(ids.length<3||ids[0]!==ids[1]||ids[1]===ids[2])throw Error('没有复用原ID再提交新编辑');if(await page.getByRole('alert').filter({hasText:'保存尚未确认'}).count())throw Error('恢复后错误未清除')`, '原ID和后续编辑ACK核验');
  check('原operationId重试不重复写入，后续实际编辑ACK后清除失败提示', true);
  await code("await page.unroute('**/documents/extension/*');await page.route('**/documents/extension/*',route=>route.request().method()==='PUT'&&route.request().postDataJSON().value.namespace==='app_state'?route.abort():route.continue())", '设置持续断线');
  await click('文本', '断线实际新增第三节点'); await code(failed, '持续断线提示');
  await click('重试未确认保存', '断线时重试'); await code(failed, '断线重试不能清除失败');
  check('实际画布持续断线重试不覆盖原库或假报成功', (await liveState()).get('infinite-canvas:canvas_store').state.projects[0].nodes.length === 2);
  await code("await page.unroute('**/documents/extension/*')", '恢复连接'); await click('重试未确认保存', '恢复后重试'); await waitCanvas(3); await code(saved, '第三节点ACK');
  check('连接恢复后实际第三节点确认保存', true);
  await code(`await page.locator('input[type=file][accept*="image/"]').first().setInputFiles({name:'保存恢复原画布合成图片.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2nJ6kAAAAASUVORK5CYII=','base64')})`, '原流程上传图片');
  const state = await waitCanvas(4); await code(saved, '媒体真实ACK');
  check('原图片上传流程保存媒体和画布引用', state.state.projects[0].nodes.some(node => node.type === 'image' && node.metadata?.storageKey?.startsWith('image:')) && fixture.workspace.listDocuments('extension').some(row => fixture.workspace.readDocument('extension', row.id).mediaIds.length > 0));
  await click('切换深色主题', '原顶栏主题'); await code("await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));" + saved, '主题ACK');
  check('原主题模式写入SQLite', (await liveState()).get('infinite-canvas:theme_store')?.state.mode === 'dark');
  await code(`${saved}const old=await page.evaluate(()=>window.__documentIdentity);await page.reload();await page.waitForFunction(old=>window.__documentIdentity!==old,old);${restoreCanvas}`, '刷新恢复实际画布');
  check('新文档自动恢复三文本一图片与深色主题', (await waitCanvas(4)).state.projects[0].nodes.length === 4);
  receipt = await fixture.createBackup();
  check('写入协调后数据库与媒体完整备份', receipt.documentCount > 0 && receipt.mediaCount > 0);
  await code(`if(await page.evaluate(()=>window.__persistenceCalls.length))throw Error('浏览器库非零');if((await page.context().cookies()).length)throw Error('出现Cookie');${noManual}`, '最终浏览器存储与材料核验');
  check('全流程浏览器库和Cookie零调用，无残留启动材料', true);
  const errors = await run(['console', 'error'], '控制台异常');
  check('除主动断网和空记录404外没有React/CSP或未处理异常', !/TypeError|ReferenceError|Uncaught|Unhandled|Invalid hook|caught the following error|Content Security Policy|Refused to connect|Fetch API cannot load/i.test(errors));
  await run(['screenshot', '--filename', join(output, '原画布恢复刷新深色.png')], '原画布恢复截图'); passed = true;
} catch (error) { blocked.push({ boundary: '五文件精确装配→原画布编辑→SQLite与丢ACK重试→刷新恢复', reason: error.message }); process.exitCode = 1; }
finally {
  try { await run(['snapshot'], '最终快照'); await run(['console', 'error'], '最终错误'); await run(['screenshot', '--filename', join(output, '最终状态.png')], '最终截图'); } catch { /* 构建可能尚未完成。 */ }
  try { await run(['close'], '关闭本轮独立浏览器'); } catch { /* 不触碰其他浏览器。 */ }
  try {
    if (fixture) {
      await fixture.close();
      if (passed) {
        const restored = join(fixture.root, '冷读恢复'); restoreBackup({ backupRoot: receipt.path, targetRoot: restored });
        coldChecks = { original: await inspectCold(fixture.dataRoot), restored: await inspectCold(restored) };
        check('原库和冷恢复完整性ok、无外键错误、媒体哈希与四节点深色一致且无锁', Object.values(coldChecks).every(value => value.integrity === 'ok' && !value.foreignKeys && value.validMedia && value.lockAbsent && value.nodeCount === 4 && value.themeMode === 'dark' && value.mediaCount > 0));
      }
    }
  } catch (error) { passed = false; blocked.push({ boundary: '正常关闭与冷备份恢复', reason: error.message }); process.exitCode = 1; }
  const report = { passed, results, blocked, coldChecks, output, syntheticDataRoot: fixture?.dataRoot, integration: fixture?.integration, serviceIntegration: fixture?.serviceIntegration,
    application: '五文件批准磁盘包与真实原React画布，不是合成应用', candidateOnly: false, authorizationRuntimeInjected: false, manualCodeInputRequired: false,
    actualIsolatedOrigin: fixture?.origin, real3100Untouched: true, production3100TakenOver: false };
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
}
