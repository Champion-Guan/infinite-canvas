import { ESLint } from 'eslint';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import { 构建产品恢复挂载复审候选 } from './复审产品恢复挂载竞态.mjs';

const preview = 构建产品恢复挂载复审候选();
const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [
  { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser, globals: { ...globals.browser, ...globals.node }, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': reactHooks }, rules: {
      ...Object.fromEntries(tseslint.configs.recommended.flatMap(config => Object.entries(config.rules || {}))),
      'no-undef': 'off', 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error',
    } },
  { files: ['**/*.mjs'], ...js.configs.recommended, languageOptions: { globals: { ...globals.node, ...globals.browser } } },
] });
const results = [];
for (const [path, item] of preview.delta) {
  const after = (await eslint.lintText(item.产物, { filePath: path }))[0], inherited = new Map();
  if (item.原文 !== null) for (const message of (await eslint.lintText(item.原文, { filePath: path }))[0].messages) {
    const key = JSON.stringify([message.ruleId, message.message]); inherited.set(key, (inherited.get(key) || 0) + 1);
  }
  after.messages = after.messages.filter(message => {
    const key = JSON.stringify([message.ruleId, message.message]), count = inherited.get(key) || 0;
    if (!count) return true; inherited.set(key, count - 1); return false;
  });
  after.errorCount = after.messages.filter(message => message.severity === 2).length;
  after.warningCount = after.messages.filter(message => message.severity === 1).length;
  results.push(after);
}
results.push(...await eslint.lintFiles(['开发工具/预审产品恢复挂载竞态.mjs', '开发工具/复审产品恢复挂载竞态.mjs', '开发工具/产品恢复挂载竞态预审.test.mjs', '开发工具/检查产品恢复挂载代码.mjs', '开发工具/记录产品恢复挂载审查.mjs']));
console.log(await (await eslint.loadFormatter('stylish')).format(results));
const report = { 文件数: results.length, 新增错误: results.reduce((sum, row) => sum + row.errorCount, 0), 新增警告: results.reduce((sum, row) => sum + row.warningCount, 0) };
console.log(JSON.stringify(report)); if (report.新增错误 || report.新增警告) process.exitCode = 1;
