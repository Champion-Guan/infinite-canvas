import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';

const [label, ...args] = process.argv.slice(2);
const allowed = ['snapshot', 'click', 'hover', 'run-code', 'reload', 'resize', 'screenshot', 'console', 'requests', 'close'];
if (!label || !/^[\p{L}\p{N}_-]+$/u.test(label) || !allowed.includes(args[0])) throw Error('本轮验收命令不符');
const output = join(根目录, '.运行/output/playwright/产品核心3100-20261019'); mkdirSync(output, { recursive: true });
let stdout, stderr, failure;
try { ({ stdout, stderr } = await promisify(execFile)(join(根目录, 'node_modules/.bin/playwright-cli'), ['--session', 'guan-product-daily-20261019', '--raw', ...args],
  { cwd: join(根目录, '.运行'), timeout: 55_000, maxBuffer: 8 * 1024 * 1024 })); }
catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; failure = error; }
writeFileSync(join(output, Date.now() + '-' + label + '.log'), stdout + stderr, { flag: 'wx', mode: 0o600 });
process.stdout.write(stdout + stderr);
if (failure || /^### Error\b/m.test(stdout + stderr)) process.exitCode = 1;
