import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, renameSync, symlinkSync, unlinkSync, realpathSync, linkSync, mkdirSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 收尾前置记录 } from './预审迁移扩大整批收尾.mjs';
import { 读取迁移扩大整批隔离记录 } from './接入迁移扩大整批隔离副本.mjs';
import { 核验迁移扩大整批收尾批准, 读取迁移扩大整批收尾批准, 核验迁移扩大整批收尾来源 } from '../上游适配/迁移扩大整批收尾批准.mjs';
import { 迁移扩大整批收尾批准产物, 核验迁移扩大整批收尾完整包, 迁移扩大整批收尾事务写入, 读取迁移扩大整批收尾隔离记录, 迁移扩大整批收尾记录内容 } from './接入迁移扩大整批收尾隔离副本.mjs';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'guan-finish-guard-'))), root = join(home, '组合包');
cpSync(读取迁移扩大整批隔离记录(收尾前置记录).组合包, root, { recursive: true, dereference: false, verbatimSymlinks: true });
const manifest = 读取迁移扩大整批收尾批准(), delta = 迁移扩大整批收尾批准产物();
test('五文件批准/来源/完整67文件前置精确匹配，必须指定前后态', () => {
  assert.equal(delta.size, 5); assert.equal(manifest.文件.filter(item => item.原始SHA256 === null).length, 1);
  核验迁移扩大整批收尾来源(根目录); assert.equal(核验迁移扩大整批收尾完整包(root, false), true);
  assert.throws(() => 核验迁移扩大整批收尾完整包(root));
});
test('批准原件变动、来源缺失、不完整事务均拒绝', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/迁移扩大整批收尾.json')), patch = readFileSync(join(根目录, '上游适配/待审查/迁移扩大整批收尾.patch'));
  assert.throws(() => 核验迁移扩大整批收尾批准(Buffer.concat([json, Buffer.from(' ')]), patch));
  assert.throws(() => 核验迁移扩大整批收尾批准(json, Buffer.concat([patch, Buffer.from(' ')])));
  assert.throws(() => 核验迁移扩大整批收尾来源(home));
  assert.throws(() => 迁移扩大整批收尾事务写入(root, new Map([...delta].slice(1)), join(home, '不完整')), /完整批准5文件/);
});
test('未知文件/空目录及服务或画布范围外变化拒绝', () => {
  const file = join(root, 'unknown'), folder = join(root, '未知空目录');
  writeFileSync(file, 'synthetic'); assert.throws(() => 核验迁移扩大整批收尾完整包(root, false)); unlinkSync(file);
  mkdirSync(folder); assert.throws(() => 核验迁移扩大整批收尾完整包(root, false)); rmdirSync(folder);
  for (const path of ['画布副本/web/index.html', '服务包/扩展功能/本机存储/SQLite工作区.mjs']) {
    const target = join(root, path), bytes = readFileSync(target);
    try { writeFileSync(target, 'changed'); assert.throws(() => 核验迁移扩大整批收尾完整包(root, false)); }
    finally { writeFileSync(target, bytes); }
  }
});
test('源码软/硬链接及替换依赖链接拒绝', () => {
  const file = join(root, '画布副本/web/index.html'); renameSync(file, file + '.saved');
  try {
    symlinkSync(file + '.saved', file); assert.throws(() => 核验迁移扩大整批收尾完整包(root, false), /源码链接/); unlinkSync(file);
    linkSync(file + '.saved', file); assert.throws(() => 核验迁移扩大整批收尾完整包(root, false), /硬链接/); unlinkSync(file);
  } finally { renameSync(file + '.saved', file); }
  const dependency = join(root, '画布副本/web/node_modules'); renameSync(dependency, dependency + '.saved');
  try { symlinkSync(home, dependency); assert.throws(() => 核验迁移扩大整批收尾完整包(root, false), /依赖链接/); unlinkSync(dependency); }
  finally { renameSync(dependency + '.saved', dependency); }
});
test('半批不接受完整前态或后态', () => {
  const [path, item] = [...delta][0], file = join(root, path), bytes = readFileSync(file);
  try { writeFileSync(file, item.产物); assert.throws(() => 核验迁移扩大整批收尾完整包(root, false)); assert.throws(() => 核验迁移扩大整批收尾完整包(root, true)); }
  finally { writeFileSync(file, bytes); }
});
test('中途/写后故障整笔回退含新增目录；随后整批成功', () => {
  for (const point of [1, 4, '写后']) {
    const snapshot = join(home, '故障-' + point);
    assert.throws(() => 迁移扩大整批收尾事务写入(root, delta, snapshot, {
      写入前(_path, index) { if (index === point) throw Error('合成中途故障'); },
      写后检查() { if (point === '写后') throw Error('合成写后故障'); },
    }), /合成.*故障/);
    assert.equal(JSON.parse(readFileSync(join(snapshot, '事务.json'))).状态, '已回退');
    assert.equal(核验迁移扩大整批收尾完整包(root, false), true);
  }
  迁移扩大整批收尾事务写入(root, delta, join(home, '完整快照'));
  assert.equal(核验迁移扩大整批收尾完整包(root, true), true);
});
test('任意五文件产物被篡改均拒绝', () => {
  for (const [path] of delta) {
    const file = join(root, path), bytes = readFileSync(file);
    try { writeFileSync(file, 'tampered'); assert.throws(() => 核验迁移扩大整批收尾完整包(root, true)); }
    finally { writeFileSync(file, bytes); }
  }
});
test('真实记录严格验证五文件事务、四原态快照及未知快照内容', () => {
  const recordHome = realpathSync(mkdtempSync(join(根目录, '.运行/迁移扩大整批收尾-'))), packageRoot = join(recordHome, '组合包');
  cpSync(root, packageRoot, { recursive: true, dereference: false, verbatimSymlinks: true });
  const snapshot = join(recordHome, '收尾事务快照'); cpSync(join(home, '完整快照'), snapshot, { recursive: true });
  const recordPath = join(recordHome, '收尾接入记录.json'), record = 迁移扩大整批收尾记录内容(recordHome), bytes = JSON.stringify(record);
  writeFileSync(recordPath, bytes, { flag: 'wx' }); assert.equal(读取迁移扩大整批收尾隔离记录(recordPath).文件数, 5);
  for (const value of [{ ...record, 已接管3100: true }, { ...record, bypass: true }]) {
    writeFileSync(recordPath, JSON.stringify(value)); assert.throws(() => 读取迁移扩大整批收尾隔离记录(recordPath), /记录不完整/);
  }
  writeFileSync(recordPath, bytes);
  for (const path of ['事务.json', ...manifest.文件.filter(item => item.原始SHA256 !== null).map(item => '接入前/' + item.文件)]) {
    const file = join(snapshot, path), saved = readFileSync(file);
    try { writeFileSync(file, 'changed'); assert.throws(() => 读取迁移扩大整批收尾隔离记录(recordPath), /快照/); }
    finally { writeFileSync(file, saved); }
  }
  const unknown = join(snapshot, '未知目录'); mkdirSync(unknown);
  try { assert.throws(() => 读取迁移扩大整批收尾隔离记录(recordPath), /快照/); } finally { rmdirSync(unknown); }
  assert.equal(读取迁移扩大整批收尾隔离记录(recordPath).文件数, 5);
});
