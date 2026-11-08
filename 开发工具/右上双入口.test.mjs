import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { 运行目录, 检查运行副本 } from './检查运行副本.mjs';
import { 生成双入口候选 } from './预审右上双入口.mjs';
import { 接入差异, 自有模块 } from '../上游适配/右上双入口关闭.mjs';
import { topRightEntries } from '../扩展功能/产品配置/右上双入口.ts';

test('策略只含本次两个入口，固定关闭且不可变', () => {
  assert.deepEqual(topRightEntries, { configButton: false, authorGitHub: false });
  assert.ok(Object.isFrozen(topRightEntries));
});

test('具体候选仅修改共享顶栏、增加策略模块，其他代码逐字不变', () => {
  const 候选 = 生成双入口候选();
  assert.deepEqual([...候选.keys()], [接入差异.文件, 自有模块.产物]);
  const { 原文, 产物 } = 候选.get(接入差异.文件);
  assert.ok(产物.includes('{topRightEntries.configButton && showConfig ? ('));
  assert.ok(产物.includes('{topRightEntries.authorGitHub ? <GitHubLink'));
  assert.ok(产物.includes('{onOpenShortcuts ? ('));
  assert.ok(产物.includes('openConfigDialog(false)'));
  let 还原 = 产物;
  for (const [前, 后] of [...接入差异.替换].reverse()) 还原 = 还原.replace(后, 前);
  assert.equal(还原, 原文);
});

test('预审不接入运行副本，不改独立首页、版权、配置存储或生成能力', () => {
  const 已接入 = 检查运行副本().右上双入口关闭已应用;
  const 候选 = 生成双入口候选();
  assert.equal(readFileSync(join(运行目录, 接入差异.文件), 'utf8'), 候选.get(接入差异.文件)[已接入 ? '产物' : '原文']);
  assert.equal(existsSync(join(运行目录, 自有模块.产物)), 已接入);
  assert.equal(候选.size, 2);
  assert.ok(!候选.has('web/src/guan/旧版首页顶栏.tsx'));
});
