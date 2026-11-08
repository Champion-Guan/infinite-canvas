// 独立后继，迁自 开发工具/任务确认与设置边界浏览器命令.mjs SHA256 2fd6109a10112c780b9ca21274b9503b2b34c98b701b1e3bd966895ccdf86d7a；原件保留。
// 独立后继，原命令工具 SHA256 7185b0bfb226c3a29cd55460be8cc68e09f889c4e5fa96cdab90b6bd0a480b00；独立浏览器资料。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
const [label, ...args] = process.argv.slice(2);
if (!label || !/^[\p{L}\p{N}_-]+$/u.test(label) || !['open', 'goto', 'snapshot', 'click', 'fill', 'press', 'run-code', 'reload', 'resize', 'screenshot', 'console', 'requests', 'close', 'upload', 'dialog-accept', 'dialog-dismiss'].includes(args[0])) throw Error('无效隔离验收命令');
if (['open', 'goto'].includes(args[0]) && !/^http:\/\/localhost:\d+(\/|$)/.test(args[1])) throw Error('仅本机隔离地址');
const output = join(根目录, '.运行/output/playwright/状态通知与设置子层-20261020'); mkdirSync(output, { recursive: true });
writeFileSync(join(output, Date.now() + '-' + label + '-命令.json'), JSON.stringify({ label, args }, null, 2) + '\n', { flag: 'wx' });
let stdout, stderr, failure;
try { ({ stdout, stderr } = await promisify(execFile)(join(根目录, 'node_modules/.bin/playwright-cli'), ['--session', 'guan-status-layer-20261020', '--raw', ...args],
  { cwd: join(根目录, '.运行'), timeout: 55_000, maxBuffer: 8 * 1024 * 1024 })); }
catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failure = error; }
writeFileSync(join(output, Date.now() + '-' + label + '.log'), stdout + stderr, { flag: 'wx' }); process.stdout.write(stdout + stderr);
if (failure || /^(### Error\b|Error:)/m.test(stdout + stderr)) process.exitCode = 1;
