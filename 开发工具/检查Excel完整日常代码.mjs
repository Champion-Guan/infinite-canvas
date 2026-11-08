import { ESLint } from 'eslint';
import js from '@eslint/js';
import globals from 'globals';

const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [
  { files: ['**/*.mjs'], ...js.configs.recommended, languageOptions: { globals: { ...globals.node, ...globals.browser } } },
] });
const results = await eslint.lintFiles([
  '开发工具/Excel完整日常运行.mjs',
  '开发工具/Excel完整日常包.test.mjs',
  '开发工具/检查Excel完整日常代码.mjs',
]);
console.log(await (await eslint.loadFormatter('stylish')).format(results));
const report = { checkedFiles: results.length, errors: results.reduce((sum, item) => sum + item.errorCount, 0), warnings: results.reduce((sum, item) => sum + item.warningCount, 0) };
console.log(JSON.stringify(report));
if (report.errors || report.warnings) process.exitCode = 1;
