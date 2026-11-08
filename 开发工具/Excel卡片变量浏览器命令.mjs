import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';

const [label, ...args] = process.argv.slice(2);
const allowed = ['open', 'goto', 'snapshot', 'click', 'dblclick', 'fill', 'type', 'press', 'hover', 'drag', 'upload', 'run-code', 'reload', 'resize', 'screenshot', 'console', 'requests', 'close', 'dialog-dismiss', 'dialog-accept', 'check', 'uncheck', 'set-color-scheme', 'set-reduced-motion', 'tab-new', 'tab-select', 'tab-close', 'mousemove', 'mousedown', 'mouseup', 'mousewheel'];
if (!label || !/^[\p{L}\p{N}_-]+$/u.test(label) || !allowed.includes(args[0])) throw Error('无效验收命令');
if (['open', 'goto'].includes(args[0]) && !/^http:\/\/localhost:\d+(\/|$)/.test(args[1])) throw Error('仅本机隔离地址');
const output = join(根目录, '.运行/output/playwright/Excel卡片变量-20261019'); mkdirSync(output, { recursive: true });
let stdout, stderr, failure;
try { ({ stdout, stderr } = await promisify(execFile)(join(根目录, 'node_modules/.bin/playwright-cli'),
  ['--session', 'guan-excel-cards-20261019', '--raw', ...args], { cwd: join(根目录, '.运行'), timeout: 55_000, maxBuffer: 8 * 1024 * 1024 })); }
catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failure = error; }
writeFileSync(join(output, Date.now() + '-' + label + '.log'), stdout + stderr, { flag: 'wx' }); process.stdout.write(stdout + stderr);
if (failure || /^(### Error\b|Error:)/m.test(stdout + stderr)) process.exitCode = 1;
