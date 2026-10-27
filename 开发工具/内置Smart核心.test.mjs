import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, chmod, utimes, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installBundledProxyCore } from '../扩展功能/网络代理/安装内置代理核心.mjs';
import { createMihomoRuntime, assertProxyPortsAvailable } from '../扩展功能/网络代理/内置代理运行.mjs';
import { randomInt } from 'node:crypto';
import { 启用Smart智能分组 } from '../扩展功能/网络代理/Smart智能分组.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), '内置核心验收-'));
  try {
    const source = join(root, '来源'), cache = join(root, '缓存'); await mkdir(source, { mode: 0o700 });
    const binary = Buffer.alloc(64); binary.writeUInt32LE(0xfeedfacf); binary.writeUInt32LE(0x0100000c, 4);
    const archive = gzipSync(binary), manifest = { platform: process.platform, arch: process.arch, size: binary.length, sha256: hash(binary), archiveSize: archive.length, archiveSha256: hash(archive) };
    await writeFile(join(source, '代理核心.gz'), archive, { mode: 0o600 });
    await writeFile(join(source, '核心清单.json'), JSON.stringify(manifest), { mode: 0o600 });
    await run({ source, cache, manifest });
  } finally { await rm(root, { recursive: true, force: true }); }
}
test('空缓存可离线安装；重复定位复用同一个核心，不产生重复副本', () => fixture(async ({ source, cache, manifest }) => {
  const first = await installBundledProxyCore(source, cache), second = await installBundledProxyCore(source, cache);
  assert.deepEqual(first, second); assert.equal(hash(await readFile(first.path)), manifest.sha256);
  assert.deepEqual(await readdir(join(cache, '版本')), [manifest.sha256]);
}));
test('拒绝压缩包篡改，不留下可执行半成品', () => fixture(async ({ source, cache }) => {
  await writeFile(join(source, '代理核心.gz'), '篡改', { mode: 0o600 });
  await assert.rejects(installBundledProxyCore(source, cache), { code: 'proxy_core_invalid' });
}));
test('拒绝缓存篡改，并只回收自己约定的旧核心目录', () => fixture(async ({ source, cache }) => {
  const first = await installBundledProxyCore(source, cache);
  for (let n = 1; n <= 3; n++) {
    const folder = join(cache, '版本', String(n).repeat(64)); await mkdir(folder, { mode: 0o700 });
    await writeFile(join(folder, 'mihomo'), 'old', { mode: 0o700 }); await utimes(folder, n, n);
  }
  const unknown = join(cache, '客户配置'); await mkdir(unknown, { mode: 0o700 });
  await installBundledProxyCore(source, cache);
  assert.deepEqual((await readdir(join(cache, '版本'))).sort(), [first.sha256, '3'.repeat(64)].sort());
  assert.ok((await readdir(cache)).includes('客户配置'));
  await chmod(first.path, 0o600); await writeFile(first.path, 'changed'); await chmod(first.path, 0o700);
  await assert.rejects(installBundledProxyCore(source, cache), { code: 'proxy_core_invalid' });
}));
test('实际内置资产是固定来源的 Smart arm64 核心，压缩包兼容 beta9 单文件限制', { skip: process.platform !== 'darwin' || process.arch !== 'arm64' }, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'Smart实核验收-')));
  try {
    const source = fileURLToPath(new URL('../界面资源/网络代理核心/', import.meta.url));
    const manifest = JSON.parse(await readFile(join(source, '核心清单.json')));
    assert.equal(manifest.variant, 'Mihomo Smart'); assert.ok(manifest.archiveSize < 32 * 1024 ** 2);
    assert.match(manifest.sourceCode, /^https:\/\/github.com\/vernesong\/mihomo\/tree\/[a-f0-9]{40}$/);
    const installed = await installBundledProxyCore(source, root);
    assert.match(execFileSync(installed.path, ['-v'], { encoding: 'utf8', timeout: 10000 }), /alpha-smart-4624551 darwin arm64/);
    assert.match(await readFile(join(source, '开源许可.txt'), 'utf8'), /GNU GENERAL PUBLIC LICENSE/);
    assert.ok(installed.model); assert.equal(hash(await readFile(installed.model.path)), manifest.model.sha256);
    let port;
    for (let i = 0; i < 30; i++) { const candidate = randomInt(24000, 48000); try { await assertProxyPortsAvailable(candidate); port = candidate; break; } catch {} }
    assert.ok(port);
    const runtime = createMihomoRuntime({ core: installed, runtimeParent: join(root, '运行'), port });
    const handle = await runtime.start('proxies:\n  - {name: 本机测试节点, type: socks5, server: 127.0.0.1, port: 1}\n');
    try {
      assert.deepEqual(handle.smartStatus(), { enabled: true, groups: 1, modelBundled: true });
      const groups = await handle.inspect(); assert.ok(groups.some(group => group.type === 'Smart'));
      assert.ok(groups.find(group => group.type === 'Selector').choices.some(name => name.includes('Smart')));
    } finally { await handle.stop(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('智能组成为原规则的默认路径，保留手动节点、规则及节点范围，不启用训练采集或自动模型下载', () => {
  const input = { proxies: [{ name: '节点A' }, { name: '节点B' }], 'proxy-groups': [{ name: '自动', type: 'url-test', proxies: ['节点A', '节点B'] }, { name: '主线路', type: 'select', proxies: ['自动', '节点B', 'DIRECT'] }], rules: ['DOMAIN,example.com,DIRECT', 'MATCH,主线路'] };
  const before = JSON.stringify(input), output = 启用Smart智能分组(input);
  assert.equal(JSON.stringify(input), before); assert.deepEqual(output.rules, input.rules); assert.deepEqual(output.proxies, input.proxies);
  assert.equal(output['lgbm-auto-update'], false);
  for (const original of input['proxy-groups']) {
    const entry = output['proxy-groups'].find(group => group.name === original.name), smart = output['proxy-groups'].find(group => group.name === entry.proxies[0]);
    assert.equal(entry.type, 'select'); assert.equal(smart.type, 'smart'); assert.equal(smart.uselightgbm, true); assert.equal(smart.collectdata, false);
    assert.deepEqual(smart.proxies, original.proxies.filter(name => name !== 'DIRECT'));
    assert.deepEqual(entry.proxies.slice(1), original.proxies);
  }
});
