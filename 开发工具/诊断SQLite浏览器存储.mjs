import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { createSQLiteUIFixture } from './SQLite完整界面夹具.mjs';

// 只定位第三方启动代码的存储探测；不继续刷新/主题等已阻塞的完整验收。
const output = join(根目录, '.运行/output/playwright', 'SQLite存储探测-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
const fixture = await createSQLiteUIFixture(), session = 'guan-sqlite-probe-' + Date.now(), exec = promisify(execFile);
let sequence = 0;
async function run(args, label) {
  const { stdout, stderr } = await exec(join(根目录, 'node_modules/.bin/playwright-cli'), ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  writeFileSync(join(output, `${sequence++}-${label}.log`), stdout + stderr);
  if (/^### Error\b/m.test(stdout)) throw Error('诊断工具失败：' + label);
  return stdout;
}
try {
  await run(['open', 'about:blank', '--headed'], '独立资料'); await run(['snapshot'], '初始快照');
  const raw = await run(['run-code', `async page=>{
    await page.context().addInitScript({path:${JSON.stringify(fixture.bootstrap)}});
    await page.context().route('**/*',route=>{const u=new URL(route.request().url());return [${JSON.stringify(fixture.origin)},${JSON.stringify(fixture.dataURL)}].includes(u.origin)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort()});
    await page.goto(${JSON.stringify(fixture.origin)});
    await page.getByRole('banner',{name:'工作台顶栏'}).waitFor();
    return {completed:true,calls:await page.evaluate(()=>window.__browserPersistenceCalls)};
  }`], '首次启动存储堆栈');
  const probe = JSON.parse(raw);
  if (!probe.completed || !Array.isArray(probe.calls)) throw Error('诊断未完成');
  await run(['snapshot'], '启动后快照');
  await run(['console', 'error'], '控制台');
  const report = { ...probe, output, appBrowserStorageFree: probe.calls.length === 0, real3100Untouched: true, integration: fixture.integration };
  writeFileSync(join(output, '诊断结果.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  try { await run(['close'], '关闭独立资料'); } finally { await fixture.close(); }
}
