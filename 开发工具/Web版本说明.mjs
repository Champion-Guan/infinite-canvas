import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareVersions, parseVersion } from '../扩展功能/软件更新/stable-version.mjs';

export function readWebReleaseDefinitions(root, parseChangelog) {
  const release = JSON.parse(readFileSync(join(root, '开发文档/Web发布版本.json'), 'utf8'));
  const releases = parseChangelog(readFileSync(join(root, '开发文档/Web更新说明.md'), 'utf8'));
  assert.ok(releases.length, 'Web更新说明缺少分类条目');
  assert.equal(releases[0].version, release.版本, 'Web更新说明与发布版本不一致');
  const versions = new Set();
  for (const item of releases) {
    assert.equal(parseVersion(item.version)?.version, item.version, 'Web版本历史不得混入开发草稿');
    assert.ok(!versions.has(item.version), 'Web版本历史存在重复版本');
    versions.add(item.version);
  }
  const history = JSON.parse(readFileSync(join(root, '开发文档/Web版本历史.json'), 'utf8'));
  assert.equal(history.format, 1, 'Web版本历史格式不符');
  assert.equal(history.repository, 'Champion-Guan/infinite-canvas', 'Web版本历史仓库不符');
  const archived = new Set();
  for (const item of history.releases) {
    assert.equal(parseVersion(item.version)?.version, item.version, 'Web版本历史不得混入开发草稿');
    assert.ok(!archived.has(item.version), 'Web版本历史存在重复版本');
    archived.add(item.version);
    assert.ok(Number.isSafeInteger(item.releaseId) && item.releaseId > 0 && Number.isFinite(Date.parse(item.publishedAt)), 'Web版本历史缺少发布身份');
    assert.equal(typeof item.notes, 'string', 'Web版本历史说明格式不符');
    if (versions.has(item.version)) continue;
    const items = parseChangelog(`## ${item.version}\n${item.notes}`)[0]?.items;
    releases.push({ version: item.version, date: item.publishedAt.slice(0, 10),
      items: items || [{ type: '更新', content: item.notes || '暂无更新说明' }] });
  }
  releases.sort((a, b) => compareVersions(b.version, a.version));
  return {
    __APP_VERSION__: JSON.stringify(release.版本),
    __APP_RELEASES__: JSON.stringify(releases),
  };
}
