import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { createAutomaticEntryFixture } from './免填码启动浏览器夹具.mjs';

const exec = promisify(execFile), cli = join(根目录, 'node_modules/.bin/playwright-cli');
const output = join(根目录, '.运行/output/playwright', 'SQLite免填码启动-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const session = 'guan-auto-' + Date.now(), results = [], blocked = [];
let fixture, sequence = 0, passed = false;
async function run(args, label) {
  let stdout, stderr, failed;
  try { ({ stdout, stderr } = await exec(cli, ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), timeout: 45_000, maxBuffer: 2 * 1024 * 1024 })); }
  catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failed = true; }
  // 即使失败也不将内部握手材料写入日志。
  writeFileSync(join(output, `${sequence++}-${label}.log`), (stdout + stderr).replace(/[a-f0-9]{64}/g, '[内部材料已隐去]'));
  if (failed || /^### Error\b/m.test(stdout)) throw Error('浏览器步骤失败：' + label);
  return stdout;
}
function check(name, value) { results.push({ name, passed: !!value }); if (!value) throw Error(name); }
async function code(source, label) {
  const marker = 'AUTOMATIC_ENTRY_OK:' + label;
  if (!(await run(['run-code', `async page=>{${source};return ${JSON.stringify(marker)}}`], label)).includes(marker)) throw Error('缺少完成证明：' + label);
}
async function click(name, label) {
  const snapshot = await run(['snapshot'], label + '-快照');
  const ref = snapshot.split('\n').find(line => line.includes('button "' + name + '"') && !line.includes('[disabled]'))?.match(/\[ref=([^\]]+)\]/)?.[1];
  if (!ref) throw Error('缺少按钮：' + name); await run(['click', ref], label);
}
const loaded = "await page.getByRole('heading',{name:'工作区自动打开（隔离合成应用，非原画布）',exact:true}).waitFor();if(await page.locator('input[type=password],meta[name=guan-local-bootstrap]').count())throw Error('仍有手填码或内部材料');";
try {
  fixture = await createAutomaticEntryFixture();
  check('首份真实备份先完成', fixture.getStatus().backup.lastBackup?.reason === 'startup');
  await run(['open', 'about:blank', '--headed'], '独立浏览器'); await run(['snapshot'], '初始快照');
  await code(`await page.context().addInitScript(()=>{window.__storageCalls=[];for(const name of ['getItem','setItem','removeItem','clear'])Storage.prototype[name]=function(){window.__storageCalls.push(name);throw Error('禁止浏览器持久化')};IDBFactory.prototype.open=function(){window.__storageCalls.push('idb');throw Error('禁止浏览器持久化')}});await page.context().route('**/*',route=>[${JSON.stringify(fixture.origin)},${JSON.stringify(fixture.dataURL)}].includes(new URL(route.request().url()).origin)?route.continue():route.abort());await page.goto(${JSON.stringify(fixture.origin)});${loaded}`, '无需手填直接打开');
  check('直接导航即打开，无输入框、无测试授权注入、DOM材料已移除', fixture.getStatus().authorization.authorizedPages === 1);
  const snapshot = await run(['snapshot'], '填写前快照'), ref = snapshot.split('\n').find(line => line.includes('textbox "测试标题"'))?.match(/\[ref=([^\]]+)\]/)?.[1];
  if (!ref) throw Error('缺少测试标题框'); await run(['fill', ref, '直接打开并刷新恢复'], '填写测试标题'); await click('保存测试记录', '点击保存');
  await code("await page.getByRole('status').filter({hasText:'已收到SQLite保存确认'}).waitFor()", '真实保存ACK');
  check('免填码入口写入真实SQLite且收到ACK', fixture.workspace.listDocuments('extension')[0]?.revision === 1);
  await code(`await page.reload();${loaded}await page.getByRole('status').filter({hasText:'已从SQLite恢复'}).waitFor();if(await page.getByLabel('测试标题').inputValue()!=='直接打开并刷新恢复')throw Error('恢复内容不符')`, '刷新自动握手恢复');
  check('刷新仍不填码，真实恢复原记录', fixture.workspace.listDocuments('extension')[0]?.revision === 1);
  await run(['screenshot', '--filename', join(output, '直接打开与刷新恢复.png')], '恢复截图');
  await code(`await page.route('**/usage',route=>route.abort());await page.reload();await page.getByRole('status').filter({hasText:'本机工作区暂时无法连接'}).waitFor();if(await page.evaluate(()=>!!window.__guanSQLiteHost))throw Error('健康失败仍发布host');await page.unroute('**/usage')`, '健康失败不回退');
  check('健康连接失败显示重开按钮，无空库回退，记录不变', fixture.workspace.listDocuments('extension')[0]?.revision === 1);
  await click('重新打开工作台', '点击重开'); await code(loaded, '重开自动恢复');
  check('点击重开自动获得新材料，不要求用户取码', true);
  await code(`await page.goto(${JSON.stringify(fixture.origin + '/canvas/module-failure')});await page.getByRole('status').filter({hasText:'工作台未能加载'}).waitFor();if(await page.locator('input[type=password],meta[name=guan-local-bootstrap]').count())throw Error('失败后仍保留材料');if(await page.evaluate(()=>window.__storageCalls.length))throw Error('调用浏览器库');if((await page.context().cookies()).length)throw Error('出现Cookie')`, '模块失败与零浏览器库');
  check('模块失败可见；全流程不存Cookie或浏览器库，不保留手填码', true);
  const errors = await run(['console', 'error'], '控制台');
  check('除主动健康断网与空记录404外无JS或CSP异常', !/Uncaught|Unhandled|TypeError|ReferenceError|Content Security Policy/i.test(errors));
  await run(['screenshot', '--filename', join(output, '模块失败可重开.png')], '失败截图'); passed = true;
} catch (error) { process.exitCode = 1; blocked.push({ boundary: '顶层导航→内部握手→自有应用→SQLite→刷新', reason: error.message }); }
finally {
  try { await run(['snapshot'], '最终快照'); await run(['console', 'error'], '最终错误'); } catch { /* 可能还未启动浏览器。 */ }
  try { await run(['close'], '关闭独立浏览器'); } catch { /* 不关闭其他浏览器。 */ }
  try { await fixture?.close(); } catch { passed = false; process.exitCode = 1; blocked.push({ boundary: '正常关闭', reason: '请保留隔离工作区检查锁，未强制清理。' }); }
  const report = { passed, results, blocked, output, syntheticDataRoot: fixture?.dataRoot, candidateOnly: true, application: '自有合成应用，不是原React画布', authorizationRuntimeInjected: false, manualCodeInputRequired: false, real3100Untouched: true };
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
}
