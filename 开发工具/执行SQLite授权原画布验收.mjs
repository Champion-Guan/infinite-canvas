import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { 根目录 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';
import { createAuthorizedCanvasFixture } from './SQLite授权原画布夹具.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { restoreBackup } from '../扩展功能/本机存储/SQLite工作区.mjs';

检查运行副本();
const exec = promisify(execFile), cli = join(根目录, 'node_modules/.bin/playwright-cli');
const output = join(根目录, '.运行/output/playwright', 'SQLite授权原画布-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const session = 'guan-authorized-canvas-' + Date.now(), results = [], blocked = [], secrets = [], privateFiles = [];
let fixture, sequence = 0, passed = false, receipt, coldChecks, canvasURL;
async function run(args, label) {
  let stdout, stderr, failure;
  try { ({ stdout, stderr } = await exec(cli, ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), timeout: 45_000, maxBuffer: 3 * 1024 * 1024 })); }
  catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failure = error; }
  let log = stdout + stderr; for (const secret of secrets) log = log.replaceAll(secret, '[本机临时授权码已隐去]');
  writeFileSync(join(output, `${sequence++}-${label}.log`), log);
  if (failure || /^### Error\b/m.test(stdout)) throw Error('浏览器步骤失败：' + label);
  return stdout;
}
function check(name, condition) { results.push({ name, passed: !!condition }); if (!condition) throw Error(name); }
async function code(source, label) {
  const marker = 'AUTHORIZED_CANVAS_COMPLETE:' + label;
  const result = await run(['run-code', `async page=>{${source};return ${JSON.stringify(marker)}}`], label);
  if (!result.includes(marker)) throw Error('缺少完成证明：' + label);
}
async function click(name, label) {
  const snapshot = await run(['snapshot'], label + '-快照');
  const ref = snapshot.split('\n').find(line => line.includes('button "' + name + '"') && !line.includes('[disabled]') &&
    (name !== '文本' || line.includes('[cursor=pointer]')))?.match(/\[ref=([^\]]+)\]/)?.[1];
  if (!ref) throw Error('快照缺少可点击按钮：' + name);
  await run(['click', ref], label);
}
async function authorize(label, valid = true) {
  const ticket = valid ? fixture.issueTicket() : { code: '0'.repeat(64) }; secrets.push(ticket.code);
  const snapshot = await run(['snapshot'], label + '-表单快照');
  if (!snapshot.includes('textbox "本机一次性授权码"')) throw Error('没有真实授权表单');
  const file = join(fixture.root, label + '.mjs'); privateFiles.push(file);
  const wait = valid ? "await page.getByRole('banner',{name:'工作台顶栏'}).waitFor();" : "await page.getByRole('status').filter({hasText:'本机授权或连接未通过'}).waitFor();";
  writeFileSync(file, `async page=>{await page.getByLabel('本机一次性授权码').fill(${JSON.stringify(ticket.code)});await page.getByRole('button',{name:'授权并打开工作台',exact:true}).click();${wait}return '真实表单完成';}`, { mode: 0o600 });
  const result = await run(['run-code', '--filename', file], label); unlinkSync(file);
  if (!result.includes('真实表单完成')) throw Error('表单未完成');
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
const saved = "await page.waitForFunction(()=>window.__stage6StorageStatus?.state==='saved'&&window.__stage6StorageStatus.pending===0);if(await page.evaluate(()=>window.__stage6PersistenceCalls.length))throw Error('访问了浏览器存储');";
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
  fixture = await createAuthorizedCanvasFixture();
  check('获批9文件经第四次快照事务接入，真实Vite构建成功', fixture.integration.授权入口已接入 && fixture.integration.授权入口文件数 === 9);
  check('真实受限启动器先完成首份备份，再开放工作台', fixture.getStatus().backup.lastBackup?.reason === 'startup');
  await run(['open', 'about:blank', '--headed'], '独立空浏览器'); await run(['snapshot'], '初始快照');
  await code(`await page.context().addInitScript(()=>{window.__stage6PersistenceCalls=[];window.__stage6StorageStatus=null;window.__stage6Identity=crypto.randomUUID();window.addEventListener('guan:storage-status',event=>{window.__stage6StorageStatus=event.detail});for(const name of ['getItem','setItem','removeItem','clear'])Storage.prototype[name]=function(){window.__stage6PersistenceCalls.push(name);throw Error('禁止浏览器持久化')};IDBFactory.prototype.open=function(){window.__stage6PersistenceCalls.push('indexedDB');throw Error('禁止浏览器持久化')}});await page.emulateMedia({colorScheme:'light'});await page.context().route('**/*',route=>{const u=new URL(route.request().url());return [${JSON.stringify(fixture.origin)},${JSON.stringify(fixture.dataURL)}].includes(u.origin)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort()});await page.goto(${JSON.stringify(fixture.origin)});await page.getByRole('heading',{name:'连接本机工作区',exact:true}).waitFor();if(await page.getByRole('banner',{name:'工作台顶栏'}).count())throw Error('授权前加载了工作台');if(await page.evaluate(()=>!!window.__guanSQLiteHost))throw Error('提前发布host')`, '未授权实际构建');
  check('实际工作台构建在授权前不渲染空首页、不写默认数据', fixture.workspace.listDocuments('extension').length === 0);
  await authorize('无效码保护', false);
  check('实际HTML入口无效码可见失败且数据库仍为空', fixture.getStatus().authorization.authorizedPages === 0 && fixture.workspace.listDocuments('extension').length === 0);
  await authorize('真实授权原首页');
  await code(`await page.getByRole('banner',{name:'工作台顶栏'}).getByRole('button',{name:'新建产品',exact:true}).waitFor();if(await page.evaluate(()=>window.__stage6PersistenceCalls.length))throw Error('首次启动访问了浏览器库');if((await page.context().cookies()).length)throw Error('出现Cookie')`, '原首页与零浏览器库');
  check('真实表单授权后才加载原首页，HTML主题及Router初始化零浏览器存储', fixture.getStatus().authorization.authorizedPages === 1);
  await click('新建产品', '原按钮新建产品');
  await code("await page.waitForURL('**/canvas/*');await page.getByRole('button',{name:'文本',exact:true}).waitFor()", '进入实际画布');
  await click('文本', '原按钮新增文本'); await waitCanvas(1); await code(saved, '文本保存实际ACK');
  check('实际画布文本节点经授权host和本机API写入SQLite', true);
  await code(`await page.locator('input[type=file][accept*="image/"]').first().setInputFiles({name:'授权原画布合成图片.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2nJ6kAAAAASUVORK5CYII=','base64')})`, '原上传流程');
  const state = await waitCanvas(2); await code(saved, '媒体保存实际ACK');
  check('原上传流程保存图片文件及画布引用，不是仅保存结构', state.state.projects[0].nodes.some(node => node.type === 'image' && node.metadata?.storageKey?.startsWith('image:')) && fixture.workspace.listDocuments('extension').some(row => fixture.workspace.readDocument('extension', row.id).mediaIds.length > 0));
  await run(['screenshot', '--filename', join(output, '授权原画布浅色.png')], '原画布浅色截图');
  await click('切换深色主题', '原顶栏切换主题'); await code("await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));" + saved, '主题保存实际ACK');
  check('原顶栏主题模式保存到SQLite', (await liveState()).get('infinite-canvas:theme_store')?.state.mode === 'dark');
  await code(`${saved}const old=await page.evaluate(()=>window.__stage6Identity);await page.reload();await page.waitForFunction(old=>window.__stage6Identity!==old,old);await page.getByRole('heading',{name:'连接本机工作区',exact:true}).waitFor();if(await page.evaluate(()=>!!window.__guanSQLiteHost))throw Error('刷新静默授权')`, '实际画布刷新回授权态');
  check('实际画布刷新后不静默授权，已有节点和图片不变', (await waitCanvas(2)).state.projects[0].nodes.length === 2);
  await authorize('刷新后原画布重新授权');
  await code(`await page.getByRole('button',{name:'文本',exact:true}).first().waitFor();await page.waitForFunction(()=>document.querySelectorAll('[data-node-id]').length===2);await page.waitForFunction(()=>[...document.images].some(img=>img.src.startsWith('blob:')&&img.complete&&img.naturalWidth>0));await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));${saved}`, '重新授权实际恢复节点媒体和主题');
  check('新文档实际恢复两个节点、受管图片及深色主题，浏览器库零调用', (await waitCanvas(2)).state.projects[0].nodes.length === 2);
  await code(`const url=page.url(),identity=await page.evaluate(()=>window.__stage6Identity);await page.goto(url+'#sqlite-authorized-history');await page.goBack();await page.waitForURL(url);await page.goForward();await page.waitForURL(url+'#sqlite-authorized-history');if(await page.evaluate(()=>window.__stage6Identity)!==identity)throw Error('同文档路由重载');${saved}`, '原Router片段历史兼容');
  check('原Router历史前进后退保留原画布及页面身份', true);
  receipt = await fixture.createBackup();
  check('授权工作台可经批准协调队列完成媒体与数据完整快照', receipt.documentCount > 0 && receipt.mediaCount > 0);
  await code(`if(await page.evaluate(()=>window.__stage6PersistenceCalls.length))throw Error('浏览器持久化非零');if((await page.context().cookies()).length)throw Error('出现Cookie')`, '最终零浏览器库与Cookie');
  check('整个原工作台流程不使用Cookie、localStorage、sessionStorage或IndexedDB', true);
  const errors = await run(['console', 'error'], '运行异常');
  check('除主动无效码403与首次空记录404外，没有React、CSP或未处理运行异常', !/TypeError|ReferenceError|Uncaught|Unhandled|Invalid hook|caught the following error|Content Security Policy|Refused to connect|Fetch API cannot load/i.test(errors));
  await run(['screenshot', '--filename', join(output, '授权原画布恢复深色.png')], '恢复后截图');
  canvasURL = fixture.origin; passed = true;
} catch (error) { blocked.push({ boundary: '获批入口→真实授权表单→原React画布→SQLite→刷新恢复', reason: error.message }); process.exitCode = 1; }
finally {
  try { await run(['snapshot'], '最终快照'); await run(['console', 'error'], '最终错误'); await run(['screenshot', '--filename', join(output, '最终状态.png')], '最终状态截图'); } catch { /* 构建可能尚未成功。 */ }
  try { await run(['close'], '关闭本轮独立浏览器'); } catch { /* 不触碰其他浏览器。 */ }
  try {
    if (fixture) {
      await fixture.close();
      if (passed) {
        const restored = join(fixture.root, '冷读恢复'); restoreBackup({ backupRoot: receipt.path, targetRoot: restored });
        coldChecks = { original: await inspectCold(fixture.dataRoot), restored: await inspectCold(restored) };
        check('原库和恢复快照冷读完整性ok、媒体哈希通过、无锁且均恢复两节点与深色主题模式', Object.values(coldChecks).every(value => value.integrity === 'ok' && !value.foreignKeys && value.validMedia && value.lockAbsent && value.nodeCount === 2 && value.themeMode === 'dark' && value.mediaCount > 0));
      }
    }
  } catch (error) { passed = false; blocked.push({ boundary: '停服与冷恢复验证', reason: error.message }); process.exitCode = 1; }
  for (const file of privateFiles) if (existsSync(file)) unlinkSync(file);
  const report = { passed, results, blocked, coldChecks, output, syntheticDataRoot: fixture?.dataRoot, integration: fixture?.integration, serviceIntegration: fixture?.serviceIntegration, launcherIntegration: fixture?.launcherIntegration,
    application: '获批原React画布，不是合成应用', authorizationRuntimeInjected: false, authorizationFilesRemoved: privateFiles.every(file => !existsSync(file)),
    actualIsolatedOrigin: canvasURL, real3100Untouched: true, production3100TakenOver: false };
  const text = JSON.stringify(report, null, 2) + '\n';
  if (secrets.some(secret => text.includes(secret))) { process.exitCode = 1; console.error('验收输出含临时授权码，不发布结果。'); }
  else { writeFileSync(join(output, '验收结果.json'), text); console.log(text); }
}
