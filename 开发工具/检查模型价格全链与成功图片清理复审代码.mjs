// 复审代码检查，来源 开发工具/检查模型价格全链与成功图片清理代码.mjs SHA256 b42e2a9341bde7ed46b5a0b40a6ffd669844249029e9ffe17f0a4c4c29a9b264；原件保持。
// 七文件完整预审，来源 开发工具/检查模型价格与成功图片清理代码.mjs SHA256 6292c37d8b2eeb9df380a8bd916af99f62557ac4eba27abededa4cf0b2130968；原件保持。
// 独立预审工具，来源 开发工具/检查状态通知与设置子层代码.mjs SHA256 1cb01560a90e2164004139ec91ccc949a8b95fa378811f00e0fb7baa8b0f286b；原件保持。
// 独立后继，原检查器 SHA256 bc793a7d3638339b626c338e81e1582e09c7911cea69b356cf09c83d2839191a；保留基线问题，只拒绝新增问题。
import { ESLint } from 'eslint';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import { 构建模型价格全链与成功图片清理复审候选 } from './预审模型价格全链与成功图片清理复审.mjs';
const 子层自有文件 = ['扩展功能/画布生成/图片任务确认恢复与清理.mjs', '开发工具/预审模型价格全链与成功图片清理.mjs', '开发工具/模型价格全链与成功图片清理.test.mjs', '开发工具/检查模型价格全链与成功图片清理代码.mjs', '开发工具/镜像虚拟构建模型价格全链与成功图片清理.mjs', '开发工具/模型价格类型检查.mjs', '开发工具/模型价格类型依赖只读镜像.mjs', '开发工具/模型价格构建依赖只读镜像.mjs', '扩展功能/配置文件/配置文件价格保留.ts', '开发工具/模型价格配置安全.test.mjs', '开发工具/预审模型价格与成功图片清理.mjs', '开发工具/模型价格与成功图片清理.test.mjs', '开发工具/预审模型价格全链与成功图片清理复审.mjs', '开发工具/模型价格复审依赖只读镜像.mjs', '开发工具/模型价格复审构建依赖镜像.mjs', '开发工具/模型价格复审模块闭环.test.mjs', '开发工具/镜像虚拟构建模型价格全链与成功图片清理复审.mjs', '开发工具/检查模型价格全链与成功图片清理复审代码.mjs', '开发工具/预审模型价格全链与成功图片清理.mjs'];

const eslint = new ESLint({ overrideConfigFile: true, overrideConfig: [
  { files: ['**/*.mjs'], ...js.configs.recommended, languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  ...tseslint.configs.recommended.map(config => ({ ...config, files: ['**/*.ts', '**/*.tsx'] })),
  { files: ['**/*.ts', '**/*.tsx'], languageOptions: { globals: globals.browser } },
  { files: ['**/*.tsx'], plugins: { 'react-hooks': reactHooks }, rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' } },
] });
const ownResults = await eslint.lintFiles(子层自有文件);
console.log(await (await eslint.loadFormatter('stylish')).format(ownResults));
const ownIssues = ownResults.reduce((sum, item) => sum + item.errorCount + item.warningCount, 0);
const preview = 构建模型价格全链与成功图片清理复审候选();
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
