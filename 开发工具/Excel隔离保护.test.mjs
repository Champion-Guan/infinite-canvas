import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync, renameSync, symlinkSync, unlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { Excel前置记录 } from './预审Excel迁入.mjs';
import { 读取恢复挂载隔离记录 } from './接入产品恢复挂载隔离副本.mjs';
import { 核验Excel批准, 读取Excel批准, 核验Excel来源, Excel差异SHA256 } from '../上游适配/Excel导入与工作簿批准.mjs';
import { Excel批准产物, 核验Excel完整包 } from './接入Excel导入与工作簿隔离副本.mjs';
import { 事务写入 } from './接入用户功能.mjs';

const home = realpathSync(mkdtempSync(join(tmpdir(), 'guan-excel-guard-'))), root = join(home, '组合包');
const previous = 读取恢复挂载隔离记录(Excel前置记录);
cpSync(previous.组合包, root, { recursive: true, dereference: false, verbatimSymlinks: true });
const manifest = 读取Excel批准(), delta = Excel批准产物();
test('批准16项及完整前态来源匹配', () => {
  assert.equal(manifest.文件.length, 16); 核验Excel来源(根目录); assert.equal(核验Excel完整包(root, false), true);
});
test('篡改清单/差异/生成器或自有来源拒绝', () => {
  const json = readFileSync(join(根目录, '上游适配/待审查/Excel导入与工作簿迁入.json'));
  const patch = readFileSync(join(根目录, '上游适配/待审查/Excel导入与工作簿迁入.patch'));
  assert.throws(() => 核验Excel批准(Buffer.concat([json, Buffer.from(' ')]), patch));
  assert.throws(() => 核验Excel批准(json, Buffer.concat([patch, Buffer.from(' ')])));
  assert.throws(() => 核验Excel来源(home));
});
test('未知文件、未知源码与符号链接均拒绝', () => {
  const unknown = join(root, 'unknown.txt'); writeFileSync(unknown, 'test');
  assert.throws(() => 核验Excel完整包(root, false), /未知文件/); unlinkSync(unknown);
  const file = join(root, '画布副本/web/index.html'), original = readFileSync(file);
  writeFileSync(file, 'changed'); assert.throws(() => 核验Excel完整包(root, false)); writeFileSync(file, original);
  renameSync(file, file + '.saved'); symlinkSync(file + '.saved', file);
  assert.throws(() => 核验Excel完整包(root, false), /拒绝源码链接/); unlinkSync(file); renameSync(file + '.saved', file);
});
test('半批接入被拒绝；事务故障恢复已修改文件并保留日志', () => {
  const modified = [...delta].filter(([, item]) => item.原文 !== null);
  const [path, item] = modified[0]; writeFileSync(join(root, path), item.产物);
  assert.throws(() => 核验Excel完整包(root, false)); assert.throws(() => 核验Excel完整包(root, true)); writeFileSync(join(root, path), item.原文);
  const snapshot = join(home, '故障快照');
  assert.throws(() => 事务写入(root, new Map(modified), snapshot, { 差异指纹: Excel差异SHA256,
    写入前(_path, count) { if (count === 2) throw Error('合成写入故障'); } }), /合成写入故障/);
  assert.equal(JSON.parse(readFileSync(join(snapshot, '事务.json'))).状态, '已回退');
  assert.equal(核验Excel完整包(root, false), true);
});
test('16项事务完整接入，新增父目录计入清单并拒绝错态', () => {
  事务写入(root, delta, join(home, '完整快照'), { 差异指纹: Excel差异SHA256, 写后检查() { 核验Excel完整包(root, true); } });
  assert.equal(核验Excel完整包(root, true), true); assert.throws(() => 核验Excel完整包(root, false));
  assert.equal(readFileSync(join(root, '画布副本/web/public/guan/Excel/SheetJS-LICENSE.txt'), 'utf8').includes('Apache'), true);
});
