import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { 装配开发源码, 清理旧挂载 } from './装配开发源码.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), '目录装配检查-')), root = join(directory, '项目'), upstream = join(directory, '上游');
  const write = (name, data) => { const file = join(root, name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data); };
  mkdirSync(upstream, { recursive: true });
  const git = args => execFileSync('git', args, { cwd: upstream, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init']); git(['config', 'user.name', '装配检查']); git(['config', 'user.email', 'fixture@example.invalid']);
  mkdirSync(join(upstream, 'web'), { recursive: true }); writeFileSync(join(upstream, 'web/入口.ts'), '原始接入\n');
  git(['add', '.']); git(['commit', '-m', '装配基线']); const commit = git(['rev-parse', 'HEAD']);
  const patch = 'diff --git a/web/入口.ts b/web/入口.ts\n--- a/web/入口.ts\n+++ b/web/入口.ts\n@@ -1 +1 @@\n-原始接入\n+新模块接入\n';
  write('上游基线.json', JSON.stringify({ 提交: commit, 目录: '../上游' }));
  write('扩展功能/测试模块.ts', '业务模块\n'); write('上游适配/模块接入.patch', patch);
  write('.运行/3100源/画布副本/web/src/guan/旧模块.ts', '旧模块\n');
  write('.运行/3100源/画布副本/web/入口.ts', '旧版接入\n');
  write('上游适配/开发源码映射.json', JSON.stringify({
    版本: 1, 基线: commit, 回退: '.运行/保留',
    文件: [{ 来源: '扩展功能/测试模块.ts', 目标: '画布副本/web/src/扩展功能/测试模块.ts', 类型: '前端', 原位置: '.运行/3100源/画布副本/web/src/guan/旧模块.ts', 原SHA256: hash('旧模块\n') }],
    接入差异: [{ 目标: 'web/入口.ts', 基线SHA256: hash('原始接入\n'), 原SHA256: hash('旧版接入\n') }],
    接入补丁: [{ 文件: '上游适配/模块接入.patch', 目标: 'web/入口.ts', SHA256: hash(patch), 前态SHA256: hash('原始接入\n'), 后态SHA256: hash('新模块接入\n') }],
  }));
  return { root, write, close: () => rmSync(directory, { recursive: true, force: true }) };
}
test('从锁定上游和小补丁重建；重复装配不写文件，检查结果一致', () => {
  const f = fixture(); try {
    const first = 装配开发源码({ root: f.root });
    assert.equal(first.更新, 2);
    assert.equal(readFileSync(join(f.root, '.运行/3100源/画布副本/web/入口.ts'), 'utf8'), '新模块接入\n');
    assert.equal(装配开发源码({ root: f.root }).更新, 0);
    assert.equal(装配开发源码({ root: f.root, checkOnly: true }).一致, true);
  } finally { f.close(); }
});
test('运行副本未知改动会阻止全部写入，不静默覆盖或部分装配', () => {
  const f = fixture(); try {
    f.write('.运行/3100源/画布副本/web/入口.ts', '未归并手工修改\n');
    assert.throws(() => 装配开发源码({ root: f.root }), /未归并改动/);
    assert.equal(existsSync(join(f.root, '.运行/3100源/画布副本/web/src/扩展功能/测试模块.ts')), false);
    assert.equal(readFileSync(join(f.root, '.运行/3100源/画布副本/web/入口.ts'), 'utf8'), '未归并手工修改\n');
  } finally { f.close(); }
});
test('验收前禁止清理；验收后只将已知旧挂载移入可回退保留', () => {
  const f = fixture(); try {
    const state = 装配开发源码({ root: f.root });
    assert.throws(() => 清理旧挂载({ root: f.root }), /验收记录尚未保存/);
    f.write('.运行/开发版3100/目录归并验收.json', JSON.stringify({ 通过: true, 源码指纹: state.指纹 }));
    const result = 清理旧挂载({ root: f.root });
    assert.equal(result.清理旧挂载, 1);
    assert.equal(readFileSync(join(result.可恢复保留, '.运行/3100源/画布副本/web/src/guan/旧模块.ts'), 'utf8'), '旧模块\n');
    assert.equal(existsSync(join(f.root, '.运行/3100源/画布副本/web/src/guan')), false);
  } finally { f.close(); }
});
