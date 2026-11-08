import { ESLint } from 'eslint';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [
  { files: ['**/*.mjs'], ...js.configs.recommended, languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  ...tseslint.configs.recommended.map(config => ({ ...config, files: ['**/*.ts'] })),
  { files: ['**/*.ts'], languageOptions: { globals: globals.browser } },
] });
const results = await eslint.lintFiles(['扩展功能/配置文件/配置文件安全.ts', '开发工具/预审配置文件安全.mjs', '开发工具/配置文件安全.test.mjs', '开发工具/检查配置文件安全代码.mjs']);
console.log(await (await eslint.loadFormatter('stylish')).format(results));
const report = { files: results.length, errors: results.reduce((sum, item) => sum + item.errorCount, 0), warnings: results.reduce((sum, item) => sum + item.warningCount, 0) };
console.log(JSON.stringify(report)); if (report.errors || report.warnings) process.exitCode = 1;
