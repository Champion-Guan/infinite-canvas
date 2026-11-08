import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';

const [label, ...args] = process.argv.slice(2);
if (!label || !/^[\p{L}\p{N}_-]+$/u.test(label) || !['open', 'snapshot', 'click', 'fill', 'run-code', 'screenshot', 'console', 'requests', 'close'].includes(args[0])) throw Error('无效隔离浏览器命令');
if (args[0] === 'open' && !/^http:\/\/localhost:\d+\/$/.test(args[1])) throw Error('只允许本机隔离页面');
const output = join(根目录, '.运行/output/playwright/SQLite会话恢复-20261019');
mkdirSync(output, { recursive: true });
const { stdout, stderr } = await promisify(execFile)(join(根目录, 'node_modules/.bin/playwright-cli'), ['--session', 'guan-session-recovery-20261019', '--raw', ...args],
  { cwd: join(根目录, '.运行'), timeout: 55_000, maxBuffer: 4 * 1024 * 1024 });
writeFileSync(join(output, Date.now() + '-' + label + '.log'), stdout + stderr);
process.stdout.write(stdout + stderr);
if (/^(### Error\b|Error:)/m.test(stdout + stderr)) process.exitCode = 1;
