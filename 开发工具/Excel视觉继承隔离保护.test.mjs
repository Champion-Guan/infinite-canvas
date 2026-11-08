import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, renameSync, symlinkSync, unlinkSync, realpathSync, linkSync, mkdirSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { Excel行高前置记录 } from './预审Excel弹窗行高.mjs';
import { 读取SQLite会话恢复隔离记录 } from './接入SQLite会话恢复隔离副本.mjs';
import { 核验Excel视觉继承批准, 读取Excel视觉继承批准, 核验Excel视觉继承来源, Excel视觉继承差异SHA256, Excel视觉继承清单SHA256 } from '../上游适配/Excel视觉继承批准.mjs';
import { Excel视觉继承批准产物, 核验Excel视觉继承完整包, 读取Excel视觉继承隔离记录 } from './接入Excel视觉继承隔离副本.mjs';
import { 事务写入 } from './接入用户功能.mjs';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'guan-excel-visual-guard-'))), root = join(home, '组合包');
cpSync(读取SQLite会话恢复隔离记录(Excel行高前置记录).组合包, root, { recursive: true, dereference: false, verbatimSymlinks: true });
const manifest = 读取Excel视觉继承批准(), delta = Excel视觉继承批准产物();
test('一文件批准、权威来源、完整会话恢复前置精确匹配', () => {
  assert.equal(manifest.文件数, 1); assert.equal(delta.size, 1);
  核验Excel视觉继承来源(根目录); assert.equal(核验Excel视觉继承完整包(root, false), true);
  assert.throws(() => 核验Excel视觉继承完整包(root));
});
test('拒绝篡改批准字节与缺失来源', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/Excel弹窗视觉继承一文件.json'));
  const patch = readFileSync(join(根目录, '上游适配/待审查/Excel弹窗视觉继承一文件.patch'));
  assert.throws(() => 核验Excel视觉继承批准(Buffer.concat([json, Buffer.from(' ')]), patch));
  assert.throws(() => 核验Excel视觉继承批准(json, Buffer.concat([patch, Buffer.from(' ')])));
  assert.throws(() => 核验Excel视觉继承来源(home));
});
test('拒绝未知文件、空目录及范围外画布和服务修改', () => {
  const unknown = join(root, 'unknown.txt'), folder = join(root, '未知空目录');
  writeFileSync(unknown, 'synthetic'); assert.throws(() => 核验Excel视觉继承完整包(root, false)); unlinkSync(unknown);
  mkdirSync(folder); assert.throws(() => 核验Excel视觉继承完整包(root, false)); rmdirSync(folder);
  for (const path of ['画布副本/web/index.html', '服务包/扩展功能/本机服务/数据服务.mjs']) {
    const file = join(root, path), bytes = readFileSync(file);
    try { writeFileSync(file, 'changed'); assert.throws(() => 核验Excel视觉继承完整包(root, false)); }
    finally { writeFileSync(file, bytes); }
  }
});
test('拒绝源码符号链接及硬链接', () => {
  const file = join(root, '画布副本/web/index.html');
  renameSync(file, file + '.saved');
  try {
    symlinkSync(file + '.saved', file); assert.throws(() => 核验Excel视觉继承完整包(root, false), /拒绝源码链接/); unlinkSync(file);
    linkSync(file + '.saved', file); assert.throws(() => 核验Excel视觉继承完整包(root, false), /硬链接/); unlinkSync(file);
  } finally { renameSync(file + '.saved', file); }
});
test('拒绝错误CSS及仅追加部分声明', () => {
  const [path, item] = [...delta][0], file = join(root, path), bytes = readFileSync(file);
  try {
    for (const candidate of [item.产物.replace('line-height: 1.5;', 'line-height: 1.4;'),
      item.产物.replace('  -webkit-font-smoothing: antialiased;\n', '')]) {
      writeFileSync(file, candidate);
      assert.throws(() => 核验Excel视觉继承完整包(root, false));
      assert.throws(() => 核验Excel视觉继承完整包(root, true));
    }
  } finally { writeFileSync(file, bytes); }
});
test('整批写后故障精确恢复原态，随后一文件同一事务接入', () => {
  const failed = join(home, '故障快照');
  assert.throws(() => 事务写入(root, delta, failed, { 差异指纹: Excel视觉继承差异SHA256, 写后检查() { throw Error('合成写后故障'); } }), /合成写后故障/);
  assert.equal(JSON.parse(readFileSync(join(failed, '事务.json'))).状态, '已回退');
  assert.equal(核验Excel视觉继承完整包(root, false), true);
  const snapshot = join(home, '完整快照');
  事务写入(root, delta, snapshot, { 差异指纹: Excel视觉继承差异SHA256, 写后检查() { 核验Excel视觉继承完整包(root, true); } });
  assert.equal(核验Excel视觉继承完整包(root, true), true); assert.throws(() => 核验Excel视觉继承完整包(root, false));
  const journal = JSON.parse(readFileSync(join(snapshot, '事务.json')));
  assert.equal(journal.状态, '完成'); assert.equal(journal.文件.length, 1);
  for (const [path, item] of delta) assert.equal(readFileSync(join(snapshot, '接入前', path), 'utf8'), item.原文);
});
test('读取隔离记录拒绝篡改记录、事务及原态快照', () => {
  // 仅复制本测试的临时产物，不触碰已装配交付包或历史批准包。
  const recordHome = realpathSync(mkdtempSync(join(根目录, '.运行/Excel视觉继承-'))), packageRoot = join(recordHome, '组合包');
  cpSync(root, packageRoot, { recursive: true, dereference: false, verbatimSymlinks: true });
  const snapshot = join(recordHome, 'Excel视觉继承事务快照');
  cpSync(join(home, '完整快照'), snapshot, { recursive: true });
  const recordPath = join(recordHome, 'Excel视觉继承接入记录.json');
  const record = { 组合包: packageRoot, 副本: join(packageRoot, '画布副本'), 服务包: join(packageRoot, '服务包'), 事务快照: snapshot,
    前置记录: Excel行高前置记录, 差异SHA256: Excel视觉继承差异SHA256, 清单SHA256: Excel视觉继承清单SHA256,
    文件数: 1, 已接入隔离副本: true, 已接管3100: false, 已访问Keychain: false };
  const bytes = JSON.stringify(record); writeFileSync(recordPath, bytes, { flag: 'wx' });
  assert.equal(读取Excel视觉继承隔离记录(recordPath).文件数, 1);
  writeFileSync(recordPath, JSON.stringify({ ...record, 已接管3100: true }));
  assert.throws(() => 读取Excel视觉继承隔离记录(recordPath), /记录不完整/); writeFileSync(recordPath, bytes);
  const journalPath = join(snapshot, '事务.json'), journalBytes = readFileSync(journalPath), journal = JSON.parse(journalBytes);
  try {
    writeFileSync(journalPath, JSON.stringify({ ...journal, 状态: '开始写入' }));
    assert.throws(() => 读取Excel视觉继承隔离记录(recordPath), /事务不完整/);
  } finally { writeFileSync(journalPath, journalBytes); }
  const before = join(snapshot, '接入前', [...delta.keys()][0]), beforeBytes = readFileSync(before);
  try { writeFileSync(before, 'tampered'); assert.throws(() => 读取Excel视觉继承隔离记录(recordPath), /原态快照不符/); }
  finally { writeFileSync(before, beforeBytes); }
  assert.equal(读取Excel视觉继承隔离记录(recordPath).文件数, 1);
});
