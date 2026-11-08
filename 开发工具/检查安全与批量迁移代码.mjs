import { ESLint } from 'eslint';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import { 构建安全与批量候选 } from './预审安全与批量迁移.mjs';

const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [
  { files: ['**/*.mjs'], ...js.configs.recommended, languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  ...tseslint.configs.recommended.map(config => ({ ...config, files: ['**/*.ts', '**/*.tsx'] })),
  { files: ['**/*.ts', '**/*.tsx'], languageOptions: { globals: globals.browser }, rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
  { files: ['**/*.tsx'], plugins: { 'react-hooks': reactHooks }, rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' } },
  { files: ['**/*.mjs'], rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
] });
const files = ['开发工具/预审安全与批量迁移.mjs', '开发工具/类型依赖只读镜像.mjs', '开发工具/安全与批量迁移.test.mjs', '开发工具/检查安全与批量迁移代码.mjs',
  '开发工具/预审配置文件安全.mjs', '开发工具/配置文件安全.test.mjs', '开发工具/检查配置文件安全代码.mjs', '扩展功能/配置文件/配置文件安全.ts',
  ...['recovery-read-gate.ts', 'persistence-checkpoint.ts', 'update-activity.ts', 'settle-activity-group.ts', 'prompt-generation-mode.ts'].map(name => '扩展功能/安全与批量/' + name)];
const results = await eslint.lintFiles(files);
console.log(await (await eslint.loadFormatter('stylish')).format(results));
const ownErrors = results.reduce((sum, item) => sum + item.errorCount + item.warningCount, 0);
const preview = 构建安全与批量候选();
const report = [];
function signatures(result, code) {
  const lines = code.split('\n'), signatures = new Map();
  for (const item of result.messages) {
    const key = JSON.stringify([item.ruleId, item.message, lines[item.line - 1]?.trim()]);
    signatures.set(key, (signatures.get(key) || 0) + 1);
  }
  return signatures;
}
let newIssues = 0;
for (const [path, item] of preview.delta) {
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
console.log(JSON.stringify({ ownFiles: results.length, ownErrorsOrWarnings: ownErrors, candidateFiles: preview.delta.size, newIssues, report }, null, 2));
if (ownErrors || newIssues) process.exitCode = 1;
