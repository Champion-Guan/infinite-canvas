import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGitHubReleaseNotes } from './GitHub发布说明.mjs';
import { parseChangelog } from '../.运行/3100源/画布副本/web/src/lib/release.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const version = JSON.parse(readFileSync(join(root, '开发文档/Web发布版本.json'))).版本;
test('GitHub可见说明按图示分类，兼容现有客户的原时间线条目', () => {
  const output = readGitHubReleaseNotes(root);
  const visible = output.replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(visible.startsWith('# AI-Workbench v' + version + '\n'));
  for (const section of ['新增', '优化', '修复', '使用说明']) assert.ok(visible.includes('\n## ' + section + '\n'));
  assert.doesNotMatch(visible, /\[(新增|优化|调整|修复|文档)\]/);
  assert.match(visible, /^- \*\*[^*]+\*\*：.+/m);
  const original = readFileSync(join(root, '开发文档/Web更新说明.md'), 'utf8');
  assert.deepEqual(parseChangelog('## ' + version + '\n' + output)[0].items, parseChangelog(original)[0].items);
  assert.equal(output.match(/<!--/g).length, 1);
});

test('误用标签列表、缺少概述或分类、版本不符时拒绝发布', t => {
  const directory = mkdtempSync(join(tmpdir(), 'GitHub说明检查-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, '开发文档'));
  for (const name of ['Web发布版本.json', 'Web更新说明.md'])
    writeFileSync(join(directory, '开发文档', name), readFileSync(join(root, '开发文档', name)));
  const source = readFileSync(join(root, '开发文档/GitHub更新说明.md'), 'utf8');
  for (const invalid of [
    source.replace('AI-Workbench v' + version, 'AI-Workbench v0.0.0'),
    source.replace(/^- \*\*([^*]+)\*\*/m, '+ [新增] **$1**'),
    source.replace('## 修复\n', '## 其他\n'),
    source.replace(/\n\n本次[\s\S]*?(?=\n\n## 新增)/, ''),
  ]) {
    writeFileSync(join(directory, '开发文档/GitHub更新说明.md'), invalid);
    assert.throws(() => readGitHubReleaseNotes(directory));
  }
});

test('发布入口使用GitHub专用说明，应用内分类来源继续保留', () => {
  const publisher = readFileSync(join(root, '开发工具/发布Web预览版.mjs'), 'utf8');
  assert.match(publisher, /readGitHubReleaseNotes\(root\)/);
  assert.doesNotMatch(publisher, /writeFile\(notes, await readFile\(join\(root, '开发文档\/Web更新说明.md'/);
  assert.match(readFileSync(join(root, '开发工具/Web版本说明.mjs'), 'utf8'), /开发文档\/Web更新说明.md/);
});
