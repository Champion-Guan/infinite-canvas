import { ESLint } from 'eslint';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import { 构建产品核心候选 } from './预审产品核心迁入.mjs';

const preview = 构建产品核心候选();
const baseRules = { ...tseslint.configs.recommended.flatMap(config => Object.entries(config.rules || {})).reduce((rules, [key, value]) => ({ ...rules, [key]: value }), {}),
  'no-undef': 'off', 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' };
const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [
  { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser, globals: { ...globals.browser, ...globals.node }, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { '@typescript-eslint': tseslint.plugin, 'react-hooks': reactHooks }, rules: baseRules },
  { files: ['**/*.mjs'], ...js.configs.recommended, languageOptions: { globals: { ...globals.node, ...globals.browser } } },
] });
const results = [];
for (const [path, item] of preview.delta) {
  if (!/\.tsx?$/.test(path)) continue;
  const after = (await eslint.lintText(item.产物, { filePath: path }))[0];
  if (item.原文 !== null) {
    const before = (await eslint.lintText(item.原文, { filePath: path }))[0];
    const inherited = new Map();
    for (const message of before.messages) {
      const key = JSON.stringify([message.ruleId, message.message]);
      inherited.set(key, (inherited.get(key) || 0) + 1);
    }
    after.messages = after.messages.filter(message => {
      const key = JSON.stringify([message.ruleId, message.message]), remaining = inherited.get(key) || 0;
      if (!remaining) return true;
      inherited.set(key, remaining - 1); return false;
    });
    after.errorCount = after.messages.filter(message => message.severity === 2).length;
    after.warningCount = after.messages.filter(message => message.severity === 1).length;
  }
  results.push(after);
}
results.push(...await eslint.lintFiles(['开发工具/预审产品核心迁入.mjs', '开发工具/产品核心迁入.test.mjs', '开发工具/检查产品核心迁入代码.mjs']));
console.log(await (await eslint.loadFormatter('stylish')).format(results));
const report = { 检查文件数: results.length, 新增错误: results.reduce((sum, item) => sum + item.errorCount, 0), 新增警告: results.reduce((sum, item) => sum + item.warningCount, 0), 说明: '自有模块全检，既有源码比较同规则前后差异；不掩盖全项目历史Lint债务' };
console.log(JSON.stringify(report));
if (report.新增错误 || report.新增警告) process.exitCode = 1;
