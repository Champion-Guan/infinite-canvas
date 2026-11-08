import { ESLint } from 'eslint';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import { 构建迁移扩大整批候选 } from './预审迁移扩大整批.mjs';

const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [
  { files: ['**/*.mjs', '**/*.js'], ...js.configs.recommended, languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  ...tseslint.configs.recommended.map(config => ({ ...config, files: ['**/*.ts', '**/*.tsx'] })),
  { files: ['**/*.ts', '**/*.tsx'], languageOptions: { globals: globals.browser }, rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  { files: ['**/*.tsx'], plugins: { 'react-hooks': reactHooks }, rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' } },
  { files: ['**/*.mjs', '**/*.js'], rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
] });
const ownFiles = ['开发工具/预审迁移扩大整批.mjs', '开发工具/迁移扩大整批.test.mjs', '开发工具/检查迁移扩大整批代码.mjs',
  ...['prompt-variable-highlight.js', 'prompt-theme-labels.js', 'media-download.ts'].map(name => '扩展功能/画布迁移扩展/' + name)];
const results = await eslint.lintFiles(ownFiles);
console.log(await (await eslint.loadFormatter('stylish')).format(results));
const ownIssues = results.reduce((sum, item) => sum + item.errorCount + item.warningCount, 0);
const preview = 构建迁移扩大整批候选();
function signatures(result, code) {
  const lines = code.split('\n'), signatures = new Map();
  for (const item of result.messages) {
    const key = JSON.stringify([item.ruleId, item.message, lines[item.line - 1]?.trim()]);
    signatures.set(key, (signatures.get(key) || 0) + 1);
  }
  return signatures;
}
let newIssues = 0; const report = [];
for (const [path, item] of preview.delta) {
  if (!/\.(?:mjs|js|ts|tsx)$/.test(path)) continue;
  const filePath = '审查内存/' + path;
  const before = item.原文 === null ? [] : await eslint.lintText(item.原文, { filePath });
  const [after] = await eslint.lintText(item.产物, { filePath });
  const prior = before.length ? signatures(before[0], item.原文) : new Map();
  const introduced = [];
  for (const [signature, count] of signatures(after, item.产物)) {
    const added = Math.max(0, count - (prior.get(signature) || 0));
    newIssues += added; if (added) introduced.push({ signature: JSON.parse(signature), count: added });
  }
  report.push({ file: path, inheritedIssues: before[0]?.messages.length || 0, candidateIssues: after.messages.length, introduced });
}
console.log(JSON.stringify({ ownFiles: results.length, ownIssues, candidateFiles: preview.delta.size, checkedCodeFiles: report.length, newIssues, report }, null, 2));
if (ownIssues || newIssues) process.exitCode = 1;
