import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript'), module = { exports: {} };
const code = ts.transpileModule(readFileSync(new URL('../扩展功能/Excel画布/平台规则全局状态.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function('module', 'exports', code)(module, module.exports);
export const platformState = module.exports;
