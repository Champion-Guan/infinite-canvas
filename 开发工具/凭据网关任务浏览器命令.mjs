import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
const [label, ...args] = process.argv.slice(2);
if (!label || !/^[\p{L}\p{N}_-]+$/u.test(label) || !['open', 'goto', 'snapshot', 'click', 'fill', 'press', 'run-code', 'reload', 'resize', 'screenshot', 'console', 'requests', 'close', 'dialog-accept', 'dialog-dismiss'].includes(args[0])) throw Error('无效隔离验收命令');
if (['open', 'goto'].includes(args[0]) && !/^http:\/\/localhost:\d+(\/|$)/.test(args[1])) throw Error('仅本机隔离地址');
const output = join(根目录, '.运行/output/playwright/凭据网关任务-20261020'); mkdirSync(output, { recursive: true });
let stdout, stderr, failure;
try { ({ stdout, stderr } = await promisify(execFile)(join(根目录, 'node_modules/.bin/playwright-cli'), ['--session', 'guan-gateway-task-20261020', '--raw', ...args],
  { cwd: join(根目录, '.运行'), timeout: 55_000, maxBuffer: 8 * 1024 * 1024 })); }
catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failure = error; }
writeFileSync(join(output, Date.now() + '-' + label + '.log'), stdout + stderr, { flag: 'wx' }); process.stdout.write(stdout + stderr);
if (failure || /^(### Error\b|Error:)/m.test(stdout + stderr)) process.exitCode = 1;
