import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { createSQLiteUIFixture } from './SQLite完整界面夹具.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { restoreBackup } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { 检查写入协调服务包 } from '../上游适配/SQLite写入协调批准.mjs';

const exec = promisify(execFile), cli = join(根目录, 'node_modules/.bin/playwright-cli');
const output = join(根目录, '.运行/output/playwright', 'SQLite写入协调-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const results = [], blocked = [], session = 'guan-sqlite-write-gate-' + Date.now();
let fixture, sequence = 0, passed = false, periodicReceipt, finalReceipt, periodicBoundary, finalBoundary, queuedEvidence, coldChecks;
async function run(args, label) {
  let stdout, stderr, failure;
  try { ({ stdout, stderr } = await exec(cli, ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), timeout: 60_000, maxBuffer: 4 * 1024 * 1024 })); }
  catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failure = error; }
  writeFileSync(join(output, `${sequence++}-${label}.log`), stdout + stderr);
  if (failure || /^### Error\b/m.test(stdout)) throw Error('浏览器步骤失败：' + label);
  return stdout;
}
async function code(source, label) {
  const marker = 'GUAN_WRITE_GATE_STEP_COMPLETE:' + label;
  const result = await run(['run-code', `async page=>{const value=await(async()=>{${source}})();return{completed:${JSON.stringify(marker)},value}}`], label);
  if (!result.includes(marker)) throw Error('缺少浏览器完成证明：' + label);
  return result;
}
function check(name, condition) { results.push({ name, passed: !!condition }); if (!condition) throw Error(name); }
async function buttonRef(name, label) {
  const snapshot = await run(['snapshot'], label + '-快照');
  const ref = snapshot.split('\n').find(line => line.includes('button "' + name + '"') && !line.includes('[disabled]') &&
    (name !== '文本' || line.includes('[cursor=pointer]')))?.match(/\[ref=([^\]]+)\]/)?.[1];
  if (!ref) throw Error('快照未找到可点击按钮：' + name);
  return ref;
}
async function click(name, label) { await run(['click', await buttonRef(name, label)], label); }
async function decodeCanvas(documents, readMedia) {
  const doc = documents.find(row => row.value.namespace === 'app_state');
  const entry = doc?.value.entries.find(([key]) => key === 'infinite-canvas:canvas_store');
  if (!entry) return null;
  const codec = createValueCodec({ client: { readMedia } });
  try { return await codec.decode(entry[1].tree); } finally { codec.close(); }
}
const liveCanvas = () => decodeCanvas(fixture.workspace.listDocuments('extension').map(row => fixture.workspace.readDocument('extension', row.id)), async id => {
  const media = fixture.workspace.readMedia(id); return new Blob([media.bytes], { type: media.mime });
});
const saved = `await page.waitForFunction(()=>window.__guanSQLiteStorageStatus?.state==='saved'&&window.__guanSQLiteStorageStatus.pending===0);await page.evaluate(()=>window.__guanSQLiteTest.app.flush());`;
async function coldInspect(root) {
  const db = new DatabaseSync(join(root, '工作台.sqlite'), { readOnly: true });
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check, foreignKeys = db.prepare('PRAGMA foreign_key_check').all().length;
    const docs = db.prepare("SELECT body,revision FROM documents WHERE collection='extension'").all();
    const documentHeads = db.prepare('SELECT collection,id,revision,hash FROM documents ORDER BY collection,id').all().map(row => ({ ...row }));
    const media = db.prepare('SELECT * FROM media').all();
    const validMedia = media.every(row => { const bytes = readFileSync(join(root, '媒体', row.id)); return bytes.length === row.size && createHash('sha256').update(bytes).digest('hex') === row.id; });
    const canvas = await decodeCanvas(docs.map(row => ({ value: JSON.parse(row.body) })), async id => new Blob([readFileSync(join(root, '媒体', id))]));
    return { root, integrity, foreignKeys, validMedia, mediaCount: media.length, nodeCount: canvas?.state.projects[0]?.nodes.length ?? 0,
      canvasRevision: docs.find(row => JSON.parse(row.body).namespace === 'app_state')?.revision ?? 0, documentHeads, lockAbsent: !existsSync(join(root, '.实例锁.json')) };
  } finally { db.close(); }
}
try {
  fixture = await createSQLiteUIFixture({ testSessionRenewal: true, testWriteCoordination: true });
  check('实际加载事务装配的磁盘服务，旧服务和3100均不替换', 检查写入协调服务包(fixture.serviceIntegration.服务包));
  check('服务开放画布前，自动备份完成空工作区启动快照', fixture.backupStatus.lastBackup?.reason === 'startup' && fixture.backupStatus.lastBackup.documentCount === 0);
  const denied = await fetch(fixture.origin + '/__sqlite-test/session', { method: 'POST', headers: { Origin: fixture.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'initialize' }) });
  check('测试授权桥仍拒绝匿名调用', denied.status === 403 && fixture.sessionCounts.initializes === 0);
  await run(['open', 'about:blank', '--headed'], '空资料浏览器'); await run(['snapshot'], '初始快照');
  await code(`await page.context().addInitScript({path:${JSON.stringify(fixture.bootstrap)}});await page.context().route('**/*',route=>{const u=new URL(route.request().url());return [${JSON.stringify(fixture.origin)},${JSON.stringify(fixture.dataURL)}].includes(u.origin)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort()});await page.goto(${JSON.stringify(fixture.origin)});await page.getByRole('banner',{name:'工作台顶栏'}).waitFor();`, '初始化原界面');
  await click('新建产品', '实际新建产品');
  await code(`await page.waitForURL('**/canvas/*');await page.getByRole('button',{name:'文本',exact:true}).waitFor();`, '等待原画布');
  await click('文本', '新增备份前节点'); await code(saved, '首次实际保存ACK');
  check('实际产品及首个文本节点经磁盘装配服务保存到SQLite', (await liveCanvas())?.state.projects[0]?.nodes.length === 1);
  // 在进入备份前取得新快照引用，避免占用排队超时窗口。
  const textRef = await buttonRef('文本', '备份期间文本入口');
  periodicReceipt = await fixture.beginPeriodicBackup();
  periodicBoundary = fixture.lastBackupBoundary;
  await run(['click', textRef], '备份期间新增第二节点');
  await code(`await page.waitForFunction(()=>window.__guanSQLiteTest.client.getStatus().state==='saving');return await page.evaluate(()=>({client:window.__guanSQLiteTest.client.getStatus().state,bridge:window.__guanSQLiteStorageStatus?.state,browserCalls:window.__browserPersistenceCalls.length}));`, '排队期间没有保存成功');
  const during = await liveCanvas();
  queuedEvidence = { ...fixture.writeStatus, persistedNodes: during?.state.projects[0]?.nodes.length, backupReason: fixture.backupStatus.lastBackup.reason };
  check('周期备份占队列时，实际画布保存等待且没有提前落盘', fixture.writeStatus.activeKind === 'backup' && fixture.writeStatus.queuedWrites === 1 && queuedEvidence.persistedNodes === 1);
  await code(`await page.evaluate(async()=>{const result=await window.__guanSQLiteTest.client.readUsage();if(!result)throw Error('备份期间读取失败');if(window.__guanSQLiteTest.client.getStatus().state!=='saving')throw Error('不能提前显示已保存')});`, '备份期间真实读取');
  check('备份等待期间API读取仍可用且保存状态仍为saving', fixture.writeStatus.queuedWrites === 1);
  await fixture.releaseBackup(); await code(saved, '放行后等待真正保存ACK');
  check('备份完成后第二节点取得落盘ACK，周期调度重新就绪', (await liveCanvas())?.state.projects[0]?.nodes.length === 2 && fixture.backupStatus.state === 'ready' && fixture.backupStatus.lastBackup.reason === 'periodic');
  // 使用原上传流程，不直接伪造业务状态。
  await code(`const input=page.locator('input[type=file][accept*="image/"]').first();await input.setInputFiles({name:'写入协调合成图片.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2nJ6kAAAAASUVORK5CYII=','base64')});await page.waitForFunction(async()=>{const raw=await window.__guanSQLiteTest.app.createInstance({storeName:'app_state'}).getItem('infinite-canvas:canvas_store');return raw&&JSON.parse(raw).state.projects[0]?.nodes.some(n=>n.type==='image')});${saved}`, '原上传流程保存媒体');
  check('实际上传图片通过协调服务写入受管媒体并保存画布引用', (await liveCanvas())?.state.projects[0]?.nodes.length === 3 && fixture.workspace.listDocuments('extension').some(row => fixture.workspace.readDocument('extension', row.id).mediaIds.length > 0));
  await code(`if(await page.evaluate(()=>window.__browserPersistenceCalls.length))throw Error('刷新前访问浏览器存储');${saved}const old=await page.evaluate(()=>window.__guanSQLitePageIdentity);await page.reload();await page.waitForFunction(old=>window.__guanSQLitePageIdentity!==old,old);await page.getByRole('button',{name:'文本',exact:true}).first().waitFor();await page.waitForFunction(()=>[...document.images].some(img=>img.src.startsWith('blob:')&&img.complete&&img.naturalWidth>0));await page.evaluate(async()=>{const raw=await window.__guanSQLiteTest.app.createInstance({storeName:'app_state'}).getItem('infinite-canvas:canvas_store');if(JSON.parse(raw).state.projects[0]?.nodes.length!==3)throw Error('恢复节点数不符');if(window.__browserPersistenceCalls.length)throw Error('刷新访问浏览器存储')});`, '新文档恢复画布和图片');
  check('实际刷新恢复三节点和图片，浏览器数据库零调用', (await liveCanvas())?.state.projects[0]?.nodes.length === 3);
  await fixture.requestBackup(); finalReceipt = fixture.lastBackupReceipt; finalBoundary = fixture.lastBackupBoundary;
  check('后续手动备份经同一协调队列完成，调度累计三次成功', fixture.backupStatus.attempts === 3 && fixture.backupStatus.lastBackup.reason === 'manual' && fixture.writeStatus.queuedWrites === 0);
  const errors = await run(['console', 'error'], '控制台');
  check('无React及未处理异常，空库首次404单独保留', !/TypeError|ReferenceError|Uncaught|Unhandled|Invalid hook|caught the following error/.test(errors));
  await run(['screenshot', '--filename', join(output, '写入协调画布.png')], '最终截图');
  passed = true;
} catch (error) {
  blocked.push({ boundary: '真实画布→事务装配服务→周期备份→落盘ACK→刷新', reason: error.message }); process.exitCode = 1;
} finally {
  try { await run(['snapshot'], '最终快照'); await run(['console', 'error'], '最终控制台'); } catch { /* 未启动或已关闭。 */ }
  try { await run(['close'], '关闭隔离浏览器'); } catch { /* 不触及其他资料。 */ }
  try {
    if (fixture) {
      await fixture.close();
      if (passed) {
        const beforeRoot = join(fixture.root, '恢复周期快照'), finalRoot = join(fixture.root, '恢复最终快照');
        restoreBackup({ backupRoot: periodicReceipt.path, targetRoot: beforeRoot }); restoreBackup({ backupRoot: finalReceipt.path, targetRoot: finalRoot });
        coldChecks = { live: await coldInspect(join(fixture.root, '数据')), before: await coldInspect(beforeRoot), final: await coldInspect(finalRoot) };
        check('关闭后只读重开原库及恢复快照：完整性、媒体哈希和锁均正常', Object.values(coldChecks).every(row => row.integrity === 'ok' && row.foreignKeys === 0 && row.validMedia && row.lockAbsent));
        // 页面重载会在500ms后再保存viewport/updatedAt；在线快照不承诺包含未来提交。
        // 逐份核对进入备份时记录的全部文档修订和内容哈希，不用关闭时的未来修订冒充快照边界。
        check('两份恢复快照的全部修订与内容哈希精确匹配各自进入备份的边界', JSON.stringify(coldChecks.before.documentHeads) === JSON.stringify(periodicBoundary.documents) && JSON.stringify(coldChecks.final.documentHeads) === JSON.stringify(finalBoundary.documents));
        check('周期快照只有首节点；原库和最终快照有三节点及媒体，后续提交不倒退', coldChecks.before.nodeCount === 1 && coldChecks.before.mediaCount === 0 && coldChecks.live.nodeCount === 3 && coldChecks.final.nodeCount === 3 && coldChecks.final.mediaCount > 0 && coldChecks.live.canvasRevision >= coldChecks.final.canvasRevision && coldChecks.before.canvasRevision < coldChecks.final.canvasRevision);
      }
    }
  } catch (error) { passed = false; blocked.push({ boundary: '关闭清理及备份冷读', reason: error.message }); process.exitCode = 1; }
  const report = { passed, results, blocked, output, queuedEvidence, coldChecks, backupBoundaries: { periodic: periodicBoundary, final: finalBoundary }, syntheticDataRoot: fixture?.root, integration: fixture?.integration, serviceIntegration: fixture?.serviceIntegration,
    authorizationArtifactsRemoved: fixture ? !existsSync(fixture.bootstrap) : null, productionAuthorizationDeliveryImplemented: false, real3100Untouched: true,
    faultInjection: '真实快照完成后暂缓测试回执，以确定性覆盖备份仍占服务队列的窗口；不改生产源码' };
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
}
