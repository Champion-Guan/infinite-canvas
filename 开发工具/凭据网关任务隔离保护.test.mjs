// 所有故障篡改都只发生于本轮创建的临时复制包，不改历史来源与批准原件。
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, renameSync, symlinkSync, unlinkSync, realpathSync, linkSync, mkdirSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 网关任务前置 } from './预审凭据网关任务端口.mjs';
import { 读取Excel删除字体平滑隔离记录 } from './接入Excel删除字体平滑隔离副本.mjs';
import { 核验凭据网关任务批准, 读取凭据网关任务批准, 核验凭据网关任务来源, 凭据网关任务差异SHA256, 凭据网关任务清单SHA256 } from '../上游适配/凭据网关任务批准.mjs';
import { 凭据网关任务批准产物, 核验凭据网关任务完整包, 凭据网关任务事务写入, 读取凭据网关任务隔离记录 } from './接入凭据网关任务隔离副本.mjs';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'guan-generation-guard-'))), root = join(home, '组合包');
cpSync(读取Excel删除字体平滑隔离记录(网关任务前置).组合包, root, { recursive: true, dereference: false, verbatimSymlinks: true });
const manifest = 读取凭据网关任务批准(), delta = 凭据网关任务批准产物();
test('17文件批准、来源及完整Excel前置精确匹配；必须明确前后态', () => {
  assert.equal(delta.size, 17); assert.equal(manifest.文件.filter(item => item.原始SHA256 === null).length, 12);
  核验凭据网关任务来源(根目录); assert.equal(核验凭据网关任务完整包(root, false), true);
  assert.throws(() => 核验凭据网关任务完整包(root));
});
test('批准字节变化、缺失来源和不完整事务产物均拒绝', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/凭据网关与任务端口.json'));
  const patch = readFileSync(join(根目录, '上游适配/待审查/凭据网关与任务端口.patch'));
  assert.throws(() => 核验凭据网关任务批准(Buffer.concat([json, Buffer.from(' ')]), patch));
  assert.throws(() => 核验凭据网关任务批准(json, Buffer.concat([patch, Buffer.from(' ')])));
  assert.throws(() => 核验凭据网关任务来源(home));
  assert.throws(() => 凭据网关任务事务写入(root, new Map([...delta].slice(1)), join(home, '不完整快照')), /完整批准17文件/);
});
test('未知文件、空目录及画布/服务范围外改变均拒绝', () => {
  const unknown = join(root, 'unknown.txt'), folder = join(root, '未知空目录');
  writeFileSync(unknown, 'synthetic'); assert.throws(() => 核验凭据网关任务完整包(root, false)); unlinkSync(unknown);
  mkdirSync(folder); assert.throws(() => 核验凭据网关任务完整包(root, false)); rmdirSync(folder);
  for (const path of ['画布副本/web/index.html', '服务包/扩展功能/本机存储/SQLite工作区.mjs']) {
    const file = join(root, path), bytes = readFileSync(file);
    try { writeFileSync(file, 'changed'); assert.throws(() => 核验凭据网关任务完整包(root, false)); }
    finally { writeFileSync(file, bytes); }
  }
});
test('源码符号链接、硬链接及替换依赖链接均拒绝', () => {
  const file = join(root, '画布副本/web/index.html'); renameSync(file, file + '.saved');
  try {
    symlinkSync(file + '.saved', file); assert.throws(() => 核验凭据网关任务完整包(root, false), /拒绝源码链接/); unlinkSync(file);
    linkSync(file + '.saved', file); assert.throws(() => 核验凭据网关任务完整包(root, false), /硬链接/); unlinkSync(file);
  } finally { renameSync(file + '.saved', file); }
  const dependency = join(root, '画布副本/web/node_modules'); renameSync(dependency, dependency + '.saved');
  try { symlinkSync(home, dependency); assert.throws(() => 核验凭据网关任务完整包(root, false), /依赖链接/); unlinkSync(dependency); }
  finally { renameSync(dependency + '.saved', dependency); }
});
test('半批既不是完整前态也不是后态', () => {
  const item = manifest.文件.find(value => value.原始SHA256 !== null), file = join(root, item.文件), saved = readFileSync(file);
  try { writeFileSync(file, delta.get(item.文件).产物); assert.throws(() => 核验凭据网关任务完整包(root, false)); assert.throws(() => 核验凭据网关任务完整包(root, true)); }
  finally { writeFileSync(file, saved); }
});
test('中途与写后故障回退全部17文件和新建目录，随后整笔事务成功', () => {
  for (const point of [1, 8, 16, '写后']) {
    const snapshot = join(home, '故障快照-' + point);
    assert.throws(() => 凭据网关任务事务写入(root, delta, snapshot, {
      写入前(_path, index) { if (index === point) throw Error('合成中途故障'); },
      写后检查() { if (point === '写后') throw Error('合成写后故障'); },
    }), /合成.*故障/);
    assert.equal(JSON.parse(readFileSync(join(snapshot, '事务.json'))).状态, '已回退');
    assert.equal(核验凭据网关任务完整包(root, false), true);
  }
  凭据网关任务事务写入(root, delta, join(home, '完整快照'));
  assert.equal(核验凭据网关任务完整包(root, true), true); assert.throws(() => 核验凭据网关任务完整包(root, false));
});
test('后态任意17文件被篡改均拒绝', () => {
  for (const [path] of delta) {
    const file = join(root, path), bytes = readFileSync(file);
    try { writeFileSync(file, 'tampered'); assert.throws(() => 核验凭据网关任务完整包(root, true)); }
    finally { writeFileSync(file, bytes); }
  }
});
test('接入记录验证完整事务、全部5份原态快照，拒绝假部署及额外字段', () => {
  const recordHome = realpathSync(mkdtempSync(join(根目录, '.运行/凭据网关任务-'))), packageRoot = join(recordHome, '组合包');
  cpSync(root, packageRoot, { recursive: true, dereference: false, verbatimSymlinks: true });
  const snapshot = join(recordHome, '凭据网关任务事务快照'); cpSync(join(home, '完整快照'), snapshot, { recursive: true });
  const recordPath = join(recordHome, '凭据网关任务接入记录.json');
  const record = { 组合包: packageRoot, 副本: join(packageRoot, '画布副本'), 服务包: join(packageRoot, '服务包'), 事务快照: snapshot,
    前置记录: 网关任务前置, 差异SHA256: 凭据网关任务差异SHA256, 清单SHA256: 凭据网关任务清单SHA256,
    文件数: 17, 已接入隔离副本: true, 已接管3100: false, 已访问Keychain: false, 原画布生成已切换: false };
  const bytes = JSON.stringify(record); writeFileSync(recordPath, bytes, { flag: 'wx' });
  assert.equal(读取凭据网关任务隔离记录(recordPath).文件数, 17);
  for (const value of [{ ...record, 已接管3100: true }, { ...record, bypass: true }]) {
    writeFileSync(recordPath, JSON.stringify(value)); assert.throws(() => 读取凭据网关任务隔离记录(recordPath), /记录不完整/);
  }
  writeFileSync(recordPath, bytes);
  const journalPath = join(snapshot, '事务.json'), journalBytes = readFileSync(journalPath), journal = JSON.parse(journalBytes);
  try { writeFileSync(journalPath, JSON.stringify({ ...journal, 状态: '开始写入' })); assert.throws(() => 读取凭据网关任务隔离记录(recordPath), /事务不完整/); }
  finally { writeFileSync(journalPath, journalBytes); }
  for (const [path, item] of delta) if (item.原文 !== null) {
    const file = join(snapshot, '接入前', path), saved = readFileSync(file);
    try { writeFileSync(file, 'changed'); assert.throws(() => 读取凭据网关任务隔离记录(recordPath), /原态快照不符/); }
    finally { writeFileSync(file, saved); }
  }
  assert.equal(读取凭据网关任务隔离记录(recordPath).文件数, 17);
});
