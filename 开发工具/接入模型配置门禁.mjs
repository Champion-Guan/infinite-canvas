import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd(), file = resolve('上游适配/开发源码映射.json');
const ts = createRequire(resolve('.运行/3100源/画布副本/web/package.json'))('typescript');
const targets = [
    'web/src/pages/canvas/project.tsx', 'web/src/pages/canvas/hooks/use-plugin-host.tsx',
    'web/src/pages/image/index.tsx', 'web/src/pages/video/index.tsx', 'web/src/components/model-picker.tsx',
    'web/src/services/api/image.ts', 'web/src/services/api/video.ts', 'web/src/services/api/audio.ts',
];
const gate = '@/扩展功能/产品配置/模型配置门禁';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const temporary = mkdtempSync(resolve('.运行/模型门禁接线-'));
const run = args => {
    const result = spawnSync('python3', [resolve('开发工具/维护接入补丁.py'), ...args], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 ** 2 });
    if (result.status !== 0) throw Error(result.stderr || result.stdout);
};
function enclosingName(node) {
    while (node) {
        if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
        node = node.parent;
    }
    return '';
}
function transform(target, source) {
    const ast = ts.createSourceFile(target, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), edits = [];
    const imports = new Set();
    let changed = 0;
    const add = (start, end, text) => edits.push({ start, end, text });
    const constantCapability = target.includes('/pages/image/') ? '"image"' : target.includes('/pages/video/') ? '"video"' : undefined;
    const visit = node => {
        if (ts.isIfStatement(node) && /isAiConfigReady/.test(node.expression.getText(ast)) && !target.includes('use-plugin-host')) {
            let call;
            const find = value => { if (ts.isCallExpression(value) && value.expression.getText(ast).endsWith('isAiConfigReady')) call = value; ts.forEachChild(value, find); };
            find(node.expression);
            if (call?.arguments.length === 2) {
                const name = enclosingName(node);
                const capability = constantCapability || ({ pollVideoNodeTask: '"video"', maskEditImageNode: '"image"',
                    generateAngleNode: '"image"', executeGenerateNode: 'mode',
                    handleRetryNode: 'node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image"' })[name];
                if (!capability) throw Error('未识别模型调用入口：' + target + ':' + name);
                imports.add('ensureModelConfigured');
                add(call.getStart(ast), call.end, `ensureModelConfigured(${call.arguments[0].getText(ast)}, ${capability}, ${call.arguments[1].getText(ast)})`);
                const clean = child => {
                    if (ts.isExpressionStatement(child) && /^(?:openConfigDialog\(|message\.warning\(t\("workbench\.configFirst")/.test(child.expression.getText(ast)))
                        add(child.getStart(ast), child.end, '');
                    else ts.forEachChild(child, clean);
                };
                clean(node.thenStatement); changed++;
            }
        }
        if (target.includes('use-plugin-host') && ts.isVariableDeclaration(node) && node.name.getText(ast) === 'ensureReady') {
            imports.add('requireModelConfigured');
            add(node.initializer.getStart(ast), node.initializer.end,
                '(config: AiConfig) => requireModelConfigured(config, config.fallbackCapability || "text")');
            changed++;
        }
        if (target.endsWith('/model-picker.tsx') && ts.isIfStatement(node) &&
            node.expression.getText(ast).includes('!options.length') && node.thenStatement.getText(ast).includes('onMissingConfig')) {
            imports.add('showMissingModelConfiguration');
            add(node.getStart(ast), node.end, 'if (nextOpen && !options.length) { showMissingModelConfiguration(capability || "image"); setOpen(false); return; }');
            changed++;
        }
        if (ts.isFunctionDeclaration(node) && node.name && target.includes('/services/api/')) {
            const capabilities = { requestGeneration: 'image', requestEdit: 'image', requestImageQuestion: 'text',
                requestAudioGeneration: 'audio', createVideoGenerationTask: 'video', pollVideoGenerationTask: 'video' };
            const capability = capabilities[node.name.text];
            if (capability && node.body) {
                imports.add('requireModelConfigured');
                const model = node.name.text === 'pollVideoGenerationTask' ? 'task.model' : `config.model || config.${capability === 'image' ? 'image' : capability}Model`;
                add(node.body.getStart(ast) + 1, node.body.getStart(ast) + 1,
                    `\n    requireModelConfigured(config, "${capability}", ${model});`);
                changed++;
            }
        }
        if (target.endsWith('/project.tsx') && ts.isVariableDeclaration(node) && node.name.getText(ast) === 'createImageReversePromptNodes') {
            let callback;
            if (ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0];
            if (callback && ts.isArrowFunction(callback) && ts.isBlock(callback.body)) {
                imports.add('ensureModelConfigured');
                const first = callback.body.statements[0];
                add(first.end, first.end, '\n            if (!ensureModelConfigured(buildGenerationConfig(effectiveConfig, undefined, "text"), "text")) return;');
                changed++;
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(ast);
    if (!changed) throw Error('没有发现需要接线的模型入口：' + target);
    for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
    source = `import { ${[...imports].join(', ')} } from "${gate}";\n` + source;
    const errors = ts.createSourceFile(target, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics;
    if (errors.length) throw Error(ts.flattenDiagnosticMessageText(errors[0].messageText, '\n'));
    return { source, changed };
}
try {
    const map = JSON.parse(readFileSync(file, 'utf8')), baseline = JSON.parse(readFileSync('上游基线.json', 'utf8'));
    for (const target of targets) if (!map['接入差异'].some(item => item['目标'] === target)) {
        const original = spawnSync('git', ['show', baseline['提交'] + ':' + target], { cwd: resolve(baseline['目录']), maxBuffer: 10 * 1024 ** 2 });
        if (original.status !== 0) throw Error('作者基线缺少文件：' + target);
        map['接入差异'].push({ 目标: target, 基线SHA256: hash(original.stdout), 原SHA256: hash(original.stdout) });
    }
    const sources = [
        '扩展功能/产品配置/模型配置门禁.ts', '扩展功能/产品配置/模型配置通知.ts', '扩展功能/存储界面/模型配置提示.tsx',
        '扩展功能/存储界面/SQLite应用入口.tsx', '扩展功能/提示词/提示词优化请求.ts', '扩展功能/提示词/提示词优化窗口.tsx',
        '扩展功能/Excel画布/商品策划请求.ts', '扩展功能/Excel画布/产品主图去背景.ts', '扩展功能/画布生成/提示词翻译操作.ts',
        '扩展功能/画布生成/批量生成操作.ts', '扩展功能/画布生成/原画布文本调用.ts',
        '扩展功能/画布生成/原画布图片调用.ts', '扩展功能/画布生成/原画布音频调用.ts',
    ];
    for (const source of sources) {
        let entry = map['文件'].find(item => item['来源'] === source);
        if (!entry) { entry = { 来源: source, 目标: '画布副本/web/src/' + source, 原位置: '统一模型配置门禁', 类型: '前端' }; map['文件'].push(entry); }
        entry.SHA256 = hash(readFileSync(source));
    }
    writeFileSync(file, JSON.stringify(map, null, 2) + '\n');
    const list = join(temporary, '目标.json'); writeFileSync(list, JSON.stringify(targets));
    run(['批量提取', list, temporary]);
    const plans = [];
    for (const [index, target] of targets.entries()) {
        const source = join(temporary, target), result = transform(target, readFileSync(source, 'utf8'));
        writeFileSync(source, result.source);
        plans.push({ target, source, name: '统一模型配置门禁接入' + String(index + 1).padStart(2, '0') });
        console.log(JSON.stringify({ target, entryPoints: result.changed }));
    }
    const plan = join(temporary, '接线.json'); writeFileSync(plan, JSON.stringify(plans));
    run(['批量导出', plan]);
} finally { rmSync(temporary, { recursive: true, force: true }); }
