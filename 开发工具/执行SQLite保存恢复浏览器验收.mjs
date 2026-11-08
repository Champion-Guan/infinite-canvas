import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';
import { createSaveRecoveryFixture } from './SQLite保存恢复浏览器夹具.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';

检查运行副本();
const exec = promisify(execFile), cli = join(根目录, 'node_modules/.bin/playwright-cli');
const output = join(根目录, '.运行/output/playwright', 'SQLite保存恢复预审-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const session = 'guan-save-recovery-' + Date.now(), results = [], blocked = [];
let fixture, sequence = 0, passed = false;
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
  const marker = 'SAVE_RECOVERY_OK:' + label;
  if (!(await run(['run-code', `async page=>{${source};return ${JSON.stringify(marker)}}`], label)).includes(marker)) throw Error('没有完成证明：' + label);
}
async function click(name, label) {
  const snapshot = await run(['snapshot'], label + '-快照');
  const ref = snapshot.split('\n').find(line => line.includes('button "' + name + '"') && !line.includes('[disabled]'))?.match(/\[ref=([^\]]+)\]/)?.[1];
  if (!ref) throw Error('没有可点击按钮：' + name); await run(['click', ref], label);
}
async function title(value) {
  const snapshot = await run(['snapshot'], '填写前快照'), ref = snapshot.split('\n').find(line => line.includes('textbox "合成画布名称"'))?.match(/\[ref=([^\]]+)\]/)?.[1];
  if (!ref) throw Error('缺少标题框'); await run(['fill', ref, value], '填写合成名称');
}
async function stored() {
  const doc = fixture.workspace.listDocuments('extension').map(row => fixture.workspace.readDocument('extension', row.id)).find(doc => doc.value.namespace === 'app_state');
  if (!doc) return null;
  const codec = createValueCodec({ client: {} });
  try { return { revision: doc.revision, state: (await codec.decode(doc.value.entries.find(([key]) => key === 'infinite-canvas:canvas_store')[1].tree)).state }; }
  finally { codec.close(); }
}
const failed = "await page.getByRole('alert').filter({hasText:'保存尚未确认'}).waitFor();await page.getByText('编辑仍保留在本页内存中。请勿刷新或关闭，连接恢复后点击重试。',{exact:true}).waitFor();";
const saved = "await page.getByRole('status').filter({hasText:'已保存到本机'}).waitFor();";
try {
  fixture = await createSaveRecoveryFixture();
  check('自有候选合成界面构建及批准磁盘启动器启动，未改原画布', fixture.getStatus().backup.lastBackup?.reason === 'startup');
  await run(['open', 'about:blank', '--headed'], '独立浏览器'); await run(['snapshot'], '初始快照');
  await code(`await page.context().addInitScript(()=>{window.__recoveryStorageCalls=[];for(const name of ['getItem','setItem','removeItem','clear'])Storage.prototype[name]=function(){window.__recoveryStorageCalls.push(name);throw Error('禁止浏览器持久化')};IDBFactory.prototype.open=function(){window.__recoveryStorageCalls.push('indexedDB');throw Error('禁止浏览器持久化')}});await page.context().route('**/*',route=>{const u=new URL(route.request().url());return [${JSON.stringify(fixture.origin)},${JSON.stringify(fixture.dataURL)}].includes(u.origin)||['blob:','data:'].includes(u.protocol)?route.continue():route.abort()});await page.goto(${JSON.stringify(fixture.origin)});await page.getByRole('heading',{name:'保存恢复隔离合成界面（非原画布）',exact:true}).waitFor()`, '免填码打开候选界面');
  await title('基线版本'); await click('保存合成画布', '基线保存'); await code(saved, '基线真实ACK');
  check('真实React状态条只在SQLite ACK后显示已保存', (await stored())?.revision === 1 && (await stored())?.state.title === '基线版本');
  await code(`await page.evaluate(()=>window.__recoveryIds=[]);let drop=true;await page.route('**/documents/extension/*',async route=>{if(route.request().method()!=='PUT')return route.continue();const id=route.request().postDataJSON().operationId;await page.evaluate(id=>window.__recoveryIds.push(id),id);if(drop){drop=false;await route.fetch();return route.abort()}return route.continue()})`, '模拟已提交但ACK丢失');
  await title('ACK丢失的第一稿'); await click('保存合成画布', '提交后丢ACK'); await code(failed, '失败可见且禁止关闭提示');
  check('响应丢失时原请求已落盘但UI未谎报成功', (await stored())?.revision === 2 && (await stored())?.state.title === 'ACK丢失的第一稿');
  await title('失败后的新编辑'); await click('保存合成画布', '失败后继续编辑'); await code(failed, '新编辑仍保留本页');
  check('失败后新编辑尚未覆盖SQLite旧快照', (await stored())?.revision === 2);
  await run(['screenshot', '--filename', join(output, '保存失败与保留编辑.png')], '失败截图');
  await click('重试未确认保存', '点击原操作重试'); await code(`${saved}const ids=await page.evaluate(()=>window.__recoveryIds);if(ids.length!==3||ids[0]!==ids[1]||ids[1]===ids[2])throw Error('原操作ID未保持');if(await page.getByRole('alert').count())throw Error('恢复后仍有失败提示')`, '原操作重试后提交新编辑');
  check('原ID重试不重复提交，后续编辑收到ACK后才清除上下层失败状态', (await stored())?.revision === 3 && (await stored())?.state.title === '失败后的新编辑');
  await code("await page.unroute('**/documents/extension/*');await page.route('**/documents/extension/*',route=>route.request().method()==='PUT'?route.abort():route.continue())", '模拟提交前断线');
  await click('新增合成节点并保存', '断线新增第一个节点'); await code(failed, '断线失败可见');
  await click('新增合成节点并保存', '断线继续新增第二个节点'); await click('重试未确认保存', '断线时重试仍失败'); await code(failed, '失败不清除未保存记录');
  check('持续断线及失败重试不谎报成功、不覆盖原库', (await stored())?.revision === 3 && (await stored())?.state.nodes.length === 0);
  await code("await page.unroute('**/documents/extension/*')", '恢复网络'); await click('重试未确认保存', '连接恢复后重试'); await code(saved, '两次新编辑全部ACK');
  check('连接恢复后按顺序提交断线期间的两次编辑', (await stored())?.revision === 5 && (await stored())?.state.nodes.length === 2);
  await code(`await page.reload();await page.getByRole('heading',{name:'保存恢复隔离合成界面（非原画布）',exact:true}).waitFor();if(await page.getByLabel('合成画布名称').inputValue()!=='失败后的新编辑')throw Error('标题未恢复');await page.getByText('本页合成节点：2',{exact:true}).waitFor();if(await page.evaluate(()=>window.__recoveryStorageCalls.length))throw Error('调用浏览器库');if((await page.context().cookies()).length)throw Error('出现Cookie');if(await page.locator('meta[name=guan-local-bootstrap],input[type=password]').count())throw Error('仍有启动材料或填码')`, '新文档恢复已确认编辑');
  check('刷新直接恢复最终标题与两节点，无浏览器库/Cookie/授权注入', (await stored())?.revision === 5);
  const errors = await run(['console', 'error'], '控制台');
  check('除设计中的网络中断与空记录404外无React/CSP/未处理异常', !/Uncaught|Unhandled|TypeError|ReferenceError|Content Security Policy|Invalid hook/i.test(errors));
  await run(['screenshot', '--filename', join(output, '恢复保存并刷新.png')], '恢复截图'); passed = true;
} catch (error) { blocked.push({ boundary: '候选React状态条→保存桥→恢复协调→真实SQLite→ACK及刷新', reason: error.message }); process.exitCode = 1; }
finally {
  try { await run(['snapshot'], '最终快照'); await run(['console', 'error'], '最终错误'); await run(['screenshot', '--filename', join(output, '最终状态.png')], '最终截图'); } catch { /* 页面可能尚未启动。 */ }
  try { await run(['close'], '关闭本轮浏览器'); } catch { /* 不触碰其他浏览器。 */ }
  try { await fixture?.close(); } catch (error) { passed = false; blocked.push({ boundary: '正常关闭', reason: error.message }); process.exitCode = 1; }
  const report = { passed, results, blocked, output, syntheticDataRoot: fixture?.dataRoot, candidateOnly: true, application: '自有React合成界面及真实候选状态组件，不是原画布',
    authorizationRuntimeInjected: false, real3100Untouched: true, productionTakenOver: false, lockAbsent: fixture ? !existsSync(join(fixture.dataRoot, '.实例锁.json')) : null };
  writeFileSync(join(output, '验收结果.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2));
}
