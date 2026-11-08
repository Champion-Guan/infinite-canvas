import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本 } from './检查运行副本.mjs';

const 状态 = 检查运行副本();
const 时间 = new Date().toISOString().replaceAll(':', '-');
const output = join(根目录, '.运行/output/阶段4', 时间);
const cwd = join(根目录, '.运行');
mkdirSync(output, { recursive: true });
const session = 'guan-stage4-' + Date.now();
const cli = join(根目录, 'node_modules/.bin/playwright-cli');
const 执行 = (args, 日志名) => new Promise(resolve => {
  const stream = createWriteStream(join(output, 日志名 + '.log'));
  const child = spawn(cli, ['--session', session, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(stream, { end: false });
  child.stderr.pipe(stream, { end: false });
  child.on('error', error => stream.write(error.message + '\n'));
  child.on('close', code => stream.end(() => resolve(code ?? -1)));
});
const modes = process.argv.includes('--仅功能') ? ['功能'] : process.argv.includes('--仅性能') ? ['性能'] : ['功能', '性能'];
const 总结 = { 时间, 基线, 运行副本: 状态, session, 结果: [] };
try {
  // 不使用默认 Chrome 资料；空白页先装阻断外部请求，再加载固定测试 Origin。
  if (await 执行(['open', 'about:blank', '--headed'], '打开浏览器') !== 0) throw Error('隔离测试浏览器未能打开。');
  for (const mode of modes) {
    console.log('正在运行浏览器' + mode + '基线；日志目录：' + output);
    const 文件 = mode === '功能' ? '浏览器功能基线.mjs' : '画布性能基线.mjs';
    const 全局 = mode === '功能' ? '__guanFunctionalBaseline' : '__guanPerformanceBaseline';
    const code = await 执行(['run-code', '--filename', join(根目录, '开发工具', 文件)], mode + '原始');
    const rawCode = await 执行(['--raw', 'eval', `JSON.stringify(window.${全局} ?? null)`], mode + '读取');
    let result = null;
    if (rawCode === 0) {
      try {
        // CLI 原始结果仍是 JSON 字符串封装；只解析，不执行输出内容。
        result = JSON.parse(JSON.parse(readFileSync(join(output, mode + '读取.log'), 'utf8')));
      } catch { /* 保留原始日志并报失败，绝不伪造结果。 */ }
    }
    writeFileSync(join(output, mode + '结果.json'), JSON.stringify(result, null, 2) + '\n');
    const passed = code === 0 && (mode === '功能'
      ? result?.results?.length === 11 && result.results.every(r => r.passed) && result.errors.length === 0
      : result?.samples?.length === 36 && result.samples.every(s => s.gestureVerified) && result.errors.length === 0);
    总结.结果.push({ 类型: mode, 退出码: code, 通过: Boolean(passed), 结果文件: join(output, mode + '结果.json') });
    await 执行(['snapshot'], mode + '结束快照');
    await 执行(['screenshot', '--filename', join(output, mode + '结束.png')], mode + '截图');
    if (!passed) break; // 第一个失败边界停下并保留现场；不跨过失败继续宣称通过。
  }
} catch (error) {
  总结.错误 = error.message;
} finally {
  await 执行(['close'], '关闭自有测试浏览器');
  总结.全部通过 = !总结.错误 && 总结.结果.length === modes.length && 总结.结果.every(r => r.通过);
  writeFileSync(join(output, '浏览器总结.json'), JSON.stringify(总结, null, 2) + '\n');
  检查运行副本();
  console.log(JSON.stringify(总结, null, 2));
  if (!总结.全部通过) process.exitCode = 1;
}
