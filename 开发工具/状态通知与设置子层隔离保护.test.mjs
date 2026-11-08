// 独立后继，迁自 开发工具/任务确认与设置边界隔离保护.test.mjs SHA256 e013843c6b8bb1b01cb7af5bd93f9afed1dba7f7d7d3a3ae17bebf2c3205c5c5；原件保留。
// 独立后继，迁自 开发工具/迁移扩大整批收尾隔离保护.test.mjs SHA256 70177b36d81c9b82e4bc3aa5ef03cf3aa9d7048e9671e32b3058ad1eb509023c；原件保留。
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, renameSync, symlinkSync, unlinkSync, realpathSync, linkSync, mkdirSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 子层前置记录 } from './预审状态通知与设置子层.mjs';
import { 读取任务确认与设置边界隔离记录 } from './接入任务确认与设置边界隔离副本.mjs';
import { 核验状态通知与设置子层批准, 读取状态通知与设置子层批准, 核验状态通知与设置子层来源 } from '../上游适配/状态通知与设置子层批准.mjs';
import { 状态通知与设置子层批准产物, 核验状态通知与设置子层完整包, 状态通知与设置子层事务写入, 读取状态通知与设置子层隔离记录, 状态通知与设置子层记录内容 } from './接入状态通知与设置子层隔离副本.mjs';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'guan-status-layer-guard-'))), root = join(home, '组合包');
cpSync(读取任务确认与设置边界隔离记录(子层前置记录).组合包, root, { recursive: true, dereference: false, verbatimSymlinks: true });
const manifest = 读取状态通知与设置子层批准(), delta = 状态通知与设置子层批准产物();
test('六文件批准/来源/完整九文件前置精确匹配，必须指定前后态', () => {
  assert.equal(delta.size, 6); assert.equal(manifest.文件.filter(item => item.原始SHA256 === null).length, 1);
  核验状态通知与设置子层来源(根目录); assert.equal(核验状态通知与设置子层完整包(root, false), true);
  assert.throws(() => 核验状态通知与设置子层完整包(root));
});
test('批准原件变动、来源缺失、不完整事务均拒绝', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/状态通知与设置子层.json')), patch = readFileSync(join(根目录, '上游适配/待审查/状态通知与设置子层.patch'));
  assert.throws(() => 核验状态通知与设置子层批准(Buffer.concat([json, Buffer.from(' ')]), patch));
  assert.throws(() => 核验状态通知与设置子层批准(json, Buffer.concat([patch, Buffer.from(' ')])));
  assert.throws(() => 核验状态通知与设置子层来源(home));
  assert.throws(() => 状态通知与设置子层事务写入(root, new Map([...delta].slice(1)), join(home, '不完整')), /完整批准6文件/);
});
test('未知文件/空目录及服务或画布范围外变化拒绝', () => {
  const file = join(root, 'unknown'), folder = join(root, '未知空目录');
  writeFileSync(file, 'synthetic'); assert.throws(() => 核验状态通知与设置子层完整包(root, false)); unlinkSync(file);
  mkdirSync(folder); assert.throws(() => 核验状态通知与设置子层完整包(root, false)); rmdirSync(folder);
  for (const path of ['画布副本/web/index.html', '服务包/扩展功能/本机存储/SQLite工作区.mjs']) {
    const target = join(root, path), bytes = readFileSync(target);
    try { writeFileSync(target, 'changed'); assert.throws(() => 核验状态通知与设置子层完整包(root, false)); }
    finally { writeFileSync(target, bytes); }
  }
});
test('源码软/硬链接及替换依赖链接拒绝', () => {
  const file = join(root, '画布副本/web/index.html'); renameSync(file, file + '.saved');
  try {
    symlinkSync(file + '.saved', file); assert.throws(() => 核验状态通知与设置子层完整包(root, false), /源码链接/); unlinkSync(file);
    linkSync(file + '.saved', file); assert.throws(() => 核验状态通知与设置子层完整包(root, false), /硬链接/); unlinkSync(file);
  } finally { renameSync(file + '.saved', file); }
  const dependency = join(root, '画布副本/web/node_modules'); renameSync(dependency, dependency + '.saved');
  try { symlinkSync(home, dependency); assert.throws(() => 核验状态通知与设置子层完整包(root, false), /依赖链接/); unlinkSync(dependency); }
  finally { renameSync(dependency + '.saved', dependency); }
});
test('半批不接受完整前态或后态', () => {
  const [path, item] = [...delta][1], file = join(root, path), bytes = readFileSync(file);
  try { writeFileSync(file, item.产物); assert.throws(() => 核验状态通知与设置子层完整包(root, false)); assert.throws(() => 核验状态通知与设置子层完整包(root, true)); }
  finally { writeFileSync(file, bytes); }
});
test('中途/写后故障整笔回退含新增目录；随后整批成功', () => {
  for (const point of [1, 3, 5, '写后']) {
    const snapshot = join(home, '故障-' + point);
    assert.throws(() => 状态通知与设置子层事务写入(root, delta, snapshot, {
      写入前(_path, index) { if (index === point) throw Error('合成中途故障'); },
      写后检查() { if (point === '写后') throw Error('合成写后故障'); },
    }), /合成.*故障/);
    assert.equal(JSON.parse(readFileSync(join(snapshot, '事务.json'))).状态, '已回退');
    assert.equal(核验状态通知与设置子层完整包(root, false), true);
  }
  状态通知与设置子层事务写入(root, delta, join(home, '完整快照'));
  assert.equal(核验状态通知与设置子层完整包(root, true), true);
});
test('任意六文件产物被篡改均拒绝', () => {
  for (const [path] of delta) {
    const file = join(root, path), bytes = readFileSync(file);
    try { writeFileSync(file, 'tampered'); assert.throws(() => 核验状态通知与设置子层完整包(root, true)); }
    finally { writeFileSync(file, bytes); }
  }
});
test('真实记录严格验证六文件事务、五原态快照及未知快照内容', () => {
  const recordHome = realpathSync(mkdtempSync(join(根目录, '.运行/状态通知与设置子层-'))), packageRoot = join(recordHome, '组合包');
  cpSync(root, packageRoot, { recursive: true, dereference: false, verbatimSymlinks: true });
  const snapshot = join(recordHome, '子层事务快照'); cpSync(join(home, '完整快照'), snapshot, { recursive: true });
  const recordPath = join(recordHome, '子层接入记录.json'), record = 状态通知与设置子层记录内容(recordHome), bytes = JSON.stringify(record);
  writeFileSync(recordPath, bytes, { flag: 'wx' }); assert.equal(读取状态通知与设置子层隔离记录(recordPath).文件数, 6);
  for (const value of [{ ...record, 已接管3100: true }, { ...record, bypass: true }]) {
    writeFileSync(recordPath, JSON.stringify(value)); assert.throws(() => 读取状态通知与设置子层隔离记录(recordPath), /记录不完整/);
  }
  writeFileSync(recordPath, bytes);
  for (const path of ['事务.json', ...manifest.文件.filter(item => item.原始SHA256 !== null).map(item => '接入前/' + item.文件)]) {
    const file = join(snapshot, path), saved = readFileSync(file);
    try { writeFileSync(file, 'changed'); assert.throws(() => 读取状态通知与设置子层隔离记录(recordPath), /快照/); }
    finally { writeFileSync(file, saved); }
  }
  const unknown = join(snapshot, '未知目录'); mkdirSync(unknown);
  try { assert.throws(() => 读取状态通知与设置子层隔离记录(recordPath), /快照/); } finally { rmdirSync(unknown); }
  assert.equal(读取状态通知与设置子层隔离记录(recordPath).文件数, 6);
});
