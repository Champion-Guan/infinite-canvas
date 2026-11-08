import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { 解析实机参数, 检查测试根, 冷子进程环境 } from './执行钥匙串实机验收.mjs';

// 本文件仅测输入/路径防护，导入验收工具不会访问Keychain。
const hash = '0'.repeat(64), args = ['--运行包=synthetic', '--清单指纹=' + hash, '--批准新建测试项'];
test('独立进程保留规范化macOS临时目录，不继承密钥或整个父环境', () => {
  const env = 冷子进程环境(); assert.deepEqual(Object.keys(env).sort(), ['LANG', 'PATH', 'TMPDIR']);
  assert.equal(env.TMPDIR, realpathSync(tmpdir()));
});
test('实机验收仅接受明确批准和固定运行包指纹，不接受任意助手/数据根/账号覆盖', () => {
  assert.deepEqual(解析实机参数(args), { path: 'synthetic', sha256: hash });
  for (const value of [[], args.slice(0, 2), [...args, '--account=existing'], ['--运行包=', args[1], args[2]],
    [args[0], '--清单指纹=bad', args[2]], [args[0], args[1], '--批准新建测试项=false'], [args[1], args[0], args[2]]]) assert.throws(() => 解析实机参数(value));
});
function fixture() {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'guan-keychain-live-'));
  const dataRoot = join(parent, '数据'), workspaceId = randomUUID(), recordPath = join(parent, '新建测试项.json');
  mkdirSync(dataRoot, { mode: 0o700 });
  const record = { protocol: 'guan-keychain-live-test.v1', scope: 'new-test-item-only', dataRoot, workspaceId };
  writeFileSync(join(dataRoot, '.工作区.json'), JSON.stringify({ workspaceId }), { mode: 0o600 });
  writeFileSync(recordPath, JSON.stringify(record), { mode: 0o600 });
  return { parent, dataRoot, workspaceId, recordPath, record };
}
test('仅接收系统临时目录的新测试登记及匹配的随机UUID', () => {
  const f = fixture(); assert.deepEqual(检查测试根(f.recordPath), f.record);
  for (const path of ['/Users/test/Library/Application Support/工作区/新建测试项.json', 'relative', join(f.parent, 'other.json')]) assert.throws(() => 检查测试根(path));
});
test('工作区身份、测试范围或数据根变化时拒绝，未调用系统助手', () => {
  for (const kind of ['workspace', 'scope', 'dataRoot', 'protocol', 'id']) {
    const f = fixture(), record = { ...f.record };
    if (kind === 'workspace') writeFileSync(join(f.dataRoot, '.工作区.json'), JSON.stringify({ workspaceId: randomUUID() }));
    if (kind === 'scope') record.scope = 'existing';
    if (kind === 'dataRoot') record.dataRoot = '/existing';
    if (kind === 'protocol') record.protocol = 'unknown';
    if (kind === 'id') record.workspaceId = '../existing';
    writeFileSync(f.recordPath, JSON.stringify(record)); assert.throws(() => 检查测试根(f.recordPath));
  }
});
test('测试登记符号链接被拒绝，不修改目标', () => {
  const f = fixture(), parent = mkdtempSync(join(realpathSync(tmpdir()), 'guan-keychain-live-'));
  const path = join(parent, '新建测试项.json'); symlinkSync(f.recordPath, path); assert.throws(() => 检查测试根(path));
  assert.equal(检查测试根(f.recordPath).workspaceId, f.workspaceId);
});
