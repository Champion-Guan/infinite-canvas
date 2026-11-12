import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readGitHubReleaseNotes(root) {
  const release = JSON.parse(readFileSync(join(root, '开发文档/Web发布版本.json'), 'utf8'));
  const visible = readFileSync(join(root, '开发文档/GitHub更新说明.md'), 'utf8').trim();
  assert.ok(visible.startsWith(`# AI-Workbench v${release.版本}\n`), 'GitHub说明标题必须匹配产品名与发布版本');
  assert.doesNotMatch(visible, /^[+*-]\s+\[(?:新增|优化|调整|修复|文档)\]/m, 'GitHub说明应使用分类标题，不显示应用内标签前缀');
  assert.doesNotMatch(visible, /<!--|-->/, 'GitHub正文不能混入兼容数据');
  const sections = visible.split(/^## /m);
  assert.ok(sections[0].trim().split(/\n\s*\n/).length > 1, 'GitHub说明缺少本版概述');
  for (const name of ['新增', '优化', '修复']) assert.ok(sections.some(section => section.startsWith(name + '\n')), 'GitHub说明缺少分类：' + name);
  for (const line of visible.split('\n').filter(line => /^- /.test(line)))
    assert.match(line, /^- \*\*[^*]+\*\*：.+/, 'GitHub功能条目应以粗体功能名说明入口、操作和结果');
  const application = readFileSync(join(root, '开发文档/Web更新说明.md'), 'utf8');
  assert.ok(application.startsWith(`## AI-Workbench v${release.版本} - `), '应用内说明版本不一致');
  const items = application.split('\n').filter(line => /^\+ \[[^\]]+\] /.test(line));
  assert.ok(items.length > 0 && items.every(line => !/<!--|-->/.test(line)), '应用内兼容条目缺失或无效');
  // 旧客户解析这些原条目；GitHub隐藏兼容区，仅展示上面的分组说明。
  return visible + '\n\n<!-- AI-Workbench 应用内时间线兼容条目\n' + items.join('\n') + '\n-->\n';
}
