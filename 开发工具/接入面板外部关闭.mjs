import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = process.cwd(), mappingFile = resolve('上游适配/开发源码映射.json');
const require = createRequire(resolve('.运行/3100源/画布副本/web/package.json'));
const ts = require('typescript'), printer = ts.createPrinter();
const helper = resolve('开发工具/维护接入补丁.py'), sourceRoot = resolve('.运行/3100源/画布副本/web/src');
const modulePath = '@/扩展功能/主题/原生可关闭浮层';
const names = new Map([['Dropdown', 'OutsideDropdown'], ['Popover', 'OutsidePopover'], ['Select', 'OutsideSelect'], ['Modal', 'AppleModal'], ['Drawer', 'OutsideDrawer']]);
const sha = data => createHash('sha256').update(data).digest('hex');
function transform(source) {
    const ast = ts.createSourceFile('面板.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), edits = [];
    for (const statement of ast.statements) {
        if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== 'antd') continue;
        const clause = statement.importClause, binding = clause?.namedBindings;
        if (!binding || !ts.isNamedImports(binding)) continue;
        const replaced = binding.elements.filter(item => !item.isTypeOnly && names.has(item.propertyName?.text || item.name.text));
        if (!replaced.length) continue;
        const remaining = binding.elements.filter(item => !replaced.includes(item));
        const original = remaining.length || clause.name ? printer.printNode(ts.EmitHint.Unspecified,
            ts.factory.updateImportDeclaration(statement, statement.modifiers,
                ts.factory.updateImportClause(clause, clause.isTypeOnly, clause.name, remaining.length ? ts.factory.createNamedImports(remaining) : undefined),
                statement.moduleSpecifier, statement.attributes), ast) + '\n' : '';
        const modal = replaced.filter(item => (item.propertyName?.text || item.name.text) === 'Modal');
        const native = replaced.filter(item => !modal.includes(item));
        const imports = native.map(item => `${names.get(item.propertyName?.text || item.name.text)} as ${item.name.text}`).join(', ');
        edits.push({ start: statement.getStart(ast), end: statement.end, text: original
            + (native.length ? `import { ${imports} } from "${modulePath}";\n` : '')
            + (modal.length ? `import { AppleModal as ${modal[0].name.text} } from "@/扩展功能/主题/苹果弹窗";` : '') });
    }
    const visit = node => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'confirm'
            && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
            const object = node.arguments[0];
            if (!object.properties.some(item => item.name?.getText(ast) === 'maskClosable')) {
                const first = object.properties[0];
                if (first) {
                    const at = first.getStart(ast), indent = source.slice(source.lastIndexOf('\n', at) + 1, at);
                    edits.push({ start: at, end: at, text: `maskClosable: true,\n${indent}` });
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(ast);
    for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    return source;
}
function run(args) { execFileSync('python3', [helper, ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }); }
const mapping = JSON.parse(readFileSync(mappingFile, 'utf8'));
const baseline = JSON.parse(readFileSync('上游基线.json', 'utf8'));
const authorFiles = execFileSync('rg', ['--files', '--no-ignore', '-g', '*.tsx', sourceRoot], { encoding: 'utf8' }).trim().split('\n')
    .filter(file => !file.startsWith(join(sourceRoot, '扩展功能') + '/'));
const targets = authorFiles.filter(file => transform(readFileSync(file, 'utf8')) !== readFileSync(file, 'utf8'))
    .map(file => 'web/src/' + relative(sourceRoot, file));
for (const target of targets) if (!mapping.接入差异.some(item => item.目标 === target)) {
    const data = execFileSync('git', ['show', baseline.提交 + ':' + target], { cwd: resolve(baseline.目录) });
    mapping.接入差异.push({ 目标: target, 基线SHA256: sha(data), 原SHA256: sha(data) });
}
const changed = [];
for (const item of mapping.文件) if (item.来源.startsWith('扩展功能/') && item.来源.endsWith('.tsx')
    && !['/原生可关闭浮层.tsx', '/苹果弹窗.tsx'].some(name => item.来源.endsWith(name))) {
    const before = readFileSync(item.来源, 'utf8'), after = transform(before);
    if (before !== after) { writeFileSync(item.来源, after); changed.push(item.来源); }
}
const extras = ['扩展功能/主题/面板外部关闭.ts', '扩展功能/主题/原生可关闭浮层.tsx', '扩展功能/主题/苹果弹窗.tsx', '扩展功能/提示词/提示词优化窗口.tsx'];
for (const source of [...changed, ...extras]) {
    let item = mapping.文件.find(item => item.来源 === source);
    if (!item) {
        item = { 来源: source, 目标: '画布副本/web/src/' + source, 原位置: '.运行/3100源/画布副本/web/src/' + source, 类型: '前端' };
        mapping.文件.push(item);
    }
    item.SHA256 = sha(readFileSync(source));
}
writeFileSync(mappingFile, JSON.stringify(mapping, null, 2) + '\n');
const temp = mkdtempSync(resolve('.运行/面板外部关闭-'));
try {
    const list = join(temp, '提取目标.json'); writeFileSync(list, JSON.stringify(targets));
    run(['批量提取', list, temp]);
    const existing = mapping.接入补丁.filter(item => item.职责?.startsWith('面板外部关闭接入20261107-')).length;
    const plans = targets.map((target, index) => {
        const file = join(temp, target); writeFileSync(file, transform(readFileSync(file, 'utf8')));
        return { target, source: file, name: '面板外部关闭接入20261107-' + String(existing + index + 1).padStart(2, '0') };
    });
    const plan = join(temp, '接入计划.json'); writeFileSync(plan, JSON.stringify(plans));
    run(['批量导出', plan]);
    console.log(JSON.stringify({ 自有组件: changed, 作者组件: targets }, null, 2));
} finally { rmSync(temp, { recursive: true }); }
