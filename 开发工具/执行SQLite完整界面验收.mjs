import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { createSQLiteUIFixture } from './SQLite完整界面夹具.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';

const exec = promisify(execFile), cli = join(根目录, 'node_modules/.bin/playwright-cli');
const output = join(根目录, '.运行/output/playwright', 'SQLite完整界面-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const fixture = await createSQLiteUIFixture(), sessions = ['guan-sqlite-full-' + Date.now(), 'guan-sqlite-noauth-' + Date.now()];
const results = [], blocked = []; let sequence = 0, passed = false;
async function run(index, args, label) {
  let stdout, stderr, failure;
  try { ({ stdout, stderr } = await exec(cli, ['--session', sessions[index], '--raw', ...args], { cwd: join(根目录, '.运行'), timeout: 60_000, maxBuffer: 4 * 1024 * 1024 })); }
  catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failure = error; }
  writeFileSync(join(output, `${sequence++}-${label}.log`), stdout + stderr);
  // CLI脚本错误可能仍返回退出码0，不能据此报告通过。
  if (failure || /^### Error\b/m.test(stdout)) throw Error('浏览器步骤失败：' + label, { cause: failure });
  return stdout;
}
async function code(index, source, label) {
  const marker = 'GUAN_SQLITE_STEP_COMPLETE:' + label;
  const result = await run(index, ['run-code', `async page => { const value=await (async()=>{${source}})();return {completed:${JSON.stringify(marker)},value}; }`], label);
  if (!result.includes(marker)) throw Error('浏览器步骤未返回完成证明：' + label);
  return result;
}
const check = (name, condition) => { results.push({ name, passed: !!condition }); if (!condition) throw Error(name); };
async function snapshotClick(name, label) {
  const snapshot = await run(0, ['snapshot'], label + '-快照');
  const line = snapshot.split('\n').find(value => value.includes('button "' + name + '"') && !value.includes('[disabled]'));
  const ref = line?.match(/\[ref=([^\]]+)\]/)?.[1];
  if (!ref) throw Error('快照未找到按钮：' + name);
  await run(0, ['click', ref], label);
}
const canvasDocument = () => fixture.workspace.listDocuments('extension').map(row => fixture.workspace.readDocument('extension', row.id)).find(doc => doc.value.namespace === 'app_state');
async function persistedCanvas() {
  const document = canvasDocument(), entry = document?.value.entries.find(([key]) => key === 'infinite-canvas:canvas_store');
  if (!entry) return null;
  const codec = createValueCodec({ client: { async readMedia(id) { const file = fixture.workspace.readMedia(id); return new Blob([file.bytes], { type: file.mime }); } } });
  try { return await codec.decode(entry[1].tree); } finally { codec.close(); }
}
// runtime.flush不包含桥的400ms延迟队列。先等桥的确认，再刷新，并用每次文档初始化的新身份防止误把旧页面当恢复成功。
const reloadSaved = `if(await page.evaluate(()=>window.__browserPersistenceCalls.length))throw Error('刷新前已有浏览器存储访问，不能用新文档清空计数');await page.waitForFunction(()=>window.__guanSQLiteStorageStatus?.state==='saved'&&window.__guanSQLiteStorageStatus.pending===0);await page.evaluate(()=>window.__guanSQLiteTest.app.flush());const oldIdentity=await page.evaluate(()=>window.__guanSQLitePageIdentity);await page.reload();await page.waitForFunction(old=>window.__guanSQLitePageIdentity&&window.__guanSQLitePageIdentity!==old,oldIdentity);`;
try {
  await run(1, ['open', 'about:blank', '--headed'], '无授权空资料'); await run(1, ['snapshot'], '无授权初始快照');
  await code(1, `await page.goto(${JSON.stringify(fixture.origin)});await page.getByRole('alert').filter({hasText:'本机SQLite存储未就绪'}).waitFor();if(await page.getByRole('button',{name:'新建产品',exact:true}).count())throw Error('无授权不应启动应用');`, '无授权保护');
  check('完整构建在缺少host时停止，不加载空画布或写入默认数据', fixture.workspace.listDocuments('extension').length === 0);
  await run(1, ['screenshot', '--filename', join(output, '未授权保护.png')], '无授权截图'); await run(1, ['close'], '关闭无授权资料');
  await run(0, ['open', 'about:blank', '--headed'], '独立空资料'); await run(0, ['snapshot'], '初始快照');
  await code(0, `await page.context().addInitScript({path:${JSON.stringify(fixture.bootstrap)}});page.on('dialog',dialog=>dialog.dismiss());await page.emulateMedia({colorScheme:'light'});await page.context().route('**/*',route=>{const u=new URL(route.request().url());return [${JSON.stringify(fixture.origin)},${JSON.stringify(fixture.dataURL)}].includes(u.origin)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort()});await page.goto(${JSON.stringify(fixture.origin)});await page.getByRole('banner',{name:'工作台顶栏'}).getByRole('button',{name:'新建产品',exact:true}).waitFor();`, '授权后原首页');
  check('完整构建的原首页通过SQLite初始化后显示', true);
  await code(0, `if(await page.evaluate(()=>window.__browserPersistenceCalls.length))throw Error('首次启动访问浏览器存储');`, '首次启动零浏览器存储');
  check('首次启动包含HTML主题与Router初始化，浏览器存储哨兵零调用', true);
  await snapshotClick('新建产品', '实际新建产品');
  await code(0, `await page.waitForURL('**/canvas/*');await page.getByRole('button',{name:'文本',exact:true}).waitFor();`, '等待画布');
  await snapshotClick('文本', '实际新增文本节点');
  await code(0, `await page.waitForFunction(async()=>{const raw=await window.__guanSQLiteTest.app.createInstance({storeName:'app_state'}).getItem('infinite-canvas:canvas_store');return raw&&JSON.parse(raw).state.projects[0]?.nodes.length>0});`, '等待实际保存ACK');
  check('实际新建产品和文本节点经API写入本机SQLite', (await persistedCanvas())?.state.projects[0]?.nodes.some(node => node.type === 'text'));
  const nodesSnapshot = await run(0, ['snapshot'], '新增节点后的渲染边界');
  check('新增节点后保持实际画布，没有进入路由错误页', !nodesSnapshot.includes('Unexpected Application Error!') && nodesSnapshot.includes('button "文本"'));
  await code(0, `const input=page.locator('input[type=file][accept*="image/"]').first();await input.setInputFiles({name:'SQLite合成图片.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2nJ6kAAAAASUVORK5CYII=','base64')});await page.waitForFunction(async()=>{const raw=await window.__guanSQLiteTest.app.createInstance({storeName:'app_state'}).getItem('infinite-canvas:canvas_store');return raw&&JSON.parse(raw).state.projects[0]?.nodes.some(n=>n.type==='image')});`, '实际上传图片');
  check('原上传流程的图片和预览实际写入受管媒体', fixture.workspace.listDocuments('extension').map(row => fixture.workspace.readDocument('extension', row.id)).some(doc => doc.value.namespace === 'image_files' && doc.mediaIds.length > 0));
  check('包含图片引用的画布状态实际写入SQLite，而非只存图片文件', (await persistedCanvas())?.state.projects[0]?.nodes.some(node => node.type === 'image' && node.metadata?.storageKey?.startsWith('image:')));
  await run(0, ['screenshot', '--filename', join(output, '画布与媒体.png')], '画布截图');
  await code(0, `${reloadSaved}await page.getByRole('button',{name:'文本',exact:true}).first().waitFor();await page.waitForFunction(()=>[...document.images].some(img=>img.src.startsWith('blob:')&&img.complete&&img.naturalWidth>0));if(await page.evaluate(()=>window.__browserPersistenceCalls.length))throw Error('调用了浏览器数据库');`, '刷新恢复实际画布');
  check('刷新恢复实际节点与图片，浏览器持久化哨兵零调用', true);
  // 真实“新建产品”使用replace而非push，不能假设后退会回首页。
  // 用浏览器同文档片段导航建立历史项，再验证Router的原生popstate接收者。
  await code(0, `const canvasURL=page.url(),historyURL=canvasURL+'#sqlite-history-test',identity=await page.evaluate(()=>window.__guanSQLitePageIdentity);await page.goto(historyURL);await page.goBack();await page.waitForURL(canvasURL);await page.getByRole('button',{name:'文本',exact:true}).first().waitFor();await page.goForward();await page.waitForURL(historyURL);await page.getByRole('button',{name:'文本',exact:true}).first().waitFor();if(await page.evaluate(()=>window.__guanSQLitePageIdentity)!==identity)throw Error('同文档历史前进后退不应重载');if(await page.evaluate(()=>window.__browserPersistenceCalls.length))throw Error('历史前进后退访问浏览器存储');`, '实际路由前进后退');
  check('实际浏览器片段历史前进后退保留画布与文档身份，存储零调用', true);
  await snapshotClick('切换深色主题', '实际主题切换');
  await code(0, `await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));${reloadSaved}await page.getByRole('button',{name:'文本',exact:true}).first().waitFor();await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));if(await page.evaluate(()=>window.__browserPersistenceCalls.length))throw Error('偏好调用浏览器存储');`, '主题刷新恢复');
  check('原主题交互保存到SQLite，启动前恢复且零浏览器持久化调用', true);
  const errors = await run(0, ['console', 'error'], '运行错误检查');
  // 空库首次读取的两个document_not_found是协议设计的404，单列记录而不伪称零控制台消息。
  check('实际构建无React、初始化或未处理运行异常（首次缺项404单列）', !/TypeError|ReferenceError|StorageError|Invalid hook|Uncaught|Unhandled|尚未初始化|caught the following error/.test(errors));
  passed = true;
} catch (error) {
  // 不用泛化超时代替保存边界证据；只记状态/计数，不输出画布内容、会话或凭据。
  try { await code(0, `return await page.evaluate(()=>({bridge:window.__guanSQLiteStorageStatus,runtime:window.__guanSQLiteTest?.app.getStatus(),browserPersistenceCalls:window.__browserPersistenceCalls?.length}))`, '失败保存边界诊断'); } catch { /* 页面可能已关闭；保留原始步骤日志。 */ }
  blocked.push({ boundary: '实际React界面→SQLite持久化及恢复', reason: error.message }); process.exitCode = 1;
} finally {
  for (let index = 0; index < sessions.length; index++) {
    try { await run(index, ['snapshot'], '最终快照-' + index); await run(index, ['console', 'error'], '控制台-' + index); await run(index, ['screenshot', '--filename', join(output, '最终-' + index + '.png')], '最终截图-' + index); } catch { /* 未打开或已关闭 */ }
    try { await run(index, ['close'], '最终关闭-' + index); } catch { /* 不接触其他资料 */ }
  }
  const requests = [...new Set(fixture.requests)];
  await fixture.close();
  const report = { passed, results, blocked, output, syntheticDataRoot: fixture.root, integration: fixture.integration, requestedPaths: requests, real3100Untouched: true, productionAuthorizationImplemented: false };
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
}
