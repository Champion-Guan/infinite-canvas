import test from 'node:test';
import assert from 'node:assert/strict';
import { 构建删除视觉候选 } from './预审Excel删除视觉继承.mjs';
import { ts } from './检查首批功能适配.mjs';

const preview = 构建删除视觉候选();
const [[path, item]] = preview.delta;
test('只有工作簿删除弹窗一文件，不改共享弹窗和作者代码', () => {
  assert.equal(preview.delta.size, 1);
  assert.equal(path, 'web/src/guan/工作簿删除弹窗.tsx');
});
test('旧按钮16px/24px与字体族只在本弹窗显式恢复', () => {
  assert.match(item.产物, /fontFamily: "ui-sans-serif, -apple-system, system-ui,/);
  assert.match(item.产物, /fontSize: 16, lineHeight: "24px", color: "var\(--dc-text\)"/);
  assert.equal((item.产物.match(/style=\{\{ font: "inherit" \}\}/g) ?? []).length, 3);
  assert.match(item.产物, /<h2 id=\{title\} style=\{\{ fontWeight: 400 \}\}>/);
});
test('删除、保存重试、禁用门禁与安全说明未改变', () => {
  const strip = source => source.replace(/ style=\{\{[^\n]*?\}\}/g, '');
  assert.equal(strip(item.产物), item.原文);
  assert.match(item.产物, /disabled=\{locked \|\| pending\}/);
  assert.match(item.产物, /await deleteWorkbook\(id, retry\); onClose\(\);/);
});
test('候选TSX语法通过，不引入监听器、effect或新依赖', () => {
  const ast = ts.createSourceFile(path, item.产物, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(ast.parseDiagnostics.length, 0);
  assert.doesNotMatch(item.产物, /useEffect|addEventListener|setInterval|MutationObserver/);
  const imports = source => source.split('\n').filter(line => line.startsWith('import '));
  assert.deepEqual(imports(item.产物), imports(item.原文));
});
