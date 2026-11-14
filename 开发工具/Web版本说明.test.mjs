import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChangelog } from '../.运行/3100源/画布副本/web/src/lib/release.ts';
import { readWebReleaseDefinitions } from './Web版本说明.mjs';
import { collectWebReleaseHistory } from './同步Web版本历史.mjs';
import { webReleaseCodeBranch } from './Web发布源码核对.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function fixture(t, notes, version = '2.0.0-beta.27') {
  const directory = mkdtempSync(join(root, '.运行/版本说明测试-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, '开发文档'));
  writeFileSync(join(directory, '开发文档/Web发布版本.json'), JSON.stringify({ 版本: version }));
  writeFileSync(join(directory, '开发文档/Web更新说明.md'), notes);
  writeFileSync(join(directory, '开发文档/Web版本历史.json'), JSON.stringify({ format: 1, repository: 'Champion-Guan/infinite-canvas', releases: [] }));
  return directory;
}

test('离线版本说明使用客户发布来源，保留分类和日期，不携带开发草稿与作者历史', () => {
  const definitions = readWebReleaseDefinitions(root, parseChangelog);
  const releases = JSON.parse(definitions.__APP_RELEASES__);
  assert.deepEqual(releases[0], parseChangelog(readFileSync(join(root, '开发文档/Web更新说明.md'), 'utf8'))[0]);
  assert.equal(releases[0].version, JSON.parse(definitions.__APP_VERSION__));
  assert.ok(releases[0].items.length);
  assert.ok(releases.every(item => item.version !== 'Unreleased'));
  assert.ok(!definitions.__APP_RELEASES__.includes('按用户要求暂停节点和连线动效迁移'));
  const history = JSON.parse(readFileSync(join(root, '开发文档/Web版本历史.json'), 'utf8'));
  assert.ok(history.releases.length > 1);
  assert.deepEqual(new Set(releases.map(item => item.version)), new Set([
    JSON.parse(definitions.__APP_VERSION__), ...history.releases.map(item => item.version),
  ]));
});

test('版本号不匹配、开发草稿、空说明和重复版本在构建前明确拒绝', t => {
  assert.throws(() => readWebReleaseDefinitions(fixture(t, '## 2.0.0-beta.26\n+ [修复] 旧说明'), parseChangelog), /发布版本不一致/);
  assert.throws(() => readWebReleaseDefinitions(fixture(t, '## 2.0.0-beta.27\n+ [修复] 正确说明\n## Unreleased\n+ [新增] 开发草稿'), parseChangelog), /开发草稿/);
  assert.throws(() => readWebReleaseDefinitions(fixture(t, '## 2.0.0-beta.27\n没有分类条目'), parseChangelog), /缺少分类条目/);
  assert.throws(() => readWebReleaseDefinitions(fixture(t, '## 2.0.0-beta.27\n+ [修复] 第一份\n## 2.0.0-beta.27\n+ [修复] 第二份'), parseChangelog), /重复版本/);
});

test('真实客户历史按原顺序保留，不通过猜测把开发草稿改成已发布版本', t => {
  const directory = fixture(t, '## 2.0.0-beta.27 - 2026-11-08\n+ [优化] 当前版\n## 2.0.0-beta.26 - 2026-11-08\n+ [修复] 前一版');
  const definitions = readWebReleaseDefinitions(directory, parseChangelog);
  assert.deepEqual(JSON.parse(definitions.__APP_RELEASES__).map(({ version, date }) => ({ version, date })), [
    { version: '2.0.0-beta.27', date: '2026-11-08' },
    { version: '2.0.0-beta.26', date: '2026-11-08' },
  ]);
});

test('GitHub历史保留已发布Beta和Stable，即使旧安装资产已撤下；草稿和作者版本不混入', () => {
  const release = (version, id, options = {}) => ({ tag_name: 'web-v' + version, id, draft: false,
    prerelease: version.includes('-'), published_at: '2026-11-08T10:30:10Z', body: '+ [修复] 说明', ...options });
  const result = collectWebReleaseHistory([
    release('2.0.0-beta.9', 9), release('2.0.0-beta.10', 10), release('2.0.0', 28),
    release('2.0.0-beta.28', 29, { draft: true }), release('2.0.0-beta.29', 30, { published_at: null }),
    release('2.0.0-beta.30', 31, { prerelease: false }), release('0.19.0', 1, { tag_name: 'v0.19.0' }),
  ]);
  assert.deepEqual(result.releases.map(item => item.version), ['2.0.0', '2.0.0-beta.10', '2.0.0-beta.9']);
});

test('离线历史合并去重，旧版非分类说明原文保留，当前版仍使用当前发布说明', t => {
  const directory = fixture(t, '## 2.0.0-beta.27 - 2026-11-08\n+ [修复] 当前完整说明');
  const record = (version, notes, id) => ({ version, notes, releaseId: id, publishedAt: '2026-11-01T10:00:00Z' });
  writeFileSync(join(directory, '开发文档/Web版本历史.json'), JSON.stringify({ format: 1, repository: 'Champion-Guan/infinite-canvas',
    releases: [record('2.0.0-beta.9', '# 旧说明\n- 原始段落', 9), record('2.0.0-beta.27', '+ [修复] 旧摘要', 27),
      record('2.0.0-beta.10', '+ [新增] 历史功能', 10)] }));
  const releases = JSON.parse(readWebReleaseDefinitions(directory, parseChangelog).__APP_RELEASES__);
  assert.deepEqual(releases.map(item => item.version), ['2.0.0-beta.27', '2.0.0-beta.10', '2.0.0-beta.9']);
  assert.deepEqual(releases.map(item => item.items), [
    [{ type: '修复', content: '当前完整说明' }], [{ type: '新增', content: '历史功能' }], [{ type: '更新', content: '# 旧说明\n- 原始段落' }],
  ]);
});

test('下一版构建保留全部已发布历史，不要求提前公开当前版本', t => {
  const directory = fixture(t, '## 2.0.0-beta.28\n+ [修复] 本轮说明', '2.0.0-beta.28');
  writeFileSync(join(directory, '开发文档/Web版本历史.json'), JSON.stringify({ format: 1, repository: 'Champion-Guan/infinite-canvas',
    releases: [{ version: '2.0.0-beta.27', notes: '+ [优化] 已发布功能', releaseId: 27, publishedAt: '2026-11-08T10:30:10Z' }] }));
  assert.deepEqual(JSON.parse(readWebReleaseDefinitions(directory, parseChangelog).__APP_RELEASES__).map(item => item.version),
    ['2.0.0-beta.28', '2.0.0-beta.27']);
});

test('AI-Workbench标题与功能文案按原条目结构读取，不改变应用内日志版式', t => {
  const notes = '## AI-Workbench v2.0.0-beta.29 - 2026-11-12\n\n本版完善策划恢复。\n\n+ [新增] **图片引用**：点击可看原图。\n+ [修复] **原任务恢复**：沿用已有结果。';
  const directory = fixture(t, notes, '2.0.0-beta.29');
  const first = JSON.parse(readWebReleaseDefinitions(directory, parseChangelog).__APP_RELEASES__)[0];
  assert.deepEqual(first, { version: '2.0.0-beta.29', date: '2026-11-12',
    items: [{ type: '新增', content: '图片引用：点击可看原图。' },
      { type: '修复', content: '原任务恢复：沿用已有结果。' }] });
  writeFileSync(join(directory, '开发文档/Web发布版本.json'), JSON.stringify({ 产品名称: 'AI-Workbench', 版本: '2.0.0-beta.29' }));
  assert.doesNotThrow(() => readWebReleaseDefinitions(directory, parseChangelog));
  writeFileSync(join(directory, '开发文档/Web更新说明.md'), notes.replace('AI-Workbench v', '生图工作台 Web '));
  assert.throws(() => readWebReleaseDefinitions(directory, parseChangelog), /标题必须使用AI-Workbench/);
});

test('当前发布遵循产品名称和功能日志规范，发布工具不再写旧标题', () => {
  const release = JSON.parse(readFileSync(join(root, '开发文档/Web发布版本.json')));
  const notes = readFileSync(join(root, '开发文档/Web更新说明.md'), 'utf8');
  assert.equal(release.产品名称, 'AI-Workbench');
  assert.ok(notes.startsWith(`## AI-Workbench v${release.版本} - `));
  const current = parseChangelog(notes)[0];
  assert.ok(current.items.length > 5);
  assert.ok(current.items.every(item => !item.content.includes('**') && !Object.hasOwn(item, 'group')));
  assert.ok(notes.split('\n').filter(line => line.startsWith('+ ')).every(line => /^\+ \[[^\]]+\] [^*\s]/.test(line)));
  assert.doesNotMatch(notes, /^### /m);
  const publisher = readFileSync(join(root, '开发工具/发布Web预览版.mjs'), 'utf8');
  assert.match(publisher, /'AI-Workbench v' \+ record.version/);
  assert.doesNotMatch(publisher, /'生图工作台 Web '/);
});

test('Beta代码发布到master，Stable代码发布到main，其他预发布类型不混用', () => {
  assert.equal(webReleaseCodeBranch('2.0.0-beta.29'), 'master');
  assert.equal(webReleaseCodeBranch('2.0.0'), 'main');
  for (const version of ['2.0.0-alpha.1', '2.0.0-rc.1', 'Unreleased', 'v2.0.0'])
    assert.throws(() => webReleaseCodeBranch(version));
});
