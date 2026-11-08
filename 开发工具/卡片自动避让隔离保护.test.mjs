import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 核验卡片布局批准, 读取卡片布局批准 } from '../上游适配/卡片自动避让批准.mjs';
import { 读取卡片布局隔离记录, 核验卡片布局完整源码 } from './接入卡片自动避让隔离副本.mjs';

const record = join(根目录, '.运行/卡片自动避让-YFK58C/卡片布局接入记录.json');
const integration = 读取卡片布局隔离记录(record);
const home = mkdtempSync(join(根目录, '.运行/卡片防护测试-')), root = join(home, '副本');
cpSync(integration.副本, root, { recursive: true, dereference: false, errorOnExist: true, force: false });
const json = readFileSync(join(根目录, '上游适配/待审查/卡片自动避让原样迁入.json'));
const patch = readFileSync(join(根目录, '上游适配/待审查/卡片自动避让原样迁入.patch'));
const item = 读取卡片布局批准().文件[0], target = join(root, item.文件), baseline = readFileSync(target);
test('批准字节、事务证据、完整历史前置与全后态通过', () => {
  assert.equal(核验卡片布局批准(json, patch).文件.length, 4);
  assert.equal(核验卡片布局完整源码(root, true), true);
});
test('修改批准清单或diff任何字节均拒绝', () => {
  assert.throws(() => 核验卡片布局批准(Buffer.concat([json, Buffer.from('\n')]), patch), /指纹不符/);
  assert.throws(() => 核验卡片布局批准(json, Buffer.concat([patch, Buffer.from('\n')])), /指纹不符/);
});
test('四文件未知内容拒绝', () => {
  try {
    writeFileSync(target, Buffer.concat([baseline, Buffer.from('\n// synthetic guard mutation\n')]));
    assert.throws(() => 核验卡片布局完整源码(root, true), /未知改动/);
  } finally { writeFileSync(target, baseline); }
});
test('一文件退回前态的半批拒绝', () => {
  try {
    writeFileSync(target, readFileSync(join(integration.事务快照, '接入前', item.文件)));
    assert.throws(() => 核验卡片布局完整源码(root, true), /半批/);
  } finally { writeFileSync(target, baseline); }
});
test('范围外原源码和未知文件均拒绝', () => {
  const existing = join(root, 'web/src/main.tsx'), old = readFileSync(existing), extra = join(root, 'web/src/未知测试模块.ts');
  try {
    writeFileSync(existing, Buffer.concat([old, Buffer.from('\n')]));
    assert.throws(() => 核验卡片布局完整源码(root, true), /范围外/);
    writeFileSync(existing, old);
    writeFileSync(extra, 'export const synthetic=true;\n', { flag: 'wx' });
    assert.throws(() => 核验卡片布局完整源码(root, true), /未知文件/);
  } finally { writeFileSync(existing, old); try { unlinkSync(extra); } catch {} }
});
test('未知源码链接与伪装dist目录也拒绝', () => {
  const link = join(root, 'web/src/未知链接.ts'), extra = join(root, 'dist/未知.js');
  try {
    symlinkSync(target, link);
    assert.throws(() => 核验卡片布局完整源码(root, true), /链接/);
    unlinkSync(link);
    mkdirSync(join(root, 'dist')); writeFileSync(extra, 'synthetic\n', { flag: 'wx' });
    assert.throws(() => 核验卡片布局完整源码(root, true), /未知文件/);
  } finally { try { unlinkSync(link); } catch {} try { unlinkSync(extra); } catch {} }
});
test('测试扰动恢复后原完整源码仍通过，真实接入副本未被测试修改', () => {
  assert.equal(核验卡片布局完整源码(root, true), true);
  assert.equal(读取卡片布局隔离记录(record).副本, integration.副本);
});
