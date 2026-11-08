import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ts, 生成审查差异 } from './检查首批功能适配.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 根目录 } from './公共.mjs';
import { 构建模型价格全链与成功图片清理复审候选 } from './预审模型价格全链与成功图片清理复审.mjs';

const preview = 构建模型价格全链与成功图片清理复审候选();
test('复审七文件全部本地静态导入闭合，保留设置视区和生成请求出口', () => {
  const root = preview.integration.组合包, src = join(root, '画布副本/web/src');
  for (const [path, item] of preview.delta) {
    const parsed = ts.createSourceFile(path, item.产物, ts.ScriptTarget.Latest, true, path.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const node of parsed.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) continue;
      const specifier = node.moduleSpecifier.text;
      if (!specifier.startsWith('@/') && !specifier.startsWith('.')) continue;
      const base = specifier.startsWith('@/') ? resolve(src, specifier.slice(2)) : resolve(dirname(join(root, path)), specifier);
      assert.ok(base.startsWith(src + '/'));
      const matches = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx'].filter(suffix => {
        const file = base + suffix; return preview.delta.has(relative(root, file)) || existsSync(file) && statSync(file).isFile();
      });
      assert.ok(matches.length, path + ' -> ' + specifier);
    }
  }
  const read = path => preview.delta.get('画布副本/web/src/' + path);
  assert.match(read('components/layout/model-select-modal.tsx').产物, /62cqh/);
  assert.match(read('components/layout/channel-editor-drawer.tsx').产物, /getContainer=\{viewport \?\? undefined\}/);
  const generationBody = code => code.slice(code.indexOf('    const recordImageGatewayTask'), code.indexOf('    const addGenerationConfigsForPromptNodes'));
  assert.equal(generationBody(read('pages/canvas/project.tsx').产物), generationBody(read('pages/canvas/project.tsx').原文));
});
test('实际复审模块可从原SQLite协议加载，身份检查和成功清理保持', async () => {
  const path = '画布副本/web/src/guan/generation/图片任务确认恢复.mjs', item = preview.delta.get(path);
  const code = item.产物.replace(/from (['"])(\.[^'"]+)\1/g, (_match, _quote, specifier) => 'from ' + JSON.stringify(pathToFileURL(resolve(dirname(join(preview.integration.组合包, path)), specifier)).href));
  const api = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  const target = { id: 'aaaaaaaa-1111-4444-8888-000000000001', productId: 'product', nodeId: 'image', responseHash: 'a'.repeat(64) };
  const nodes = [{ id: 'image', type: 'image', metadata: { gatewayGenerationTasks: [{ taskId: target.id, slotId: 'slot' }], gatewayGenerationReceipts: [{ taskId: target.id, responseHash: target.responseHash }], images: [{ id: 'slot', status: 'success', storageKey: 'image:synthetic', content: 'blob:synthetic', errorDetails: '原保存未确认' }] } }];
  assert.equal(api.clearConfirmedImageErrors(nodes, target)[0].metadata.images[0].errorDetails, undefined);
  assert.throws(() => api.imageConfirmationTargets('product', [...nodes, ...nodes]), error => error.code === 'generation_receipt_ambiguous');
});
test('实际复审产物匹配冻结清单、差异及全部自有来源', () => {
  const manifest = JSON.parse(readFileSync(join(根目录, '上游适配/待审查/模型价格全链与成功图片清理复审.json')));
  assert.equal(preview.delta.size, 7); assert.equal(哈希(生成审查差异(preview.delta)), manifest.差异SHA256);
  for (const item of manifest.文件) assert.equal(哈希(preview.delta.get(item.文件).产物), item.候选SHA256);
  for (const item of manifest.自有来源与工具) assert.equal(哈希(readFileSync(join(根目录, item.文件))), item.SHA256);
});
