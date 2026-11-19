import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from '../.运行/3100源/画布副本/web/node_modules/typescript/lib/typescript.js';

function fixture() {
  let clock = 0, nextId = 0;
  const timers = new Map(), tickets = [], writes = [];
  const code = ts.transpileModule(readFileSync(new URL('../扩展功能/产品/产品保存检查点.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('module', 'exports', 'setTimeout', 'clearTimeout', code)(module, module.exports,
    (fn, delay) => { const id = ++nextId; timers.set(id, { at: clock + delay, fn }); return id; },
    id => timers.delete(id));
  let current = true;
  const checkpoint = new module.exports.ProductCommitCheckpoint(ticket => tickets.push(ticket), () => current);
  checkpoint.mount();
  checkpoint.commit(0, { baseline: true }, true);
  return { checkpoint, tickets, writes, timers,
    stale() { current = false; },
    commit(snapshot, ready) { current = ready; checkpoint.commit(tickets.at(-1), snapshot, ready); },
    advance(ms) {
      const end = clock + ms;
      while (true) {
        const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry || entry[1].at > end) break;
        clock = entry[1].at; timers.delete(entry[0]); entry[1].fn();
      }
      clock = end;
    },
  };
}

test('拖动超过原10秒门限不报任务失败，结束后保存含结果的最新快照', async t => {
  const f = fixture(); t.after(() => f.checkpoint.unmount()); f.stale();
  let finished = false;
  const pending = f.checkpoint.flush(async value => f.writes.push(value)).then(() => { finished = true; });
  f.commit({ image: '已生成', dragging: true }, false);
  f.advance(15000);
  assert.equal(finished, false); assert.deepEqual(f.writes, []);
  assert.ok(f.tickets.length > 1);
  assert.equal(new Set(f.tickets).size, f.tickets.length, '每次核实使用新渲染票据');
  f.commit({ image: '已生成', x: 600, dragging: false }, true);
  await pending;
  assert.deepEqual(f.writes, [{ image: '已生成', x: 600, dragging: false }]);
  assert.equal(f.timers.size, 0);
});

test('交互期间收到第二张结果，一次续存保留两张结果和最后位置', async t => {
  const f = fixture(); t.after(() => f.checkpoint.unmount()); f.stale();
  const pending = f.checkpoint.flush(async value => f.writes.push(value));
  f.commit({ a: '成功', b: '等待' }, false);
  f.commit({ a: '成功', b: '成功' }, false);
  f.commit({ a: '成功', b: '成功', x: 900 }, true);
  await pending;
  assert.deepEqual(f.writes, [{ a: '成功', b: '成功', x: 900 }]);
});

test('提交票据已到达后开始画布手势，SQLite写入等待手势结束', async t => {
  const f = fixture(); t.after(() => f.checkpoint.unmount());
  f.commit({ image: '待写入' }, true);
  const pending = f.checkpoint.flush(async value => f.writes.push(value));
  await Promise.resolve();
  f.stale();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(f.writes, []);
  f.commit({ image: '待写入', x: 40 }, true);
  await pending;
  assert.deepEqual(f.writes, [{ image: '待写入', x: 40 }]);
});

test('忙碌等待中卸载作废原票据并清除定时器，不写入其他画布', async () => {
  const f = fixture(); f.stale();
  const pending = f.checkpoint.flush(async () => assert.fail('不可保存失效画布'));
  f.commit({ result: true }, false); f.advance(500);
  f.checkpoint.unmount();
  await assert.rejects(pending, /失效/);
  assert.equal(f.timers.size, 0);
});

test('页面无提交仍明确超时，真实持久化错误继续上抛', async t => {
  const f = fixture(); t.after(() => f.checkpoint.unmount()); f.stale();
  const timeout = f.checkpoint.flush(async () => assert.fail('没有新提交不能保存'));
  f.advance(10000);
  await assert.rejects(timeout, /未确认提交/);
  const failed = f.checkpoint.flush(async () => { throw Error('disk full'); });
  f.commit({ result: true }, true);
  await assert.rejects(failed, /disk full/);
  assert.equal(f.timers.size, 0);
});
