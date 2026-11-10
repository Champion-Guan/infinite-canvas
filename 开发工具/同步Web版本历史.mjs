import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptsWebRelease } from '../扩展功能/软件更新/更新发布渠道.mjs';
import { compareVersions } from '../扩展功能/软件更新/stable-version.mjs';

export function collectWebReleaseHistory(rows) {
  const versions = new Set(), releases = [];
  for (const row of rows) {
    if (!acceptsWebRelease(row, { developerMode: true }) || !Number.isSafeInteger(row.id) ||
        row.id < 1 || !row.published_at || !Number.isFinite(Date.parse(row.published_at))) continue;
    const version = row.tag_name.slice('web-v'.length);
    assert.ok(!versions.has(version), 'Web发布历史有重复版本');
    versions.add(version);
    releases.push({ version, publishedAt: new Date(row.published_at).toISOString(), releaseId: row.id, notes: String(row.body || '') });
  }
  return { format: 1, repository: 'Champion-Guan/infinite-canvas',
    releases: releases.sort((a, b) => compareVersions(b.version, a.version)) };
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const pages = JSON.parse(execFileSync('gh', ['api', '--paginate', '--slurp', 'repos/Champion-Guan/infinite-canvas/releases?per_page=100'],
    { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
  const history = collectWebReleaseHistory(pages.flat());
  assert.ok(history.releases.length, '未读取到已发布Web版本，保留现有历史');
  writeFileSync(join(root, '开发文档/Web版本历史.json'), JSON.stringify(history, null, 2) + '\n');
  console.log(JSON.stringify({ versions: history.releases.length, newest: history.releases[0].version,
    oldest: history.releases.at(-1).version }));
}
