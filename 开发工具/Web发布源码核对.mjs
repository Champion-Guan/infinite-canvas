import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '../扩展功能/客户安装/Web发布协议.mjs';

// 只核对真实构建输入；不把工作区、构建结果或开发机路径当作发布源码。
export function webSourceSnapshot(root) {
  const mapping = JSON.parse(readFileSync(join(root, '上游适配/开发源码映射.json')));
  const names = new Set(['上游适配/开发源码映射.json', '上游基线.json', '开发文档/Web发布版本.json', '开发文档/Web更新说明.md',
    '开发工具/装配开发源码.mjs', '开发工具/构建Web客户包.mjs', '开发工具/Web发布源码核对.mjs', '开发工具/清理Web构建缓存.mjs', '开发工具/Web构建占用保护.mjs', '开发工具/有界构建进程.mjs', '开发工具/构建Web前端.mjs',
    '开发工具/Web前端依赖.json', '开发工具/Web前端依赖锁.json', '开发工具/Web运行依赖.json', '开发工具/Web运行依赖锁.json']);
  for (const item of [...mapping.文件, ...mapping.接入补丁]) {
    const name = item.来源 || item.文件;
    assert.equal(sha256(readFileSync(join(root, name))), item.SHA256, '源码与映射不一致：' + name);
    names.add(name);
  }
  return Object.fromEntries([...names].sort().map(name => {
    assert.ok(!name.startsWith('/') && !name.split('/').includes('..'));
    const file = join(root, name), s = lstatSync(file);
    assert.ok(s.isFile() && !s.isSymbolicLink());
    return [name, sha256(readFileSync(file))];
  }));
}
export function assertWebReleaseSource(root, commit, expected) {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  assert.equal(git(['rev-parse', 'HEAD']), commit, '发布提交已变化');
  assert.equal(git(['status', '--porcelain', '--untracked-files=all']), '', '发布必须使用干净固定提交');
  assert.deepEqual(webSourceSnapshot(root), expected, '构建期间源码发生变化');
}
