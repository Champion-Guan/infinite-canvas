import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { 根目录 } from './公共.mjs';
import { 构建临时媒体策略候选, 临时媒体策略候选, 加载临时媒体策略预审启动器, 预审SQLite临时媒体策略, 启动器路径 } from './预审SQLite临时媒体策略.mjs';
import { startIsolatedAuthorizedWorkbench as startOriginal } from '../扩展功能/本机服务/受限工作台启动器.mjs';
import { AUTHORIZATION_PROTOCOL } from '../扩展功能/本机服务/本机授权网关.mjs';
import { 建立SQLite写入协调隔离服务, 加载SQLite写入协调隔离服务 } from './接入SQLite写入协调隔离服务.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const roots = [];
function raw(origin, headers) {
  return new Promise((done, fail) => {
    const url = new URL(origin), req = request({ hostname: url.hostname, port: url.port, path: '/', headers }, res => {
      res.resume(); res.on('end', () => done(res.statusCode));
    }); req.on('error', fail); req.end();
  });
}

test('单文件候选只增加connect-src blob:；旧启动器及9文件来源指纹保持不变', () => {
  const delta = 构建临时媒体策略候选(), item = delta.get(启动器路径), manifest = 预审SQLite临时媒体策略();
  assert.equal(delta.size, 1); assert.equal(manifest.文件.length, 1);
  assert.equal(sha(item.原文), '228feb63b1ee2a24ddfe18d61366507e3066a868aadb0ba6e3e597ac3f16f98c');
  assert.equal(item.产物.replace("connect-src 'self' blob:", "connect-src 'self'"), item.原文);
  assert.equal(readFileSync(join(根目录, 启动器路径), 'utf8'), item.原文);
  const entry = readFileSync(join(根目录, '扩展功能/本机存储/工作台授权入口.mjs'), 'utf8');
  assert.ok(entry.includes("url.protocol !== 'blob:' || url.origin !== origin"));
});

test('锚点缺失、重复或已为后态时拒绝，不能重复添加或静默改其他策略', () => {
  const { 原文, 产物 } = 构建临时媒体策略候选().get(启动器路径);
  assert.throws(() => 临时媒体策略候选(原文.replace("connect-src 'self'", "connect-src 'none'")), /锚点/);
  assert.throws(() => 临时媒体策略候选(原文 + 原文), /锚点/);
  assert.throws(() => 临时媒体策略候选(产物), /锚点/);
});

test('内存HTTP候选仅改变blob连接项，精确数据服务、脚本哈希、其他全部CSP指令不变', async () => {
  const root = mkdtempSync(join(tmpdir(), 'guan-stage6-media-policy-')); roots.push(root);
  const webRoot = join(root, '可信合成静态包'); mkdirSync(webRoot);
  writeFileSync(join(webRoot, 'index.html'), '<!doctype html><script>document.title="隔离策略预审";</script><main>不是工作台运行副本</main>');
  const serviceIntegration = 建立SQLite写入协调隔离服务(), storage = await 加载SQLite写入协调隔离服务(serviceIntegration);
  const { startIsolatedAuthorizedWorkbench: startCandidate } = await 加载临时媒体策略预审启动器();
  const normalized = [];
  for (const [index, start] of [startOriginal, startCandidate].entries()) {
    let dataURL;
    const app = await start({ webRoot, dataRoot: join(root, '数据-' + index), initialize: true, storage: { ...storage,
      async startDataService(options) { const service = await storage.startDataService(options); dataURL = service.url; return service; } } });
    try {
      const home = await fetch(app.origin), csp = home.headers.get('content-security-policy');
      assert.equal(home.status, 200); assert.equal(home.headers.get('set-cookie'), null);
      const connection = csp.split(';').map(value => value.trim()).find(value => value.startsWith('connect-src '));
      assert.equal(connection, `connect-src 'self' ${index ? 'blob: ' : ''}${dataURL}`);
      assert.doesNotMatch(connection, /\*|data:|https:|unsafe/);
      assert.equal(app.getStatus().backup.lastBackup.reason, 'startup');
      assert.equal((await fetch(app.origin + '/__guan-local/issue')).status, 403);
      assert.equal((await fetch(app.origin + '/__guan-local/issue', { method: 'POST', headers: {
        Origin: app.origin, 'Content-Type': 'application/json', 'X-Guan-Local-Protocol': AUTHORIZATION_PROTOCOL,
      }, body: '{}' })).status, 404);
      for (const headers of [{ Host: 'evil.invalid' }, { Origin: 'http://evil.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal(await raw(app.origin, headers), 403);
      normalized.push(csp.replace(dataURL, '<本实例数据服务>'));
    } finally { await app.close(); }
  }
  assert.equal(normalized[1].replace("connect-src 'self' blob:", "connect-src 'self'"), normalized[0]);
  assert.equal(sha(readFileSync(join(根目录, 启动器路径))), '228feb63b1ee2a24ddfe18d61366507e3066a868aadb0ba6e3e597ac3f16f98c');
});

test.after(() => console.log(JSON.stringify({ syntheticPolicyReviewRoots: roots, candidateOnly: true, browserMediaNotYetVerified: true, real3100Untouched: true })));
