import test from 'node:test';
import assert from 'node:assert/strict';
import { 构建删除平滑候选 } from './预审Excel删除字体平滑.mjs';
import { ts } from './检查首批功能适配.mjs';
const preview = 构建删除平滑候选(), [[path, item]] = preview.delta;
test('一文件局部字体平滑，不改共享弹窗或全局样式', () => {
  assert.equal(preview.delta.size, 1); assert.equal(path, 'web/src/guan/工作簿删除弹窗.tsx');
  assert.equal((item.产物.match(/WebkitFontSmoothing/g) ?? []).length, 1);
  assert.ok(item.产物.includes('WebkitFontSmoothing: "antialiased"'));
});
test('业务与五处已批准样式保持，不增加全局监听器', () => {
  const strip = source => source.replace(/ style=\{\{[^\n]*?\}\}/g, '');
  assert.equal(strip(item.产物), strip(item.原文));
  assert.equal((item.产物.match(/style=\{/g) ?? []).length, 5);
  assert.doesNotMatch(item.产物, /useEffect|addEventListener|setInterval|MutationObserver/);
});
test('TSX语法与原有导入保持', () => {
  const ast = ts.createSourceFile(path, item.产物, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(ast.parseDiagnostics.length, 0);
  const imports = source => source.split('\n').filter(line => line.startsWith('import '));
  assert.deepEqual(imports(item.产物), imports(item.原文));
});
