import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SourceTextModule } from 'node:vm';
import { Linter } from 'eslint';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = execFileSync('rg', ['--files', '扩展功能', '开发工具'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
const reactFiles = files.filter(file => file.startsWith('扩展功能/') && /\.tsx?$/.test(file));
const javascriptFiles = files.filter(file => /\.(mjs|js)$/.test(file));
const linter = new Linter(), failures = [];
for (const file of reactFiles) {
    const messages = linter.verify(readFileSync(new URL(file, new URL('../', import.meta.url)), 'utf8'), [{
        files: ['**/*.{ts,tsx}'],
        languageOptions: { parser: ts.parser, parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } } },
        plugins: { 'react-hooks': hooks },
        rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error' },
    }], { filename: file });
    for (const message of messages) failures.push({ 文件: file, 行: message.line, 规则: message.ruleId, 说明: message.message });
}
for (const file of javascriptFiles) {
    try { new SourceTextModule(readFileSync(new URL(file, new URL('../', import.meta.url)), 'utf8'), { identifier: file }); }
    catch (error) { failures.push({ 文件: file, 说明: error.message }); }
}
console.log(JSON.stringify({ 自有React模块: reactFiles.length, JavaScript模块: javascriptFiles.length, 问题: failures }, null, 2));
if (failures.length) process.exitCode = 1;
