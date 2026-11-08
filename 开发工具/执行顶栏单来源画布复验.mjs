import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';
import { 安装模块取证 } from './浏览器模块取证.mjs';
if (!检查运行副本().顶栏单来源已应用) throw Error('本批尚未接入');
// 复用已实际验收的音视频/节点信息/画布操作，不改历史脚本；来源新边界另由专门浏览器用例验收。
let source = readFileSync(join(根目录, '开发工具/浏览器合并恢复验收.mjs'), 'utf8');
function replaceBetween(start, end, replacement) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0 || source.indexOf(start, a + start.length) >= 0) throw Error('历史验收锚点不唯一');
  source = source.slice(0, a) + replacement + source.slice(b);
}
replaceBetween("  await test('三态主题保留；", '  const fixture =', `  await test('主题区块关闭但四类默认模型与音视频参数仍在', async () => {
    await openSettings(); await settings().getByRole('tab', { name: '偏好设置', exact: true }).click();
    const labels = await page.evaluate(async () => {
      const i18n = (await window.__guanImport('/src/i18n/index.ts')).default;
      return ['videoResolution', 'audioVoice', 'audioFormat', 'audioSpeed', 'audioInstructions'].map(key => i18n.t('config.preferences.' + key));
    });
    for (const label of labels) await settings().getByText(label, { exact: true }).first().waitFor();
    check(await settings().getByText('界面主题', { exact: true }).count() === 0, '主题区块未关闭');
    await capture('深色参数回归'); await closeSettings(); return { labels };
  });\n\n`);
replaceBetween("  await openSettings(); await settings().getByRole('tab', { name: '提示词来源', exact: true }).click(); await snapshot();\n  const sourceRow", "  await test('已有媒体仍可解码播放", '');
replaceBetween("  await test('来源删除真实生效", '  report.passed = true;', `  await test('画布内主题入口关闭，设置窄屏可关闭，无未处理异常或未声明外网', async () => {
    const extraThemeButtons = page.getByRole('button', { name: /切换浅色主题|切换深色主题/ });
    check(await extraThemeButtons.count() === 1, '存在顶栏之外主题入口');
    await page.setViewportSize({ width: 390, height: 844 }); await openSettings(); await capture('窄屏画布设置回归'); await closeSettings();
    check(report.errors.length === 0 && report.unexpectedRequests.length === 0, '异常或未知外网：' + JSON.stringify(report));
    return { themeButtons: 1, errors: 0, unexpectedRequests: 0 };
  });\n`);
const output = join(根目录, '.运行/output/playwright', '顶栏单来源画布复验-' + new Date().toISOString().replaceAll(':', '-'));
mkdirSync(output, { recursive: true });
source = source.replaceAll('__ARTIFACT_DIR__', output).replace('async (page) => {', `async (page) => {\nawait (${安装模块取证.toString()})(page);`);
writeFileSync(join(output, '验收.mjs'), source);
const cli = join(根目录, 'node_modules/.bin/playwright-cli'), session = 'guan-single-canvas-' + Date.now();
const run = (args, name, timeout = 60000) => {
  const value = spawnSync(cli, ['--session', session, '--raw', ...args], { cwd: join(根目录, '.运行'), encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(join(output, name + '.log'), (value.stdout || '') + (value.stderr || ''));
  if (value.status !== 0) throw Error(name + '失败：' + (value.error?.message ?? value.status)); return value.stdout.trim();
};
let report;
try {
  run(['open', 'about:blank', '--headed'], '启动'); run(['snapshot'], '初始快照'); run(['run-code', '--filename', join(output, '验收.mjs')], '执行', 240000);
  report = JSON.parse(JSON.parse(run(['eval', 'JSON.stringify(window.__guanRestoredAcceptance ?? null)'], '读回')));
  if (!report?.passed || report.results.some(item => !item.passed)) throw Error('画布复验未通过');
} catch (error) {
  try { report = JSON.parse(JSON.parse(run(['eval', 'JSON.stringify(window.__guanRestoredAcceptance ?? null)'], '失败读回'))); } catch { /* 原始日志保留。 */ }
  report = { ...report, passed: false, failure: error.message }; process.exitCode = 1;
} finally {
  try { run(['snapshot'], '最终快照'); run(['screenshot', '--filename', join(output, '最终截图.png')], '截图'); run(['console', 'error'], '控制台'); } finally { run(['close'], '关闭自有浏览器'); }
  writeFileSync(join(output, '验收结果.json'), JSON.stringify({ ...report, session }, null, 2) + '\n'); console.log(JSON.stringify({ output, ...report }, null, 2));
}
