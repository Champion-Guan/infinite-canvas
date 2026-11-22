import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('自动检查仅覆盖发布分支的提交与PR，且没有定时触发', () => {
  const ci = read('.github/workflows/ci.yml');
  const web = read('.github/workflows/Web源码检查.yml');
  assert.match(ci, /push:\s*\n\s+branches:\s*\[master,\s*main\]/);
  assert.match(ci, /pull_request:\s*\n\s+branches:\s*\[master,\s*main\]/);
  assert.match(ci, /workflow_call:/);
  assert.match(ci, /workflow_dispatch:/);
  assert.doesNotMatch(ci, /schedule:|branches:\s*\['\*\*'\]/);
  assert.match(web, /pull_request:\s*\n\s+branches:\s*\[master,\s*main\]/);
  assert.match(web, /workflow_dispatch:/);
});

test('预览版发布以本地固定源码和远端资产复核为门禁，不依赖Actions状态', () => {
  const publisher = read('开发工具/发布Web预览版.mjs');
  assert.doesNotMatch(publisher, /assertRemoteReleaseChecks|actions\/workflows|checkRemote/);
  assert.match(publisher, /assertWebReleaseSource/);
  assert.ok(publisher.indexOf("'release', 'create'") < publisher.indexOf("'release', 'download'"));
  assert.ok(publisher.indexOf("'release', 'download'") < publisher.indexOf("'--draft=false'"));
  assert.ok(publisher.lastIndexOf('assertWebReleaseSource') < publisher.indexOf("'--draft=false'"));
});
