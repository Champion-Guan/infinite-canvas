import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 生成入口候选 } from './预审界面入口.mjs';
import { interfaceEntries } from '../扩展功能/产品配置/界面入口.ts';

test('所选入口默认关闭，不新增运行时开关或真实凭据', () => {
  assert.deepEqual(interfaceEntries, { configButton: false, authorGitHub: false, authorHeaderBrand: false, tabTitle: '' });
  assert.ok(Object.isFrozen(interfaceEntries));
});

test('候选只涉及4份展示文件和1份自有策略，不触及业务或数据', () => {
  const { 增量 } = 生成入口候选();
  assert.deepEqual([...增量.keys()], [
    'web/src/components/layout/user-status-actions.tsx',
    'web/src/components/layout/app-top-nav.tsx',
    'web/src/components/layout/app-providers.tsx',
    'web/index.html',
    'web/src/guan/界面入口.ts',
  ]);
  const actions = 增量.get('web/src/components/layout/user-status-actions.tsx').产物;
  assert.ok(actions.includes('{interfaceEntries.configButton && showConfig ? ('));
  assert.ok(actions.includes('{interfaceEntries.authorGitHub ? <GitHubLink'));
  assert.ok(actions.includes('openConfigDialog(false)'));
  assert.ok(actions.includes('{onOpenShortcuts ? ('));
  const header = 增量.get('web/src/components/layout/app-top-nav.tsx').产物;
  assert.ok(header.includes('{interfaceEntries.authorHeaderBrand ? <Link'));
  assert.ok(header.includes('<AppConfigModal />'));
  assert.ok(增量.get('web/src/components/layout/app-providers.tsx').产物.includes('document.title = interfaceEntries.tabTitle;'));
  const html = 增量.get('web/index.html').产物;
  assert.ok(html.includes('<link rel="icon" href="data:," />'));
  assert.ok(html.includes('<title></title>'));
  assert.ok(html.includes('localStorage.getItem("infinite-canvas:theme_store")'));
  assert.equal(增量.get('web/src/guan/界面入口.ts').产物, readFileSync(join(根目录, '扩展功能/产品配置/界面入口.ts'), 'utf8'));
});
