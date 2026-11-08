import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';

const commands = {
  保护测试: ['--test', '开发工具/产品悬浮删除接入.test.mjs', '开发工具/产品悬浮删除.test.mjs', '开发工具/产品入口竞态接入.test.mjs'],
  代码检查: ['开发工具/检查产品悬浮删除代码.mjs'],
};
const label = process.argv[2], args = commands[label];
if (!args) throw Error('未知检查项目');
let output = '', failure;
try { const result = await promisify(execFile)(process.execPath, args, { cwd: 根目录, timeout: 180_000, maxBuffer: 12 * 1024 * 1024 }); output = result.stdout + result.stderr; }
catch (error) { output = (error.stdout ?? '') + (error.stderr ?? ''); failure = error; }
const path = join(根目录, '.运行/产品悬浮删除本轮' + label + '.log');
writeFileSync(path, output);
console.log(output.split('\n').filter(line => /^(✔|✖|ℹ|# tests|# pass|# fail|\{"文件数")/.test(line)).join('\n'));
console.log('完整日志：' + path);
if (failure) process.exitCode = 1;
