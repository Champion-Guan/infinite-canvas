import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { 根目录 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';
import { createAuthorizationBrowserFixture } from './本机授权浏览器夹具.mjs';

检查运行副本();
const exec = promisify(execFile), cli = join(根目录, 'node_modules/.bin/playwright-cli');
const output = join(根目录, '.运行/output/playwright', '本机授权-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const session = 'guan-local-auth-' + Date.now(), results = [], blocked = [], secrets = [], privateFiles = [];
let fixture, sequence = 0, passed = false, cold;
async function run(args, label) {
  let stdout, stderr, failure;
  try { ({ stdout, stderr } = await exec(cli, ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), timeout: 60_000, maxBuffer: 2 * 1024 * 1024 })); }
  catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failure = error; }
  let log = stdout + stderr; for (const secret of secrets) log = log.replaceAll(secret, '[本机临时授权码已隐去]');
  writeFileSync(join(output, `${sequence++}-${label}.log`), log);
  if (failure || /^### Error\b/m.test(stdout)) throw Error('浏览器步骤失败：' + label);
  return stdout;
}
function check(name, condition) { results.push({ name, passed: !!condition }); if (!condition) throw Error(name); }
async function code(source, label) {
  const marker = 'LOCAL_AUTH_COMPLETE:' + label;
  const result = await run(['run-code', `async page=>{${source};return ${JSON.stringify(marker)}}`], label);
  if (!result.includes(marker)) throw Error('缺少完成证明：' + label);
}
async function click(name, label) {
  const snapshot = await run(['snapshot'], label + '-快照');
  const ref = snapshot.split('\n').find(line => line.includes('button "' + name + '"') && !line.includes('[disabled]'))?.match(/\[ref=([^\]]+)\]/)?.[1];
  if (!ref) throw Error('没有可点击的验收按钮：' + name);
  await run(['click', ref], label);
}
async function authorize(label) {
  const ticket = fixture.issueTicket(); secrets.push(ticket.code);
  const snapshot = await run(['snapshot'], label + '-表单快照');
  if (!snapshot.includes('textbox "本机入口的一次性授权码"')) throw Error('未找到授权表单');
  // 仅通过观察过的真实表单输入码；不向window注入host、能力、会话或SQLite运行时。
  // 临时0600脚本避免把码放入CLI参数/工具输出；响应日志也执行脱敏。
  const file = join(fixture.root, label + '.mjs'); privateFiles.push(file);
  writeFileSync(file, `async page=>{await page.getByLabel('本机入口的一次性授权码').fill(${JSON.stringify(ticket.code)});await page.getByRole('button',{name:'授权连接',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role=status]').textContent.startsWith('已授权：'));return '真实表单授权完成'}`, { mode: 0o600 });
  const result = await run(['run-code', '--filename', file], label);
  if (!result.includes('真实表单授权完成')) throw Error('授权表单未返回完成证明');
  unlinkSync(file);
  return ticket;
}
try {
  fixture = await createAuthorizationBrowserFixture();
  const anonymous = await fetch(fixture.origin + '/__guan-local/session', { method: 'POST', headers: { Origin: fixture.origin, 'Content-Type': 'application/json', 'X-Guan-Local-Protocol': 'guan-local-authorization.v1' }, body: JSON.stringify({ operation: 'initialize' }) });
  check('页面尚未授权时，真实HTTP不签发数据会话', anonymous.status === 401 && fixture.getStatus().authorizedPages === 0);
  await run(['open', 'about:blank', '--headed'], '隔离空浏览器'); await run(['snapshot'], '初始快照');
  await code(`await page.context().addInitScript(()=>{window.__persistenceCalls=[];for(const name of ['getItem','setItem','removeItem','clear'])Storage.prototype[name]=function(){window.__persistenceCalls.push(name);throw Error('浏览器存储禁止')};IDBFactory.prototype.open=function(){window.__persistenceCalls.push('indexedDB');throw Error('浏览器存储禁止')}});await page.context().route('**/*',route=>{const url=new URL(route.request().url());return [${JSON.stringify(fixture.origin)},${JSON.stringify(fixture.dataURL)}].includes(url.origin)?route.continue():route.abort()});await page.goto(${JSON.stringify(fixture.origin)});await page.getByRole('heading',{name:'本机存储授权 · 隔离验收'}).waitFor();await page.getByRole('button',{name:'授权连接',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('form button').disabled)`, '打开未授权表单');
  const first = await authorize('首次表单授权');
  check('通过真实表单和HTTP兑换一次性码，不注入会话运行时', fixture.getStatus().authorizedPages === 1 && fixture.getStatus().pendingTickets === 0);
  await code(`if(await page.locator('input[type=password]').inputValue())throw Error('授权码仍在表单');if((await page.context().cookies()).length)throw Error('出现Cookie');if(await page.evaluate(()=>window.__persistenceCalls.length))throw Error('访问了浏览器存储')`, '授权码清除和零浏览器持久化');
  check('授权码从表单清除，Cookie和浏览器数据库均未使用', true);
  await click('保存合成记录', '第一次真实保存'); await code(`await page.getByRole('status').filter({hasText:'已保存：SQLite已确认'}).waitFor()`, '等待实际保存确认');
  const doc = fixture.workspace.listDocuments('extension')[0], firstRevision = doc?.revision;
  check('授权后的合成记录通过最终四文件包保存到SQLite', firstRevision === 1);
  await code(`await page.reload();await page.getByRole('button',{name:'授权连接',exact:true}).waitFor();if(!(await page.getByRole('button',{name:'保存合成记录',exact:true}).isDisabled()))throw Error('刷新后仍有未确认能力')`, '刷新不得静默授权');
  check('刷新丢弃内存能力，不依赖Cookie或旧浏览器记录重新授权', fixture.workspace.listDocuments('extension')[0]?.revision === firstRevision);
  await authorize('刷新后重新授权');
  await code(`await page.getByRole('status').filter({hasText:'已从SQLite恢复测试记录'}).waitFor();await page.getByLabel('模拟一次保存响应丢失（仅隔离测试）').check()`, '从SQLite恢复并启用单次丢失响应');
  await click('保存合成记录', '丢失保存响应');
  await code(`await page.getByRole('status').filter({hasText:'保存结果未确认'}).waitFor();if(!(await page.getByRole('button',{name:'撤销本页授权',exact:true}).isDisabled()))throw Error('未确认时允许关闭')`, '失败状态可见且关闭阻止');
  const committedRevision = fixture.workspace.listDocuments('extension')[0]?.revision;
  check('数据库已提交但响应丢失时不冒报成功，保留明确重试入口', committedRevision === firstRevision + 1);
  await click('重试同一笔保存', '显式重试原操作');
  await code(`await page.getByRole('status').filter({hasText:'同一操作已确认，未重复提交新修订'}).waitFor()`, '等待同操作幂等ACK');
  check('显式重试取得原ACK，没有额外增加SQLite修订', fixture.workspace.listDocuments('extension')[0]?.revision === committedRevision);
  await click('撤销本页授权', '保存确认后撤销'); await code(`await page.getByRole('status').filter({hasText:'授权已撤销'}).waitFor();if(await page.evaluate(()=>window.__persistenceCalls.length))throw Error('访问浏览器数据库')`, '确认撤销与零存储调用');
  check('撤销释放当前页面租约，数据库保留；上一刷新页面仅等待期限撤销', fixture.getStatus().authorizedPages === 1 && fixture.workspace.listDocuments('extension')[0]?.revision === committedRevision);
  check('服务器所记录请求路径不含授权码，且不用查询参数传递秘密', fixture.paths.every(path => !path.includes('?') && !secrets.some(secret => path.includes(secret))));
  const errors = await run(['console', 'error'], '控制台');
  check('没有JS未处理异常，故障注入及首次空项HTTP错误单列保留', !/TypeError|ReferenceError|Uncaught|Unhandled/.test(errors));
  await run(['screenshot', '--filename', join(output, '本机授权验收.png')], '最终截图');
  if (!first?.code) throw Error('缺少可信签发证据');
  passed = true;
} catch (error) { blocked.push({ boundary: '表单→授权网关→本机API→SQLite→失败原操作重试', reason: error.message }); process.exitCode = 1; }
finally {
  try { await run(['snapshot'], '最终快照'); await run(['console', 'error'], '最终错误'); } catch { /* 没有启动浏览器。 */ }
  try { await run(['close'], '关闭自有浏览器'); } catch { /* 不操作其他浏览器。 */ }
  try {
    if (fixture) {
      await fixture.close();
      const db = new DatabaseSync(join(fixture.root, '数据/工作台.sqlite'), { readOnly: true });
      try { cold = { integrity: db.prepare('PRAGMA integrity_check').get().integrity_check, foreignKeys: db.prepare('PRAGMA foreign_key_check').all().length,
        revisions: db.prepare('SELECT revision FROM documents').all().map(row => row.revision), operations: db.prepare('SELECT count(*) AS n FROM operations').get().n,
        lockAbsent: !existsSync(join(fixture.root, '数据/.实例锁.json')) }; }
      finally { db.close(); }
      if (passed) check('关闭后独立SQLite冷读：完整性正常、仅两笔实际操作、无实例锁', cold.integrity === 'ok' && cold.foreignKeys === 0 && cold.lockAbsent && cold.revisions.join(',') === '2' && cold.operations === 2);
    }
  } catch (error) { passed = false; blocked.push({ boundary: '清理与独立冷读', reason: error.message }); process.exitCode = 1; }
  for (const file of privateFiles) if (existsSync(file)) unlinkSync(file);
  const report = { passed, results, blocked, cold, output, syntheticDataRoot: fixture?.root, integration: fixture?.integration,
    requestPaths: fixture?.paths, authorizationFilesRemoved: privateFiles.every(file => !existsSync(file)), real3100Untouched: true,
    authorizationRuntimeInjected: false, upstreamApplicationIntegrated: false, limitation: '仅自有授权模块与隔离表单验收；不是3100正式入口，刷新需新码，API凭据端口/客户启动器仍未完成' };
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n');
  // 二次检查自己的文本证据，防止CLI未来改变输出格式导致合成授权码泄漏。
  if (secrets.some(secret => readFileSync(join(output, '验收结果.json'), 'utf8').includes(secret))) { process.exitCode = 1; console.error('验收输出包含临时授权码，不报告通过。'); }
  console.log(JSON.stringify(report, null, 2));
}
