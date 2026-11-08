import { ESLint } from 'eslint';
import js from '@eslint/js';
import globals from 'globals';

const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [{ files: ['**/*.mjs'], ...js.configs.recommended, languageOptions: { globals: { ...globals.node, ...globals.browser } } }] });
const results = await eslint.lintFiles([
  '扩展功能/生成网关/*.mjs', '扩展功能/生成任务/*.mjs',
  '开发工具/生成网关隔离夹具.mjs', '开发工具/生成网关.test.mjs', '开发工具/SQLite生成任务.test.mjs',
  '开发工具/生成HTTP闭环.test.mjs', '开发工具/画布保存核验.test.mjs',
  '开发工具/预审凭据网关任务端口.mjs', '开发工具/检查凭据网关代码.mjs',
  '开发工具/凭据网关候选预审.test.mjs',
  '开发工具/执行凭据网关预审.mjs',
]);
console.log(await (await eslint.loadFormatter('stylish')).format(results));
const report = { checkedFiles: results.length, errors: results.reduce((s, r) => s + r.errorCount, 0), warnings: results.reduce((s, r) => s + r.warningCount, 0) };
console.log(JSON.stringify(report)); if (report.errors || report.warnings) process.exitCode = 1;
