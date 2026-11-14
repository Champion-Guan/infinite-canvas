import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from '../.运行/3100源/画布副本/web/node_modules/typescript/lib/typescript.js';

function load(path, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(new URL('../' + path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
  }, module, module.exports);
  return module.exports;
}
const { ProductCommitCheckpoint } = load('扩展功能/产品/产品保存检查点.ts');
const tick = () => new Promise(resolve => setImmediate(resolve));
test('上一帧已保存但节点事务已更新时，保存必须等待新提交，不回退到旧错误', async () => {
  let current = true;
  const tickets = [], writes = [];
  const checkpoint = new ProductCommitCheckpoint(ticket => tickets.push(ticket), () => current);
  checkpoint.mount();
  checkpoint.commit(0, { error: '503' }, true);
  current = false;
  const flight = checkpoint.flush(async snapshot => { writes.push(snapshot); });
  await tick();
  assert.equal(tickets.length, 1); assert.deepEqual(writes, []);
  current = true;
  checkpoint.commit(tickets[0], { error: '400', retries: 0 }, true);
  await flight;
  assert.deepEqual(writes, [{ error: '400', retries: 0 }]);
  await checkpoint.flush(async snapshot => writes.push(snapshot));
  assert.equal(tickets.length, 1); assert.equal(writes.length, 1);
  checkpoint.unmount();
});
test('失败保存遇到新一张图完成时，跟进最新快照，不丢失另一槽位结果', async () => {
  const tickets = [], writes = []; let current = true, release;
  const checkpoint = new ProductCommitCheckpoint(ticket => tickets.push(ticket), () => current);
  checkpoint.mount(); checkpoint.commit(0, { a: 'old', b: 'old' }, true); current = false;
  const flight = checkpoint.flush(async snapshot => { writes.push(snapshot); if (writes.length === 1) await new Promise(resolve => { release = resolve; }); });
  checkpoint.commit(tickets[0], { a: 'failed', b: 'old' }, true);
  await tick();
  current = true;
  checkpoint.commit(tickets[0], { a: 'failed', b: 'success' }, true);
  release(); await tick();
  checkpoint.commit(tickets.at(-1), { a: 'failed', b: 'success' }, true);
  await flight;
  assert.deepEqual(writes.at(-1), { a: 'failed', b: 'success' });
  checkpoint.unmount();
});
test('失败保存拒绝旧页面票据，未实际写入时不会宣称完成', async () => {
  const checkpoint = new ProductCommitCheckpoint(() => {}, () => false);
  checkpoint.mount(); checkpoint.commit(0, { old: true }, true);
  const flight = checkpoint.flush(async () => assert.fail('不能写入旧快照'));
  checkpoint.unmount(); await assert.rejects(flight, /失效/);
});
test('SQLite回执到达前出现尚未渲染的新事务时，再等待提交并保存最新错误', async () => {
  let current = false, release;
  const tickets = [], writes = [];
  const checkpoint = new ProductCommitCheckpoint(ticket => tickets.push(ticket), () => current);
  checkpoint.mount(); checkpoint.commit(0, { error: 'old' }, true);
  const flight = checkpoint.flush(async value => {
    writes.push(value);
    if (writes.length === 1) await new Promise(resolve => { release = resolve; });
  });
  current = true;
  checkpoint.commit(tickets[0], { error: '503' }, true);
  await tick(); current = false; release(); await tick();
  assert.equal(tickets.length, 2);
  current = true; checkpoint.commit(tickets[1], { error: '400' }, true);
  await flight; assert.deepEqual(writes.at(-1), { error: '400' }); checkpoint.unmount();
});
test('首次失败、单槽位失败和停止后的失败均保存，成功卡片不增加保存', async () => {
  let saves = 0;
  const { saveFailedImageState } = load('扩展功能/画布生成/图片失败状态保存.ts', {
    '../产品/产品操作': { async saveProductCanvas(id) { assert.equal(id, 'product'); saves++; } },
  });
  const notify = () => assert.fail('保存应成功');
  await saveFailedImageState('product', [{ id: 'a', type: 'image', metadata: { status: 'error' } }], ['a'], notify);
  await saveFailedImageState('product', [{ id: 'a', type: 'image', metadata: { status: 'success', images: [{ id: 'slot', status: 'error' }] } }], ['a'], notify);
  await saveFailedImageState('product', [{ id: 'a', type: 'image', metadata: { status: 'success' } }], ['a'], notify);
  await saveFailedImageState('product', [{ id: 'other', type: 'image', metadata: { status: 'error' } }], ['a'], notify);
  assert.equal(saves, 2);
});
test('保存失败明确提示，不生成新任务或吞掉原错误', async () => {
  const messages = [];
  const { saveFailedImageState } = load('扩展功能/画布生成/图片失败状态保存.ts', {
    '../产品/产品操作': { async saveProductCanvas() { throw Error('disk full'); } },
  });
  const node = { id: 'a', type: 'image', metadata: { status: 'error', errorDetails: 'HTTP 400: 提示词违规' } };
  await saveFailedImageState('product', [node], ['a'], text => messages.push(text));
  assert.equal(messages.length, 1); assert.match(messages[0], /保存尚未确认/);
  assert.equal(node.metadata.errorDetails, 'HTTP 400: 提示词违规');
});
