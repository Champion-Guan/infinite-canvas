import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import js from '@eslint/js';
import globals from 'globals';
import { 根目录 } from './公共.mjs';
import { 读取迁移扩大整批隔离记录 } from './接入迁移扩大整批隔离副本.mjs';

const record = process.argv[2];
if (process.argv.length !== 3 || !record) throw Error('必须指定67文件隔离记录');
const integration = 读取迁移扩大整批隔离记录(record);
const output = mkdtempSync(join(根目录, '.运行/output/迁移扩大整批接入验收-'));
const files = ['上游适配/迁移扩大整批批准.mjs', ...['接入迁移扩大整批隔离副本', '迁移扩大整批隔离保护.test', '迁移扩大整批磁盘闭环.test',
  '迁移扩大整批原工作台夹具', '迁移扩大整批浏览器命令', '网络代理隔离依赖', '构建依赖只读镜像', '执行迁移扩大整批接入验收'].map(name => '开发工具/' + name + '.mjs')];
const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [{ files: ['**/*.mjs'], ...js.configs.recommended, languageOptions: { globals: { ...globals.node, ...globals.browser } } }] });
const results = await eslint.lintFiles(files), lint = { files: results.length, errors: results.reduce((sum, item) => sum + item.errorCount, 0), warnings: results.reduce((sum, item) => sum + item.warningCount, 0) };
writeFileSync(join(output, '接入工具检查.log'), await (await eslint.loadFormatter('stylish')).format(results) + JSON.stringify(lint) + '\n', { flag: 'wx' });
if (lint.errors || lint.warnings) throw Error('接入工具代码检查未通过：' + output);
const chunks = [], began = Date.now();
const status = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--test', '--test-reporter=spec', '开发工具/迁移扩大整批磁盘闭环.test.mjs'], { cwd: 根目录, env: { ...process.env, GUAN_EXPAND_TEST_RECORD: record }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => chunks.push(chunk)); child.stderr.on('data', chunk => chunks.push(chunk));
  child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal }));
});
const log = Buffer.concat(chunks).toString('utf8'); writeFileSync(join(output, '磁盘闭环.log'), log, { flag: 'wx', mode: 0o600 });
if (status.code !== 0) { console.log(log.slice(-5000)); throw Error('磁盘验收未通过：' + output); }
读取迁移扩大整批隔离记录(record);
const report = { output, integration, lint, disk: { ...status, elapsedMs: Date.now() - began }, 浏览器验收: '单独归档，不由协议测试代替', 已切换3100: false };
writeFileSync(join(output, '验收报告.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
