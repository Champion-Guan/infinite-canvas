import { ESLint } from 'eslint';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import { 确认边界自有文件, 构建任务确认与设置边界候选 } from './预审任务确认与设置边界.mjs';

const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [
  { files: ['**/*.mjs'], ...js.configs.recommended, languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  ...tseslint.configs.recommended.map(config => ({ ...config, files: ['**/*.ts', '**/*.tsx'] })),
  { files: ['**/*.ts', '**/*.tsx'], languageOptions: { globals: globals.browser } },
  { files: ['**/*.tsx'], plugins: { 'react-hooks': reactHooks }, rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' } },
] });
const ownResults = await eslint.lintFiles(确认边界自有文件);
console.log(await (await eslint.loadFormatter('stylish')).format(ownResults));
const ownIssues = ownResults.reduce((sum, item) => sum + item.errorCount + item.warningCount, 0);
const preview = 构建任务确认与设置边界候选();
function signatures(result, code) {
  const lines = code.split('\n'), found = new Map();
  for (const item of result?.messages || []) {
    const key = JSON.stringify([item.ruleId, item.message, lines[item.line - 1]?.trim()]);
    found.set(key, (found.get(key) || 0) + 1);
  }
  return found;
}
let introduced = 0; const files = [];
for (const [path, item] of preview.delta) {
  const filePath = '审查内存/' + path;
  const [before] = item.原文 === null ? [] : await eslint.lintText(item.原文, { filePath });
  const [after] = await eslint.lintText(item.产物, { filePath });
  const prior = signatures(before, item.原文 || ''), added = [];
  for (const [signature, count] of signatures(after, item.产物)) {
    const difference = Math.max(0, count - (prior.get(signature) || 0));
    introduced += difference; if (difference) added.push({ signature: JSON.parse(signature), count: difference });
  }
  files.push({ path, inheritedIssues: before?.messages.length || 0, introduced: added });
}
console.log(JSON.stringify({ ownFiles: ownResults.length, ownIssues, candidateFiles: files.length, introduced, files }, null, 2));
if (ownIssues || introduced) process.exitCode = 1;
