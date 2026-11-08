import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { 根目录 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';
import { createWorkbenchAuthorizationFixture } from './工作台授权入口浏览器夹具.mjs';

检查运行副本();
const exec = promisify(execFile), cli = join(根目录, 'node_modules/.bin/playwright-cli');
const output = join(根目录, '.运行/output/playwright', '工作台授权入口-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const session = 'guan-entry-' + Date.now(), results = [], blocked = [], secrets = [], privateFiles = [];
let fixture, sequence = 0, passed = false, cold;
async function run(args, label) {
  let stdout, stderr, failure;
  try { ({ stdout, stderr } = await exec(cli, ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), timeout: 45_000, maxBuffer: 2 * 1024 * 1024 })); }
  catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failure = error; }
  let log = stdout + stderr; for (const secret of secrets) log = log.replaceAll(secret, '[临时授权码已隐去]');
  writeFileSync(join(output, `${sequence++}-${label}.log`), log);
  if (failure || /^### Error\b/m.test(stdout)) throw Error('浏览器步骤失败：' + label);
  return stdout;
}
function check(name, condition) { results.push({ name, passed: !!condition }); if (!condition) throw Error(name); }
async function code(source, label) {
  const marker = 'ENTRY_COMPLETE:' + label;
  const result = await run(['run-code', `async page=>{${source};return ${JSON.stringify(marker)}}`], label);
  if (!result.includes(marker)) throw Error('缺少完成证明：' + label);
}
async function submit(codeValue, expected, label) {
  secrets.push(codeValue);
  const snapshot = await run(['snapshot'], label + '-表单快照');
  if (!snapshot.includes('textbox "本机一次性授权码"')) throw Error('没有观察到真实授权输入框');
  const file = join(fixture.root, label + '.mjs'); privateFiles.push(file);
  writeFileSync(file, `async page=>{await page.getByLabel('本机一次性授权码').fill(${JSON.stringify(codeValue)});await page.getByRole('button',{name:'授权并打开工作台',exact:true}).click();await page.getByText(${JSON.stringify(expected)},{exact:false}).waitFor();return '实际表单已提交';}`, { mode: 0o600 });
  const result = await run(['run-code', '--filename', file], label); unlinkSync(file);
  if (!result.includes('实际表单已提交')) throw Error('真实表单未完成');
}
try {
  fixture = await createWorkbenchAuthorizationFixture();
  check('服务器开放授权前已有首份真实备份', fixture.getStatus().backup.lastBackup?.reason === 'startup');
  await run(['open', 'about:blank', '--headed'], '独立空浏览器'); await run(['snapshot'], '初始快照');
  await code(`await page.context().addInitScript(()=>{window.__persistenceCalls=[];for(const name of ['getItem','setItem','removeItem','clear'])Storage.prototype[name]=function(){window.__persistenceCalls.push(name);throw Error('禁止浏览器存储')};IDBFactory.prototype.open=function(){window.__persistenceCalls.push('indexedDB');throw Error('禁止浏览器存储')}});await page.context().route('**/*',route=>[${JSON.stringify(fixture.origin)},${JSON.stringify(fixture.dataURL)}].includes(new URL(route.request().url()).origin)?route.continue():route.abort());await page.goto(${JSON.stringify(fixture.origin)});await page.getByRole('heading',{name:'连接本机工作区',exact:true}).waitFor();if(await page.evaluate(()=>!!window.__guanSQLiteHost||document.documentElement.dataset.trustedInline!=='loaded'))throw Error('授权前host或可信脚本不正确')`, '未授权入口与精确CSP脚本');
  check('未授权时没有存储host，首屏可信内联脚本可执行', fixture.getStatus().authorization.authorizedPages === 0);
  await submit('0'.repeat(64), '本机授权或连接未通过', '无效码失败');
  check('无效码不加载合成应用、不发布host也不写空数据', fixture.getStatus().authorization.authorizedPages === 0 && fixture.workspace.listDocuments('extension').length === 0);
  await code(`await page.route('**/usage',route=>route.abort())`, '注入一次健康连接失败');
  await submit(fixture.issueTicket().code, '本机授权或连接未通过', '健康失败');
  await code(`if(await page.evaluate(()=>!!window.__guanSQLiteHost))throw Error('健康失败仍发布host');await page.unroute('**/usage')`, '检查健康失败后封闭');
  check('健康检查失败撤销该次授权，未渲染应用或写入数据库', fixture.getStatus().authorization.authorizedPages === 0 && fixture.workspace.listDocuments('extension').length === 0);
  await submit(fixture.issueTicket().code, '隔离应用已加载（非原工作台）', '成功授权加载');
  await code(`if(await page.locator('input[type=password]').count())throw Error('授权表单未移除');if(await page.evaluate(()=>{const d=Object.getOwnPropertyDescriptor(window,'__guanSQLiteHost');return !d||d.writable||d.configurable}))throw Error('host可覆盖');if((await page.context().cookies()).length)throw Error('出现Cookie')`, '授权码移除与不可覆盖host');
  check('真实表单成功后才加载应用，存储host不可覆盖，不使用Cookie', fixture.getStatus().authorization.authorizedPages === 1);
  const snapshot = await run(['snapshot'], '保存前快照');
  const inputRef = snapshot.split('\n').find(line => line.includes('textbox "合成记录标题"'))?.match(/\[ref=([^\]]+)\]/)?.[1];
  const buttonRef = snapshot.split('\n').find(line => line.includes('button "保存到本机SQLite"'))?.match(/\[ref=([^\]]+)\]/)?.[1];
  if (!inputRef || !buttonRef) throw Error('合成应用保存控件缺失');
  await run(['fill', inputRef, '授权启动后真实保存'], '填写合成标题'); await run(['click', buttonRef], '点击真实保存');
  await code(`await page.getByRole('status').filter({hasText:'已保存：收到SQLite确认'}).waitFor()`, '等待SQLiteACK');
  check('授权入口交付的存储确实写入最终批准四文件服务包', fixture.workspace.listDocuments('extension')[0]?.revision === 1);
  await code(`await page.reload();await page.getByRole('heading',{name:'连接本机工作区',exact:true}).waitFor();if(await page.evaluate(()=>!!window.__guanSQLiteHost))throw Error('刷新静默恢复host')`, '刷新回授权态');
  check('刷新不静默授权，已有数据库记录保持不变', fixture.workspace.listDocuments('extension')[0]?.revision === 1);
  await submit(fixture.issueTicket().code, '隔离应用已加载（非原工作台）', '刷新重新授权');
  await code(`await page.getByRole('status').filter({hasText:'已从SQLite恢复'}).waitFor();if(await page.getByLabel('合成记录标题').inputValue()!=='授权启动后真实保存')throw Error('未从SQLite恢复内容');if(await page.evaluate(()=>window.__persistenceCalls.length))throw Error('使用浏览器存储')`, '实际恢复与零浏览器库');
  check('重新授权后恢复原内容，零浏览器持久化调用', true);
  await run(['screenshot', '--filename', join(output, '成功授权恢复.png')], '保存恢复截图');
  await code(`await page.goto(${JSON.stringify(fixture.origin + '/canvas/module-failure')});await page.getByRole('heading',{name:'连接本机工作区',exact:true}).waitFor()`, '模块失败夹具');
  await submit(fixture.issueTicket().code, '工作台模块未能加载', '模块失败不重试');
  await code(`if(await page.getByRole('button',{name:'授权并打开工作台',exact:true}).isVisible())throw Error('模块失败允许覆盖host');if(await page.evaluate(()=>window.__persistenceCalls.length))throw Error('访问浏览器库')`, '模块失败封闭状态');
  check('模块加载失败可见且不能重新覆盖host或回退空画布', fixture.workspace.listDocuments('extension')[0]?.revision === 1);
  const errors = await run(['console', 'error'], '控制台');
  check('除预期无效码及健康连接故障外，没有JS未处理异常', !/Uncaught|Unhandled|ReferenceError|TypeError|violates.*script-src/i.test(errors));
  await run(['screenshot', '--filename', join(output, '模块失败封闭.png')], '故障截图'); passed = true;
} catch (error) { blocked.push({ boundary: '自有启动器→授权表单→健康检查→存储host→合成应用→SQLite', reason: error.message }); process.exitCode = 1; }
finally {
  try { await run(['snapshot'], '最终快照'); await run(['console', 'error'], '最终错误'); } catch { /* 没有启动浏览器。 */ }
  try { await run(['close'], '关闭本轮独立浏览器'); } catch { /* 不操作其他浏览器。 */ }
  try {
    if (fixture) {
      await fixture.close();
      const db = new DatabaseSync(join(fixture.dataRoot, '工作台.sqlite'), { readOnly: true });
      try { cold = { integrity: db.prepare('PRAGMA integrity_check').get().integrity_check, foreignKeys: db.prepare('PRAGMA foreign_key_check').all().length,
        revisions: db.prepare('SELECT revision FROM documents').all().map(row => row.revision), operations: db.prepare('SELECT count(*) AS n FROM operations').get().n,
        lockAbsent: !existsSync(join(fixture.dataRoot, '.实例锁.json')) }; } finally { db.close(); }
      if (passed) check('正常停服后独立冷读完整性ok，仅一笔保存且无实例锁', cold.integrity === 'ok' && !cold.foreignKeys && cold.lockAbsent && cold.revisions.join(',') === '1' && cold.operations === 1);
    }
  } catch (error) { passed = false; blocked.push({ boundary: '停服及冷读', reason: error.message }); process.exitCode = 1; }
  for (const file of privateFiles) if (existsSync(file)) unlinkSync(file);
  const report = { passed, results, blocked, cold, output, syntheticDataRoot: fixture?.dataRoot, integration: fixture?.integration,
    authorizationRuntimeInjected: false, application: '自有合成应用，不是原画布', pendingCorePatchApplied: false, real3100Untouched: true,
    authorizationFilesRemoved: privateFiles.every(file => !existsSync(file)) };
  const content = JSON.stringify(report, null, 2) + '\n';
  if (secrets.some(secret => content.includes(secret))) { process.exitCode = 1; console.error('验收输出包含临时授权码，不发布结果。'); }
  else { writeFileSync(join(output, '验收结果.json'), content); console.log(content); }
}
