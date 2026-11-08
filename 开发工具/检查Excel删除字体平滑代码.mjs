import { ESLint } from 'eslint';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [
  { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser, globals: { ...globals.browser, ...globals.node }, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': reactHooks },
    rules: { ...Object.fromEntries(tseslint.configs.recommended.flatMap(config => Object.entries(config.rules || {}))),
      'no-undef': 'off', 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' } },
  { files: ['**/*.mjs'], ...js.configs.recommended, languageOptions: { globals: { ...globals.node, ...globals.browser } } },
] });
const results = await eslint.lintFiles([
  '扩展功能/Excel删除字体平滑/工作簿删除弹窗.tsx',
  '开发工具/预审Excel删除字体平滑.mjs',
  '开发工具/Excel删除字体平滑.test.mjs',
  '上游适配/Excel删除字体平滑批准.mjs',
  '开发工具/接入Excel删除字体平滑隔离副本.mjs',
  '开发工具/Excel删除字体平滑隔离保护.test.mjs',
  '开发工具/Excel删除平滑原工作台夹具.mjs',
  '开发工具/Excel删除平滑浏览器命令.mjs',
  '开发工具/检查Excel删除字体平滑代码.mjs',
  '开发工具/Excel删除字体平滑冷读检查.mjs',
]);
console.log(await (await eslint.loadFormatter('stylish')).format(results));
const report = { checkedFiles: results.length, errors: results.reduce((s, r) => s + r.errorCount, 0), warnings: results.reduce((s, r) => s + r.warningCount, 0) };
console.log(JSON.stringify(report)); if (report.errors || report.warnings) process.exitCode = 1;
