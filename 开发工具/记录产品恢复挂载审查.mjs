import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';

const commands = {
  逻辑与保护: ['--test', '开发工具/产品恢复挂载竞态预审.test.mjs', '开发工具/产品悬浮删除.test.mjs', '开发工具/产品悬浮删除接入.test.mjs', '开发工具/产品入口竞态接入.test.mjs'],
  代码: ['开发工具/检查产品恢复挂载代码.mjs'],
  类型: ['--input-type=module', '-e', 'import {构建产品恢复挂载复审候选} from "./开发工具/复审产品恢复挂载竞态.mjs"; import {预审产品恢复挂载类型} from "./开发工具/预审产品恢复挂载竞态.mjs"; 预审产品恢复挂载类型(构建产品恢复挂载复审候选()); console.log("完整虚拟候选TypeScript通过，未写运行副本。");'],
};
const label = process.argv[2], args = commands[label];
if (!args) throw Error('未知预审检查');
let output, failed;
try { const result = await promisify(execFile)(process.execPath, args, { cwd: 根目录, timeout: 180_000, maxBuffer: 12 * 1024 * 1024 }); output = result.stdout + result.stderr; }
catch (error) { output = (error.stdout ?? '') + (error.stderr ?? ''); failed = error; }
const path = join(根目录, '.运行/产品恢复挂载三文件复审-' + label + '.log');
writeFileSync(path, output);
console.log(output.split('\n').filter(line => /^(✔|✖|ℹ|完整虚拟|\{"文件数")/.test(line)).join('\n'));
console.log('完整日志：' + path);
if (failed) process.exitCode = 1;
