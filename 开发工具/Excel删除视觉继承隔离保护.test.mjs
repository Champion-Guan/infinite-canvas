// 故障写入仅在全新临时复制包中执行。
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, renameSync, symlinkSync, unlinkSync, realpathSync, linkSync, mkdirSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 删除视觉前置 } from './预审Excel删除视觉继承.mjs';
import { 读取工作簿删除隔离记录 } from './接入Excel工作簿删除隔离副本.mjs';
import { 核验Excel删除视觉继承批准, 读取Excel删除视觉继承批准, 核验Excel删除视觉继承来源, Excel删除视觉继承差异SHA256, Excel删除视觉继承清单SHA256 } from '../上游适配/Excel删除视觉继承批准.mjs';
import { Excel删除视觉继承批准产物, 核验Excel删除视觉继承完整包, 读取Excel删除视觉继承隔离记录 } from './接入Excel删除视觉继承隔离副本.mjs';
import { 事务写入 } from './接入用户功能.mjs';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'guan-delete-visual-guard-'))), root = join(home, '组合包');
cpSync(读取工作簿删除隔离记录(删除视觉前置).组合包, root, { recursive: true, dereference: false, verbatimSymlinks: true });
const manifest = 读取Excel删除视觉继承批准(), delta = Excel删除视觉继承批准产物();
test('1文件批准、来源、完整视觉继承前置精确匹配', () => {
  assert.equal(delta.size, 1); assert.equal(manifest.文件.filter(item => item.原始SHA256 === null).length, 0);
  核验Excel删除视觉继承来源(根目录); assert.equal(核验Excel删除视觉继承完整包(root, false), true);
  assert.throws(() => 核验Excel删除视觉继承完整包(root));
});
test('拒绝批准原件字节变化与缺失来源', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/Excel删除视觉继承一文件.json'));
  const patch = readFileSync(join(根目录, '上游适配/待审查/Excel删除视觉继承一文件.patch'));
  assert.throws(() => 核验Excel删除视觉继承批准(Buffer.concat([json, Buffer.from(' ')]), patch));
  assert.throws(() => 核验Excel删除视觉继承批准(json, Buffer.concat([patch, Buffer.from(' ')])));
  assert.throws(() => 核验Excel删除视觉继承来源(home));
});
test('拒绝未知文件、空目录、范围外画布/服务改变', () => {
  const unknown = join(root, 'unknown.txt'), folder = join(root, '未知空目录');
  writeFileSync(unknown, 'synthetic'); assert.throws(() => 核验Excel删除视觉继承完整包(root, false)); unlinkSync(unknown);
  mkdirSync(folder); assert.throws(() => 核验Excel删除视觉继承完整包(root, false)); rmdirSync(folder);
  for (const path of ['画布副本/web/index.html', '服务包/扩展功能/本机服务/数据服务.mjs']) {
    const file = join(root, path), bytes = readFileSync(file);
    try { writeFileSync(file, 'changed'); assert.throws(() => 核验Excel删除视觉继承完整包(root, false)); }
    finally { writeFileSync(file, bytes); }
  }
});
test('拒绝源码符号链接及硬链接', () => {
  const file = join(root, '画布副本/web/index.html'); renameSync(file, file + '.saved');
  try {
    symlinkSync(file + '.saved', file); assert.throws(() => 核验Excel删除视觉继承完整包(root, false), /拒绝源码链接/); unlinkSync(file);
    linkSync(file + '.saved', file); assert.throws(() => 核验Excel删除视觉继承完整包(root, false), /硬链接/); unlinkSync(file);
  } finally { renameSync(file + '.saved', file); }
});
test('部分接入既不是完整前态也不是后态', () => {
  const [path] = [...delta][0], file = join(root, path), bytes = readFileSync(file);
  writeFileSync(file, 'incomplete visual file');
  try { assert.throws(() => 核验Excel删除视觉继承完整包(root, false)); assert.throws(() => 核验Excel删除视觉继承完整包(root, true)); }
  finally { writeFileSync(file, bytes); }
});
test('中途故障及写后故障均精确回退，1文件同笔事务接入', () => {
  for (const stage of ['中途', '写后']) {
    const snapshot = join(home, stage + '故障快照');
    assert.throws(() => 事务写入(root, delta, snapshot, { 差异指纹: Excel删除视觉继承差异SHA256,
      写入前(path, index) { if (stage === '中途' && index === 0) throw Error('合成中途故障'); },
      写后检查() { throw Error('合成写后故障'); } }), /合成.*故障/);
    assert.equal(JSON.parse(readFileSync(join(snapshot, '事务.json'))).状态, '已回退');
    assert.equal(核验Excel删除视觉继承完整包(root, false), true);
  }
  事务写入(root, delta, join(home, '完整快照'), { 差异指纹: Excel删除视觉继承差异SHA256, 写后检查() { 核验Excel删除视觉继承完整包(root, true); } });
  assert.equal(核验Excel删除视觉继承完整包(root, true), true); assert.throws(() => 核验Excel删除视觉继承完整包(root, false));
});
test('后态任一新增或修改文件被篡改均拒绝', () => {
  for (const [path] of delta) {
    const file = join(root, path), bytes = readFileSync(file);
    try { writeFileSync(file, 'tampered'); assert.throws(() => 核验Excel删除视觉继承完整包(root, true)); }
    finally { writeFileSync(file, bytes); }
  }
});
test('接入记录核验事务及全部原态快照', () => {
  const recordHome = realpathSync(mkdtempSync(join(根目录, '.运行/Excel删除视觉继承-'))), packageRoot = join(recordHome, '组合包');
  cpSync(root, packageRoot, { recursive: true, dereference: false, verbatimSymlinks: true });
  const snapshot = join(recordHome, 'Excel删除视觉继承事务快照'); cpSync(join(home, '完整快照'), snapshot, { recursive: true });
  const recordPath = join(recordHome, 'Excel删除视觉继承接入记录.json');
  const record = { 组合包: packageRoot, 副本: join(packageRoot, '画布副本'), 服务包: join(packageRoot, '服务包'), 事务快照: snapshot,
    前置记录: 删除视觉前置, 差异SHA256: Excel删除视觉继承差异SHA256, 清单SHA256: Excel删除视觉继承清单SHA256,
    文件数: 1, 已接入隔离副本: true, 已接管3100: false, 已访问Keychain: false };
  const bytes = JSON.stringify(record); writeFileSync(recordPath, bytes, { flag: 'wx' });
  assert.equal(读取Excel删除视觉继承隔离记录(recordPath).文件数, 1);
  writeFileSync(recordPath, JSON.stringify({ ...record, 已接管3100: true }));
  assert.throws(() => 读取Excel删除视觉继承隔离记录(recordPath), /记录不完整/); writeFileSync(recordPath, bytes);
  const journalPath = join(snapshot, '事务.json'), journalBytes = readFileSync(journalPath), journal = JSON.parse(journalBytes);
  try {
    writeFileSync(journalPath, JSON.stringify({ ...journal, 状态: '开始写入' }));
    assert.throws(() => 读取Excel删除视觉继承隔离记录(recordPath), /事务不完整/);
  } finally { writeFileSync(journalPath, journalBytes); }
  for (const [path, item] of delta) if (item.原文 !== null) {
    const file = join(snapshot, '接入前', path), saved = readFileSync(file);
    try { writeFileSync(file, 'changed'); assert.throws(() => 读取Excel删除视觉继承隔离记录(recordPath), /原态快照不符/); }
    finally { writeFileSync(file, saved); }
  }
  assert.equal(读取Excel删除视觉继承隔离记录(recordPath).文件数, 1);
});

