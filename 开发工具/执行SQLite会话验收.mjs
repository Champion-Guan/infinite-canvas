import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { createSQLiteUIFixture } from './SQLite完整界面夹具.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';

const exec = promisify(execFile), cli = join(根目录, 'node_modules/.bin/playwright-cli');
const output = join(根目录, '.运行/output/playwright', 'SQLite受控会话-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const results = [], blocked = [], session = 'guan-sqlite-session-' + Date.now();
let fixture, sequence = 0, passed = false;
async function run(args, label) {
  let stdout, stderr, failure;
  try { ({ stdout, stderr } = await exec(cli, ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), timeout: 60_000, maxBuffer: 4 * 1024 * 1024 })); }
  catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failure = error; }
  writeFileSync(join(output, `${sequence++}-${label}.log`), stdout + stderr);
  if (failure || /^### Error\b/m.test(stdout)) throw Error('浏览器步骤失败：' + label);
  return stdout;
}
async function code(source, label) {
  const marker = 'GUAN_SESSION_STEP_COMPLETE:' + label;
  const result = await run(['run-code', `async page=>{const value=await(async()=>{${source}})();return{completed:${JSON.stringify(marker)},value}}`], label);
  if (!result.includes(marker)) throw Error('缺少浏览器完成证明：' + label);
  return result;
}
function check(name, condition) { results.push({ name, passed: !!condition }); if (!condition) throw Error(name); }
async function click(name, label) {
  const snapshot = await run(['snapshot'], label + '-快照');
  // 已有节点时，侧栏和节点标题也叫“文本”；锁定快照中明确可点击的工具栏按钮。
  const ref = snapshot.split('\n').find(line => line.includes('button "' + name + '"') && !line.includes('[disabled]') &&
    (name !== '文本' || line.includes('[cursor=pointer]')))?.match(/\[ref=([^\]]+)\]/)?.[1];
  if (!ref) throw Error('快照未找到按钮：' + name);
  await run(['click', ref], label);
}
async function canvas() {
  const doc = fixture.workspace.listDocuments('extension').map(row => fixture.workspace.readDocument('extension', row.id)).find(row => row.value.namespace === 'app_state');
  const entry = doc?.value.entries.find(([key]) => key === 'infinite-canvas:canvas_store');
  if (!entry) return null;
  const codec = createValueCodec({ client: { async readMedia(id) { const media = fixture.workspace.readMedia(id); return new Blob([media.bytes], { type: media.mime }); } } });
  try { return await codec.decode(entry[1].tree); } finally { codec.close(); }
}
try {
  fixture = await createSQLiteUIFixture({ testSessionRenewal: true });
  const denied = await fetch(fixture.origin + '/__sqlite-test/session', { method: 'POST', headers: { Origin: fixture.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'initialize' }) });
  check('隔离测试桥不向匿名HTTP调用签发会话', denied.status === 403 && fixture.sessionCounts.initializes === 0);
  await run(['open', 'about:blank', '--headed'], '隔离浏览器'); await run(['snapshot'], '初始快照');
  await code(`
    await page.context().addInitScript({path:${JSON.stringify(fixture.bootstrap)}});
    await page.context().route('**/*',route=>{const u=new URL(route.request().url());return [${JSON.stringify(fixture.origin)},${JSON.stringify(fixture.dataURL)}].includes(u.origin)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort()});
    await page.goto(${JSON.stringify(fixture.origin)});await page.getByRole('banner',{name:'工作台顶栏'}).waitFor();
  `, '受控端口启动原界面');
  check('完整原界面经受控测试端口初始化，未提供HTTP匿名授权', fixture.sessionCounts.initializes === 1);
  await click('新建产品', '实际新建产品');
  await code(`await page.waitForURL('**/canvas/*');await page.getByRole('button',{name:'文本',exact:true}).waitFor();`, '等待画布');
  await click('文本', '续期前新增文本');
  await code(`await page.waitForFunction(()=>window.__guanSQLiteStorageStatus?.state==='saved'&&window.__guanSQLiteStorageStatus.pending===0);await page.evaluate(()=>window.__guanSQLiteTest.app.flush());`, '等待首次落盘');
  check('续期前原画布文本实际落盘', (await canvas())?.state.projects[0]?.nodes.length === 1);
  const offset = fixture.advanceSessionClock(271_000);
  await code(`await page.evaluate(offset=>window.__guanTestTimeOffset=offset,${offset});await page.evaluate(()=>Promise.all(Array.from({length:6},()=>window.__guanSQLiteTest.client.readUsage())));`, '六请求共享一次续期');
  check('六个并发请求共享一次令牌续期，未重新初始化', fixture.sessionCounts.renewals === 1 && fixture.sessionCounts.initializes === 1);
  await click('文本', '续期后新增文本');
  await code(`await page.waitForFunction(()=>window.__guanSQLiteStorageStatus?.state==='saved'&&window.__guanSQLiteStorageStatus.pending===0);await page.evaluate(()=>window.__guanSQLiteTest.app.flush());`, '等待续期后落盘');
  check('续期后新增节点仍真实落盘，画布没有丢失已有节点', (await canvas())?.state.projects[0]?.nodes.length === 2);
  await code(`await page.evaluate(()=>{if(window.__browserPersistenceCalls.length)throw Error('访问浏览器存储')});await page.context().addInitScript('window.__guanTestTimeOffset=${offset}');const old=await page.evaluate(()=>window.__guanSQLitePageIdentity);await page.reload();await page.waitForFunction(old=>window.__guanSQLitePageIdentity!==old,old);await page.getByRole('button',{name:'文本',exact:true}).first().waitFor();await page.evaluate(async()=>{if(window.__browserPersistenceCalls.length)throw Error('重载访问浏览器存储');const raw=await window.__guanSQLiteTest.app.createInstance({storeName:'app_state'}).getItem('infinite-canvas:canvas_store');if(JSON.parse(raw).state.projects[0]?.nodes.length!==2)throw Error('重载节点数不符')});`, '续期后实际重载');
  check('新文档重载恢复两节点，测试端口沿用当前授权，浏览器存储零调用', (await canvas())?.state.projects[0]?.nodes.length === 2 && fixture.sessionCounts.initializes === 2 && fixture.sessionCounts.renewals === 1);
  // 不改业务时钟；仅推进续期客户端/服务夹具时钟，模拟休眠后会话已过期。
  const expiredOffset = fixture.advanceSessionClock(301_000);
  const before = JSON.stringify(fixture.workspace.listDocuments('extension'));
  await code(`await page.evaluate(offset=>window.__guanTestTimeOffset=offset,${expiredOffset});const result=await page.evaluate(async()=>{try{await window.__guanSQLiteTest.client.readUsage();return 'unexpected-success'}catch(error){return error.code}});if(result!=='session_expired')throw Error('过期未被阻断');const status=await page.evaluate(()=>window.__guanSQLiteTest.client.getStatus());if(status.state!=='error')throw Error('缺少失败状态');`, '休眠过期安全停止');
  check('休眠过期不自动重新授权、不改写数据库', fixture.sessionCounts.initializes === 2 && fixture.sessionCounts.renewals === 1 && JSON.stringify(fixture.workspace.listDocuments('extension')) === before);
  const errors = await run(['console', 'error'], '控制台');
  check('无React或未处理异常（空库首次404单独保留）', !/TypeError|ReferenceError|Uncaught|Unhandled|Invalid hook|caught the following error/.test(errors));
  await run(['screenshot', '--filename', join(output, '受控会话画布.png')], '最终截图');
  passed = true;
} catch (error) { blocked.push({ boundary: '实际画布→受控测试端口→续期→SQLite', reason: error.message }); process.exitCode = 1; }
finally {
  try { await run(['snapshot'], '最终快照'); await run(['console', 'error'], '最终控制台'); } catch { /* 未启动或已关闭。 */ }
  try { await run(['close'], '关闭隔离浏览器'); } catch { /* 不触及其他资料。 */ }
  const counts = fixture?.sessionCounts;
  if (fixture) await fixture.close();
  const report = { passed, results, blocked, output, sessionCounts: counts, syntheticDataRoot: fixture?.root, integration: fixture?.integration, authorizationArtifactsRemoved: fixture ? !existsSync(fixture.bootstrap) : null, productionAuthorizationDeliveryImplemented: false, real3100Untouched: true };
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
}
