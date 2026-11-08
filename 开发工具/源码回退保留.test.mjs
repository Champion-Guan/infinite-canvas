import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 读取源码回退, 轮换源码回退, 源码回退保留数量 } from './源码回退保留.mjs';

function fixture(t) {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), '源码轮换边界-')));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const root = join(temporary, '.运行/开发回退'); mkdirSync(root, { recursive: true });
  const snapshot = (index, { complete = true } = {}) => {
    const name = '源码-' + String(index).padStart(6, '0'), path = join(root, name);
    mkdirSync(path);
    for (const dir of ['扩展功能', '上游适配', '开发工具', '3100源']) mkdirSync(join(path, dir));
    if (complete) writeFileSync(join(path, '回退说明.json'), JSON.stringify({ date: new Date(Date.UTC(2026, 0, index)).toISOString(), restore: '恢复根源码，不覆盖数据库' }));
    return { name, path };
  };
  return { temporary, root, snapshot };
}

test('按快照完成时间仅保留最近五份，不按目录修改时间误删新版', t => {
  const { root, snapshot } = fixture(t);
  for (let n = 1; n <= 8; n++) { const item = snapshot(n); utimesSync(item.path, new Date(2026, 0, 10 - n), new Date(2026, 0, 10 - n)); }
  for (const name of ['整批迁移前工作区20261024', '第五预览版升级前工作区20261024', '2026-10-21T10-02-16-675Z', '源码-不属于工具生成']) mkdirSync(join(root, name));
  writeFileSync(join(root, '原始备份.json'), '必须保留');
  const report = 轮换源码回退(root);
  assert.equal(源码回退保留数量, 5);
  assert.deepEqual(report.retained.map(item => item.name), [8, 7, 6, 5, 4].map(n => '源码-' + String(n).padStart(6, '0')));
  assert.deepEqual(report.removed, ['源码-000003', '源码-000002', '源码-000001']);
  assert.equal(readdirSync(root).filter(name => /^源码-\d{6}$/.test(name)).length, 5);
  for (const name of ['整批迁移前工作区20261024', '第五预览版升级前工作区20261024', '2026-10-21T10-02-16-675Z', '源码-不属于工具生成', '原始备份.json']) assert.ok(existsSync(join(root, name)));
  assert.equal(JSON.parse(readFileSync(join(root, '源码轮换记录.json'))).limit, 5);
});

test('不足五份不删除；刚开始复制的未完成快照不计入可回退版本', t => {
  const { root, snapshot } = fixture(t);
  snapshot(1); snapshot(2); const partial = snapshot(3, { complete: false });
  assert.equal(轮换源码回退(root).removed.length, 0);
  assert.ok(existsSync(partial.path));
  assert.equal(读取源码回退(root).incomplete.length, 0);
  assert.deepEqual(读取源码回退(root, Date.now() + 2 * 86400_000).incomplete.map(item => item.name), [partial.name]);
});

test('最近五份有结构缺失时保留旧版本，说明损坏时也拒绝删除', t => {
  const { root, snapshot } = fixture(t);
  for (let n = 1; n <= 6; n++) snapshot(n);
  rmSync(join(root, '源码-000006/开发工具'), { recursive: true });
  assert.throws(() => 轮换源码回退(root));
  assert.ok(existsSync(join(root, '源码-000001')));
  mkdirSync(join(root, '源码-000006/开发工具'));
  writeFileSync(join(root, '源码-000006/回退说明.json'), '损坏JSON');
  assert.throws(() => 轮换源码回退(root));
  assert.ok(existsSync(join(root, '源码-000001')));
});

test('跳过快照符号链接，拒绝通过符号链接或其他目录清理', t => {
  const { temporary, root, snapshot } = fixture(t);
  for (let n = 1; n <= 6; n++) snapshot(n);
  const protectedPath = join(temporary, '真实工作区'); mkdirSync(protectedPath); writeFileSync(join(protectedPath, '数据.sqlite'), '原数据');
  symlinkSync(protectedPath, join(root, '源码-ZZZZZZ'), 'dir');
  轮换源码回退(root);
  assert.equal(readFileSync(join(protectedPath, '数据.sqlite'), 'utf8'), '原数据');
  assert.ok(existsSync(join(root, '源码-ZZZZZZ')));
  assert.throws(() => 轮换源码回退(protectedPath));
  const alternate = join(temporary, '旁路/.运行'); mkdirSync(alternate, { recursive: true }); symlinkSync(root, join(alternate, '开发回退'), 'dir');
  assert.throws(() => 轮换源码回退(join(alternate, '开发回退')));
});

test('连续新快照持续轮换至五份，重复执行不会误删保留版本', t => {
  const { root, snapshot } = fixture(t);
  for (let n = 1; n <= 5; n++) snapshot(n);
  assert.equal(轮换源码回退(root).removed.length, 0);
  snapshot(6); assert.deepEqual(轮换源码回退(root).removed, ['源码-000001']);
  assert.equal(轮换源码回退(root).removed.length, 0);
  assert.equal(读取源码回退(root).completed.length, 5);
});
