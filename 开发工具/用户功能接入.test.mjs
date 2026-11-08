import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 检查批次状态 } from './检查运行副本.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 读取批准清单, 核验批准产物 } from '../上游适配/用户已选功能批准.mjs';

test('批准指纹精确锁定24文件，任何清单或差异变更拒绝', () => {
  assert.equal(读取批准清单().文件.length, 24);
  const json = readFileSync(new URL('../上游适配/待审查/用户已选功能关闭.json', import.meta.url));
  const patch = readFileSync(new URL('../上游适配/待审查/用户已选功能关闭.patch', import.meta.url));
  assert.throws(() => 核验批准产物(Buffer.concat([json, Buffer.from(' ')]), patch), /指纹不符/);
  assert.throws(() => 核验批准产物(json, Buffer.concat([patch, Buffer.from(' ')])), /指纹不符/);
});
test('运行保护只接受完整原版或完整接入，拒绝半批', () => {
  assert.equal(检查批次状态(24, 0, 24), false);
  assert.equal(检查批次状态(0, 24, 24), true);
  assert.throws(() => 检查批次状态(23, 1, 24), /批次不完整/);
  assert.throws(() => 检查批次状态(0, 23, 24), /批次不完整/);
});
for (const failAt of [null, 1, 'check']) test(`副本事务保留快照并在失败时回退：${failAt}`, () => {
  const temp = mkdtempSync(join(tmpdir(), 'guan-selection-transaction-'));
  try {
    const root = join(temp, 'runtime'); mkdirSync(root);
    writeFileSync(join(root, 'existing.ts'), '原版');
    const files = new Map([['existing.ts', { 产物: '适配' }], ['guan/new.ts', { 产物: '新增' }]]);
    const run = () => 事务写入(root, files, join(temp, 'snapshot'), {
      写入前: (_path, index) => { if (index === failAt) throw Error('模拟写入失败'); },
      写后检查: () => { if (failAt === 'check') throw Error('模拟校验失败'); },
    });
    if (failAt === null) {
      assert.equal(run().状态, '完成');
      assert.equal(readFileSync(join(root, 'existing.ts'), 'utf8'), '适配');
    } else {
      assert.throws(run, /模拟/);
      assert.equal(readFileSync(join(root, 'existing.ts'), 'utf8'), '原版');
      assert.equal(existsSync(join(root, 'guan/new.ts')), false);
    }
    assert.equal(readFileSync(join(temp, 'snapshot/接入前/existing.ts'), 'utf8'), '原版');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
test('事务拒绝相对路径及符号链接逃逸，外部文件不变', () => {
  const temp = mkdtempSync(join(tmpdir(), 'guan-selection-path-'));
  try {
    const root = join(temp, 'runtime'); mkdirSync(root);
    const outside = join(temp, 'outside'); mkdirSync(outside);
    writeFileSync(join(outside, 'file.ts'), '不可写');
    symlinkSync(outside, join(root, 'escape'));
    for (const path of ['../outside/file.ts', 'escape/file.ts']) {
      assert.throws(() => 事务写入(root, new Map([[path, { 产物: '误写' }]]), join(temp, 'snapshot')), /副本之外/);
    }
    assert.equal(readFileSync(join(outside, 'file.ts'), 'utf8'), '不可写');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
