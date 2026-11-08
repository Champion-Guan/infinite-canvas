import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本, 运行目录 } from './检查运行副本.mjs';

const 状态 = 检查运行副本();
const web = join(运行目录, 'web');
const 时间 = new Date().toISOString().replaceAll(':', '-');
const output = join(根目录, '.运行/output/阶段4', 时间);
mkdirSync(output, { recursive: true });
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
env.NODE_ENV = 'test';
// 直接使用锁定的官方平台包，保持所有依赖生命周期脚本禁用。
const require = createRequire(import.meta.url);
const bunRequire = createRequire(require.resolve('bun/package.json'));
const bunBinary = join(bunRequire.resolve('@oven/bun-darwin-aarch64/package.json'), '..', 'bin/bun');
const checks = [
  ['类型检查', process.execPath, [join(web, 'node_modules/typescript/bin/tsc'), '--noEmit']],
  ['Lint', process.execPath, [join(根目录, 'node_modules/eslint/bin/eslint.js'), '--config', join(根目录, '开发工具/代码检查配置.mjs'), 'src', '--format', 'json']],
  ['格式检查', process.execPath, [join(web, 'node_modules/prettier/bin/prettier.cjs'), '--check', 'src', 'tests']],
  ['原版单元测试', bunBinary, ['test', 'tests']],
  ['构建', process.execPath, [join(web, 'node_modules/vite/bin/vite.js'), 'build']],
];
if (process.argv.includes('--仅适配复验')) checks.splice(1, 3);
const results = [];
for (const [name, command, args] of checks) {
  console.log(`正在执行：${name}`);
  const logPath = join(output, name + '.log');
  const stream = createWriteStream(logPath);
  const start = performance.now();
  const code = await new Promise(resolve => {
    const child = spawn(command, args, { cwd: web, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(stream, { end: false });
    child.stderr.pipe(stream, { end: false });
    child.on('error', error => { stream.write(error.message + '\n'); });
    child.on('close', status => stream.end(() => resolve(status ?? -1)));
  });
  const result = { 检查: name, 退出码: code, 通过: code === 0, 毫秒: Math.round(performance.now() - start), 日志: logPath };
  if (name === 'Lint') {
    try {
      const lint = JSON.parse(readFileSync(logPath, 'utf8'));
      result.错误数 = lint.reduce((n, r) => n + r.errorCount, 0);
      result.警告数 = lint.reduce((n, r) => n + r.warningCount, 0);
    } catch { result.结果解析失败 = true; }
  }
  results.push(result);
  console.log(JSON.stringify(result));
}
const report = { 时间, 基线, 运行副本: 状态, Node: process.version, 检查: results, 全部通过: results.every(r => r.通过) };
writeFileSync(join(output, '质量结果.json'), JSON.stringify(report, null, 2) + '\n');
检查运行副本();
console.log('质量结果目录：' + output);
if (!report.全部通过) process.exitCode = 1;
