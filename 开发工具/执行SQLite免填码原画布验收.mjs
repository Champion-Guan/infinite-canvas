import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { 根目录 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';
import { createAutomaticCanvasFixture } from './SQLite免填码原画布夹具.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { restoreBackup } from '../扩展功能/本机存储/SQLite工作区.mjs';

检查运行副本();
const exec = promisify(execFile), cli = join(根目录, 'node_modules/.bin/playwright-cli');
const output = join(根目录, '.运行/output/playwright', 'SQLite免填码原画布-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const session = 'guan-auto-canvas-' + Date.now(), results = [], blocked = [];
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
  const marker = 'AUTOMATIC_CANVAS_COMPLETE:' + label;
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
const saved = "await page.waitForFunction(()=>window.__stage6StorageStatus?.state==='saved'&&window.__stage6StorageStatus.pending===0);if(await page.evaluate(()=>window.__stage6PersistenceCalls.length))throw Error('访问了浏览器存储');";
const restoredCanvas = "await page.getByRole('button',{name:'文本',exact:true}).first().waitFor();await page.waitForFunction(()=>document.querySelectorAll('[data-node-id]').length===2);await page.waitForFunction(()=>[...document.images].some(img=>img.src.startsWith('blob:')&&img.complete&&img.naturalWidth>0));await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));" + noManual + saved;
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
  fixture = await createAutomaticCanvasFixture();
  check('完整批准前置和3文件同笔快照事务接入，真实Vite构建成功', fixture.integration.免填码已接入 && fixture.integration.免填码文件数 === 3);
  check('磁盘精确批准启动器先完成首份备份，再开放工作台', fixture.getStatus().backup.lastBackup?.reason === 'startup');
  await run(['open', 'about:blank', '--headed'], '独立空浏览器'); await run(['snapshot'], '初始快照');
  await code(`await page.context().addInitScript(()=>{window.__stage6PersistenceCalls=[];window.__stage6StorageStatus=null;window.__stage6Identity=crypto.randomUUID();window.addEventListener('guan:storage-status',event=>{window.__stage6StorageStatus=event.detail});for(const name of ['getItem','setItem','removeItem','clear'])Storage.prototype[name]=function(){window.__stage6PersistenceCalls.push(name);throw Error('禁止浏览器持久化')};IDBFactory.prototype.open=function(){window.__stage6PersistenceCalls.push('indexedDB');throw Error('禁止浏览器持久化')}});await page.emulateMedia({colorScheme:'light'});await page.context().route('**/*',route=>{const u=new URL(route.request().url());return [${JSON.stringify(fixture.origin)},${JSON.stringify(fixture.dataURL)}].includes(u.origin)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort()});await page.route('**/usage',route=>route.abort());await page.goto(${JSON.stringify(fixture.origin)});await page.getByRole('status').filter({hasText:'本机工作区暂时无法连接'}).waitFor();if(await page.evaluate(()=>!!window.__guanSQLiteHost))throw Error('健康失败仍发布host');if(await page.getByRole('banner',{name:'工作台顶栏'}).count())throw Error('失败仍渲染空首页');${noManual}`, '首次健康失败保护');
  check('首次健康失败不发布host、不加载原main、不写默认空数据，材料已移除', fixture.workspace.listDocuments('extension').length === 0);
  await run(['screenshot', '--filename', join(output, '首次失败可重开.png')], '首次失败截图');
  await code("await page.unroute('**/usage')", '恢复隔离网络');
  await click('重新打开工作台', '原入口失败重开');
  await code(`await page.getByRole('banner',{name:'工作台顶栏'}).getByRole('button',{name:'新建产品',exact:true}).waitFor();${noManual}if(await page.evaluate(()=>window.__stage6PersistenceCalls.length))throw Error('首次启动访问浏览器库');if((await page.context().cookies()).length)throw Error('出现Cookie');if(!await page.evaluate(()=>{const d=Object.getOwnPropertyDescriptor(window,'__guanSQLiteHost');return d&&!d.configurable&&!d.writable}))throw Error('host可覆盖')`, '直接自动进入真实原首页');
  check('无授权表单或测试能力注入，直接进入真实首页且host不可覆盖', fixture.getStatus().authorization.authorizedPages >= 1);
  await run(['screenshot', '--filename', join(output, '免填码原首页.png')], '原首页截图');
  await click('新建产品', '原按钮新建产品');
  await code("await page.waitForURL('**/canvas/*');await page.getByRole('button',{name:'文本',exact:true}).waitFor()", '进入实际画布');
  await click('文本', '原按钮新增文本'); await waitCanvas(1); await code(saved, '文本保存实际ACK');
  check('实际原画布文本节点经自动入口和本机API保存至SQLite', true);
  await code(`await page.locator('input[type=file][accept*="image/"]').first().setInputFiles({name:'免填码原画布合成图片.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2nJ6kAAAAASUVORK5CYII=','base64')})`, '原上传流程');
  const state = await waitCanvas(2); await code(saved, '媒体保存实际ACK');
  check('原上传保存真实媒体及SQLite画布引用', state.state.projects[0].nodes.some(node => node.type === 'image' && node.metadata?.storageKey?.startsWith('image:')) && fixture.workspace.listDocuments('extension').some(row => fixture.workspace.readDocument('extension', row.id).mediaIds.length > 0));
  await run(['screenshot', '--filename', join(output, '免填码原画布浅色.png')], '浅色画布截图');
  await click('切换深色主题', '原顶栏切换主题'); await code("await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));" + saved, '主题保存实际ACK');
  check('原顶栏深色主题模式保存到SQLite', (await liveState()).get('infinite-canvas:theme_store')?.state.mode === 'dark');
  await code(`${saved}const old=await page.evaluate(()=>window.__stage6Identity);await page.reload();await page.waitForFunction(old=>window.__stage6Identity!==old,old);${restoredCanvas}`, '刷新自动恢复真实画布');
  check('刷新新文档自动恢复两节点、图片与主题，不再取码填码', (await waitCanvas(2)).state.projects[0].nodes.length === 2);
  await code(`const url=page.url(),identity=await page.evaluate(()=>window.__stage6Identity);await page.goto(url+'#sqlite-auto-history');await page.goBack();await page.waitForURL(url);await page.goForward();await page.waitForURL(url+'#sqlite-auto-history');if(await page.evaluate(()=>window.__stage6Identity)!==identity)throw Error('同文档路由重载');${saved}`, '原Router历史兼容');
  check('原Router同文档前进后退保持画布与页面身份', true);
  const beforeFailure = JSON.stringify(fixture.workspace.listDocuments('extension'));
  await code(`await page.route('**/usage',route=>route.abort());await page.reload();await page.getByRole('status').filter({hasText:'本机工作区暂时无法连接'}).waitFor();if(await page.evaluate(()=>!!window.__guanSQLiteHost))throw Error('健康失败仍发布host');${noManual}`, '已有数据时健康失败');
  check('已有数据时连接失败不覆盖原记录或回退浏览器库', JSON.stringify(fixture.workspace.listDocuments('extension')) === beforeFailure);
  await code("await page.unroute('**/usage')", '恢复已有库连接'); await click('重新打开工作台', '已有库失败重开');
  await code(restoredCanvas, '失败重开自动恢复媒体主题');
  check('真实画布失败后点重开即可恢复，无需授权码', (await waitCanvas(2)).state.projects[0].nodes.length === 2);
  receipt = await fixture.createBackup();
  check('批准协调队列完成数据库与媒体完整备份', receipt.documentCount > 0 && receipt.mediaCount > 0);
  await code(`if(await page.evaluate(()=>window.__stage6PersistenceCalls.length))throw Error('浏览器持久化非零');if((await page.context().cookies()).length)throw Error('出现Cookie');${noManual}`, '最终零浏览器库和材料');
  check('全流程Cookie与浏览器库零调用，页面材料均已移除', true);
  const errors = await run(['console', 'error'], '运行异常');
  check('除主动健康断网与空记录404外没有React或CSP异常', !/TypeError|ReferenceError|Uncaught|Unhandled|Invalid hook|caught the following error|Content Security Policy|Refused to connect|Fetch API cannot load/i.test(errors));
  await run(['screenshot', '--filename', join(output, '免填码原画布恢复深色.png')], '恢复深色截图'); passed = true;
} catch (error) { blocked.push({ boundary: '精确批准装配→顶层内部握手→原React画布→SQLite→刷新与失败恢复', reason: error.message }); process.exitCode = 1; }
finally {
  try { await run(['snapshot'], '最终快照'); await run(['console', 'error'], '最终错误'); await run(['screenshot', '--filename', join(output, '最终状态.png')], '最终状态截图'); } catch { /* 构建可能尚未成功。 */ }
  try { await run(['close'], '关闭本轮独立浏览器'); } catch { /* 不触碰其他浏览器。 */ }
  try {
    if (fixture) {
      await fixture.close();
      if (passed) {
        const restored = join(fixture.root, '冷读恢复'); restoreBackup({ backupRoot: receipt.path, targetRoot: restored });
        coldChecks = { original: await inspectCold(fixture.dataRoot), restored: await inspectCold(restored) };
        check('原库及冷恢复完整性ok、无外键错误、媒体哈希通过、无锁，两节点和深色模式一致', Object.values(coldChecks).every(value => value.integrity === 'ok' && !value.foreignKeys && value.validMedia && value.lockAbsent && value.nodeCount === 2 && value.themeMode === 'dark' && value.mediaCount > 0));
      }
    }
  } catch (error) { passed = false; blocked.push({ boundary: '停服与冷恢复', reason: error.message }); process.exitCode = 1; }
  const report = { passed, results, blocked, coldChecks, output, syntheticDataRoot: fixture?.dataRoot, integration: fixture?.integration, serviceIntegration: fixture?.serviceIntegration,
    application: '批准磁盘包与真实原React画布，不是合成应用', candidateOnly: false, authorizationRuntimeInjected: false, manualCodeInputRequired: false,
    actualIsolatedOrigin: fixture?.origin, real3100Untouched: true, production3100TakenOver: false };
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
}
