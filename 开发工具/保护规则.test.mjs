import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 检查仓库 } from './公共.mjs';

test('保护规则拒绝未审查的上游改动，不写入真实上游', () => {
  const 目录 = mkdtempSync(join(tmpdir(), 'guan-guard-'));
  const git = (...args) => execFileSync('git', ['-C', 目录, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '-b', 'main');
    writeFileSync(join(目录, '原版.txt'), '原作者源码\n');
    git('add', '原版.txt');
    git('-c', 'user.name=Guard Test', '-c', 'user.email=guard@example.invalid', 'commit', '-m', 'test baseline');
    const 提交 = git('rev-parse', 'HEAD');
    assert.doesNotThrow(() => 检查仓库(目录, 提交));
    assert.throws(() => 检查仓库(目录, '0'.repeat(40)), /基线不一致/);
    writeFileSync(join(目录, '原版.txt'), '误改\n');
    assert.throws(() => 检查仓库(目录, 提交), /原作者目录有改动/);
    assert.equal(git('-c', 'core.quotePath=false', 'diff', '--name-only'), '原版.txt');
    writeFileSync(join(目录, '原版.txt'), '原作者源码\n');
    writeFileSync(join(目录, '误放的扩展.txt'), '扩展\n');
    assert.throws(() => 检查仓库(目录, 提交), /原作者目录有改动/);
  } finally {
    // 仅移除本测试通过 mkdtemp 创建的临时仓库，绝不指向真实项目。
    rmSync(目录, { recursive: true, force: true });
  }
});
