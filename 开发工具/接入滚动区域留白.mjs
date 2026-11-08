import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, rmSync, mkdtempSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = process.cwd(), mappingPath = resolve('上游适配/开发源码映射.json');
const require = createRequire(resolve('.运行/3100源/画布副本/web/package.json'));
const ts = require('typescript'), tool = resolve('开发工具/维护接入补丁.py');
const temporary = resolve('.运行/滚动区域留白接线.tsx');
const sha = data => createHash('sha256').update(data).digest('hex');
const changed = [];
function files(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(item =>
        item.isDirectory() ? files(join(directory, item.name)) : /\.tsx$/.test(item.name) ? [join(directory, item.name)] : []);
}
function transform(source) {
    const ast = ts.createSourceFile('scroll.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), edits = [];
    const visit = node => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
            const tag = node.tagName.getText(ast), field = tag === 'textarea' || tag.endsWith('.TextArea');
            const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.text === 'className');
            const text = attribute?.initializer?.getText(ast) || '';
            const vertical = /(?:^|[\s:"'`])overflow-(?:y-)?(?:auto|scroll)(?=[\s"'`}]|$)/.test(text);
            const horizontal = /overflow-x-(?:auto|scroll)(?=[\s"'`}]|$)/.test(text);
            const hidden = /(?:hide-scrollbar|scrollbar-none)/.test(text);
            const marker = field ? 'guan-scroll-field' : vertical ? 'guan-scroll-region' : horizontal && !hidden ? 'guan-scroll-horizontal' : '';
            if (marker && !text.includes(marker)) {
                if (attribute?.initializer) {
                    const replaced = ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression
                        ? `{${JSON.stringify(marker + ' ')} + (${attribute.initializer.expression.getText(ast)} || "")}`
                        : text.replace(/(["'`])/, `$1${marker} `);
                    if (replaced !== text) edits.push({ start: attribute.initializer.getStart(ast), end: attribute.initializer.end, text: replaced });
                } else if (!attribute) {
                    edits.push({ start: node.attributes.end, end: node.attributes.end, text: ` className="${marker}"` });
                }
            }
        }
        if (ts.isObjectLiteralExpression(node) && node.properties.some(property => ts.isPropertyAssignment(property) &&
            property.name.getText(ast).replace(/["']/g, '') === 'overflowY' && /["'](?:auto|scroll)["']/.test(property.initializer.getText(ast)))) {
            // 内联弹窗body/浮层样式也明确预留通道，不依赖运行时DOM扫描。
            const oldPadding = node.properties.find(property => ts.isPropertyAssignment(property) &&
                property.name.getText(ast) === 'paddingInlineEnd' && property.initializer.getText(ast) === '18');
            const compactPadding = node.properties.find(property => ts.isPropertyAssignment(property) &&
                property.name.getText(ast) === 'paddingInline' && ['6', '16', '32'].includes(property.initializer.getText(ast)));
            if (oldPadding) edits.push({ start: oldPadding.getStart(ast), end: oldPadding.end, text: 'paddingInline: 18' });
            else if (compactPadding) edits.push({ start: compactPadding.getStart(ast), end: compactPadding.end, text: 'paddingInline: 18' });
            else if (!node.properties.some(property => property.name?.getText(ast) === 'paddingInline'))
                edits.push({ start: node.properties.end, end: node.properties.end, text: `${source.slice(node.properties.pos, node.properties.end).trim().endsWith(',') ? '' : ','} paddingInline: 18` });
            const gutter = node.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(ast) === 'scrollbarGutter');
            if (!gutter) edits.push({ start: node.properties.pos, end: node.properties.pos, text: ' scrollbarGutter: "stable both-edges",' });
            else if (gutter.initializer?.getText(ast) === '"stable"')
                edits.push({ start: gutter.initializer.getStart(ast), end: gutter.initializer.end, text: '"stable both-edges"' });
        }
        ts.forEachChild(node, visit);
    };
    visit(ast);
    for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end))
        source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    const diagnostics = ts.createSourceFile('scroll.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics;
    if (diagnostics.length) throw Error(ts.flattenDiagnosticMessageText(diagnostics[0].messageText, '\n'));
    return source;
}
function run(args) {
    const result = spawnSync('python3', [tool, ...args], { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) throw Error(result.stderr || result.stdout);
}
const mapping = JSON.parse(readFileSync(mappingPath, 'utf8'));
const utility = '扩展功能/主题/滚动区域留白.css';
if (!mapping['文件'].some(item => item['来源'] === utility))
    mapping['文件'].push({ 来源: utility, 目标: '画布副本/web/src/' + utility, 原位置: '新增滚动区域留白规范', 类型: '前端', SHA256: sha(readFileSync(utility)) });
writeFileSync(mappingPath, JSON.stringify(mapping, null, 2) + '\n');
try {
    for (const file of files(resolve('扩展功能'))) {
        const source = readFileSync(file, 'utf8'), output = transform(source);
        if (source !== output) { writeFileSync(file, output); changed.push(relative(root, file)); }
    }
    let current = JSON.parse(readFileSync(mappingPath, 'utf8'));
    for (const item of current['文件']) if (changed.includes(item['来源']) || item['来源'] === '扩展功能/主题/界面动态偏好.tsx')
        item.SHA256 = sha(readFileSync(item['来源']));
    writeFileSync(mappingPath, JSON.stringify(current, null, 2) + '\n');
    const web = resolve('.运行/3100源/画布副本/web/src');
    const targets = [...files(join(web, 'components')), ...files(join(web, 'pages'))];
    let index = current['接入补丁'].filter(item => item['职责']?.startsWith('滚动区域留白接入')).length;
    if (process.argv.includes('--批量')) {
        const batch = mkdtempSync(resolve('.运行/滚动留白批量-'));
        try {
            const candidates = targets.filter(file => transform(readFileSync(file, 'utf8')) !== readFileSync(file, 'utf8'))
                .map(file => 'web/src/' + relative(web, file));
            const baseline = JSON.parse(readFileSync('上游基线.json', 'utf8'));
            for (const target of candidates) if (!current['接入差异'].some(item => item['目标'] === target)) {
                const original = spawnSync('git', ['show', baseline['提交'] + ':' + target], { cwd: resolve(baseline['目录']), maxBuffer: 10 * 1024 ** 2 });
                if (original.status !== 0) throw Error('无法读取作者基线：' + target);
                const hash = sha(original.stdout);
                current['接入差异'].push({ 目标: target, 基线SHA256: hash, 原SHA256: hash });
            }
            writeFileSync(mappingPath, JSON.stringify(current, null, 2) + '\n');
            const list = join(batch, '读取目标.json');
            writeFileSync(list, JSON.stringify(candidates));
            run(['批量提取', list, batch]);
            const plans = [];
            for (const target of candidates) {
                const file = join(batch, target), source = readFileSync(file, 'utf8'), output = transform(source);
                if (source === output) continue;
                writeFileSync(file, output);
                plans.push({ target, source: file, name: '滚动区域留白接入' + String(++index).padStart(2, '0') });
                changed.push(target);
            }
            const plan = join(batch, '接线计划.json');
            writeFileSync(plan, JSON.stringify(plans));
            run(['批量导出', plan]);
            console.log(JSON.stringify({ changedFiles: changed.length, files: changed }));
        } finally { rmSync(batch, { recursive: true, force: true }); }
        process.exitCode = 0;
    } else {
    for (const file of targets) {
        const target = 'web/src/' + relative(web, file);
        // 先检查是否需要接线，实际接线文本仍从补丁维护器提取。
        const probe = readFileSync(file, 'utf8');
        if (transform(probe) === probe) continue;
        current = JSON.parse(readFileSync(mappingPath, 'utf8'));
        if (!current['接入差异'].some(item => item['目标'] === target)) {
            const baseline = JSON.parse(readFileSync('上游基线.json', 'utf8'));
            const original = spawnSync('git', ['show', baseline['提交'] + ':' + target], { cwd: resolve(baseline['目录']), maxBuffer: 10 * 1024 ** 2 });
            if (original.status !== 0) throw Error('无法读取作者基线：' + target);
            const hash = sha(original.stdout);
            current['接入差异'].push({ 目标: target, 基线SHA256: hash, 原SHA256: hash });
            writeFileSync(mappingPath, JSON.stringify(current, null, 2) + '\n');
        }
        run(['提取', target, temporary]);
        const source = readFileSync(temporary, 'utf8'), output = transform(source);
        if (source === output) continue;
        writeFileSync(temporary, output);
        run(['导出', target, temporary, '滚动区域留白接入' + String(++index).padStart(2, '0')]);
        changed.push(target);
        console.log(target);
    }
    console.log(JSON.stringify({ changedFiles: changed.length, files: changed }));
    }
} finally { rmSync(temporary, { force: true }); }
