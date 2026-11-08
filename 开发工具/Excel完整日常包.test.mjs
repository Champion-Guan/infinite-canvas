import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, linkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { 根目录 } from './公共.mjs';
import { 核验Excel完整日常包, 核验Excel完整维护收据, Excel完整维护备份 } from './Excel完整日常运行.mjs';

const file = process.env.GUAN_EXCEL_COMPLETE_DAILY_MANIFEST;
assert.ok(file, '须指定本轮GUAN_EXCEL_COMPLETE_DAILY_MANIFEST；测试不访问正式数据或Keychain');
const original = readFileSync(file), sha = bytes => createHash('sha256').update(bytes).digest('hex'), expected = sha(original);
const root = mkdtempSync(join(根目录, '.运行/SQLiteExcel完整日常准备-'));
cpSync(dirname(file), root, { recursive: true, force: false, errorOnExist: true });
const manifest = join(root, '准备清单.json');
test('完整Excel组合、历史前置、事务快照和稳定助手来源通过', () => {
  assert.equal(核验Excel完整日常包(manifest, expected).manifest.protocol, 'guan-excel-complete-daily.v1');
});
test('伪造摘要、来源、差异和助手来源即使重算摘要也拒绝', () => {
  assert.throws(() => 核验Excel完整日常包(manifest, '0'.repeat(64)), /内容或指纹/);
  try {
    for (const key of ['integrationRecord', 'deltaSHA256', 'approvalManifestSHA256', 'baselinePath', 'baselineSHA', 'helperSourceSHA256', 'protocol']) {
      const value = JSON.parse(original); value[key] = 'synthetic';
      const bytes = JSON.stringify(value); writeFileSync(manifest, bytes);
      assert.throws(() => 核验Excel完整日常包(manifest, sha(bytes)), /内容或指纹|助手不符/);
    }
  } finally { writeFileSync(manifest, original); }
});
test('未知文件、空目录、链接和静态字节变化拒绝', () => {
  const unknown = join(root, '未知项'), directory = join(root, 'web/未知目录'), link = join(root, 'web/未知.svg');
  try { writeFileSync(unknown, 'synthetic'); assert.throws(() => 核验Excel完整日常包(manifest, expected), /内容或指纹/); }
  finally { unlinkSync(unknown); }
  try { mkdirSync(directory); assert.throws(() => 核验Excel完整日常包(manifest, expected), /内容或指纹/); }
  finally { rmdirSync(directory); }
  try { symlinkSync(join(root, 'web/logo.svg'), link); assert.throws(() => 核验Excel完整日常包(manifest, expected), /不安全/); }
  finally { unlinkSync(link); }
  const script = join(root, 'web/assets', readdirSync(join(root, 'web/assets')).find(name => name.endsWith('.js'))), bytes = readFileSync(script);
  try { writeFileSync(script, Buffer.concat([bytes, Buffer.from('\n')])); assert.throws(() => 核验Excel完整日常包(manifest, expected), /内容或指纹/); }
  finally { writeFileSync(script, bytes); }
});
test('无本轮维护确认或交互终端时，在正式数据与助手访问前拒绝', async () => {
  await assert.rejects(Excel完整维护备份(null), /需要本轮保存关闭确认/);
  const result = spawnSync(process.execPath, ['开发工具/Excel完整日常运行.mjs', '--启动', manifest, expected, '/tmp/untrusted.json', '0'.repeat(64), '--已保存并关闭'], { cwd: 根目录, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /需要当前保存关闭确认/);
  const backup = spawnSync(process.execPath, ['开发工具/Excel完整日常运行.mjs', '--维护备份', manifest, expected], { cwd: 根目录, encoding: 'utf8' });
  assert.notEqual(backup.status, 0); assert.match(backup.stderr, /本轮已确认/);
});
test('外部、伪造或路径不一致的维护收据不能触发正式读库', () => {
  assert.throws(() => 核验Excel完整维护收据('/tmp/untrusted.json', '0'.repeat(64), null), /路径不符/);
  const output = mkdtempSync(join(根目录, '.运行/output/Excel完整3100切换-')), receipt = join(output, '切换前备份.json');
  const bytes = JSON.stringify({ protocol: 'guan-excel-complete-maintenance.v1', passed: true });
  writeFileSync(receipt, bytes, { mode: 0o600, flag: 'wx' });
  assert.throws(() => 核验Excel完整维护收据(receipt, sha(bytes), { manifestPath: manifest, manifestSHA256: expected }), /内容不符/);
});

test('旧日常包不能冒充完整包，未知清单字段即使重算摘要也拒绝', () => {
  assert.throws(() => 核验Excel完整日常包(join(根目录, '.运行/SQLiteExcel日常准备-8jnfqt/准备清单.json'), '0'.repeat(64)), /路径不符/);
  try {
    const value = JSON.parse(original); value.unapproved = true;
    const bytes = JSON.stringify(value); writeFileSync(manifest, bytes);
    assert.throws(() => 核验Excel完整日常包(manifest, sha(bytes)), /内容或指纹/);
  } finally { writeFileSync(manifest, original); }
});
test('静态产物硬链接与清单硬链接拒绝，测试仅操作复制包', () => {
  const asset = join(root, 'web/logo.svg'), link = join(root, 'web/硬链接.svg'), receiptLink = join(root, '清单硬链接.json');
  try { linkSync(asset, link); assert.throws(() => 核验Excel完整日常包(manifest, expected), /不安全/); }
  finally { unlinkSync(link); }
  try { linkSync(manifest, receiptLink); assert.throws(() => 核验Excel完整日常包(manifest, expected), /不安全/); }
  finally { unlinkSync(receiptLink); }
});
