import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMacOSMasterKeyProvider } from '../扩展功能/本机凭据/钥匙串主密钥.mjs';

const code = expected => error => error?.code === expected;
const roots = [];
function fixture(response = (id, material) => ({ protocol: 'guan-keychain-master.v1', workspaceId: id, material: material.toString('base64') }), { closeCode = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'guan-keychain-wire-')); roots.push(root);
  const helper = join(root, 'fake-helper'), bytes = Buffer.from('not executable test fixture; never spawned');
  writeFileSync(helper, bytes, { flag: 'wx', mode: 0o700 });
  const material = randomBytes(32), requests = [], options = [];
  function spawnImpl(path, args, config) {
    assert.equal(path.endsWith('/fake-helper'), true); assert.deepEqual(args, []); options.push(config);
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.kill = () => {};
    child.stdin = new Writable({ write(chunk, _encoding, done) { requests.push(JSON.parse(chunk.toString())); done(); } });
    child.stdin.once('finish', () => queueMicrotask(() => {
      const value = response(requests.at(-1).workspaceId, material);
      child.stdout.write(typeof value === 'string' ? value : JSON.stringify(value)); child.emit('close', closeCode);
    }));
    return child;
  }
  return { root, helper, requests, options, material,
    provider: createMacOSMasterKeyProvider({ helperPath: helper, helperSHA256: createHash('sha256').update(bytes).digest('hex'), spawnImpl }) };
}

test('仅经stdin与stdout交换材料，argv/env不带密钥/账号，返回32字节副本', async () => {
  const f = fixture(), workspaceId = randomUUID();
  assert.deepEqual(await f.provider.create(workspaceId), f.material); assert.deepEqual(await f.provider.read(workspaceId), f.material);
  assert.deepEqual(f.requests, [{ protocol: 'guan-keychain-master.v1', operation: 'create', workspaceId }, { protocol: 'guan-keychain-master.v1', operation: 'read', workspaceId }]);
  for (const options of f.options) {
    assert.equal(options.shell, false); assert.deepEqual(options.stdio, ['pipe', 'pipe', 'ignore']);
    assert.deepEqual(Object.keys(options.env).sort(), ['LANG', 'PATH']);
    assert.equal(JSON.stringify(options).includes(f.material.toString('base64')), false);
    assert.equal(JSON.stringify(options).includes(workspaceId), false);
  }
});

for (const failure of ['protocol', 'workspace', 'short', 'extra', 'invalid-json', 'oversize', 'exit']) test('拒绝异常助手响应且不回显内容：' + failure, async () => {
  const f = fixture((id, material) => {
    if (failure === 'invalid-json') return 'DO-NOT-LEAK-synthetic';
    if (failure === 'oversize') return 'x'.repeat(2048);
    return { protocol: failure === 'protocol' ? 'other' : 'guan-keychain-master.v1', workspaceId: failure === 'workspace' ? randomUUID() : id,
      material: (failure === 'short' ? Buffer.alloc(31) : material).toString('base64'), ...(failure === 'extra' ? { extra: 'DO-NOT-LEAK-synthetic' } : {}) };
  }, { closeCode: failure === 'exit' ? 1 : 0 });
  await assert.rejects(f.provider.read(randomUUID()), error => error.code === 'keychain_unavailable' && !error.message.includes('DO-NOT-LEAK'));
});

test('拒绝非法工作区、并发启动、改变/链接/过宽权限助手，均不调用真实Keychain', async () => {
  const f = fixture(); await assert.rejects(f.provider.read('../old'), code('invalid_credential_config'));
  const first = f.provider.read(randomUUID()); await assert.rejects(f.provider.read(randomUUID()), code('keychain_busy')); await first;
  chmodSync(f.helper, 0o722); await assert.rejects(f.provider.read(randomUUID()), code('invalid_keychain_helper')); chmodSync(f.helper, 0o700);
  writeFileSync(f.helper, 'modified fixture'); await assert.rejects(f.provider.read(randomUUID()), code('invalid_keychain_helper'));
  const link = join(f.root, 'linked'); symlinkSync(f.helper, link);
  const linked = createMacOSMasterKeyProvider({ helperPath: link, helperSHA256: '0'.repeat(64), spawnImpl: () => { throw Error('不能调用'); } });
  await assert.rejects(linked.read(randomUUID()), code('invalid_keychain_helper'));
  const missing = createMacOSMasterKeyProvider({ helperPath: join(f.root, 'missing'), helperSHA256: '0'.repeat(64), spawnImpl: () => { throw Error('不能调用'); } });
  await assert.rejects(missing.read(randomUUID()), error => error.code === 'invalid_keychain_helper' && !error.message.includes(f.root));
});

for (const failure of ['spawn', 'stdin', 'stdout']) test('子进程或管道失败不遗留活动助手、不回显底层异常：' + failure, async () => {
  const f = fixture(); let kills = 0;
  const provider = createMacOSMasterKeyProvider({ helperPath: f.helper, helperSHA256: createHash('sha256').update(readFileSync(f.helper)).digest('hex'), spawnImpl() {
    if (failure === 'spawn') throw Error('DO-NOT-LEAK');
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.kill = () => { kills++; };
    queueMicrotask(() => child[failure].emit('error', Error('DO-NOT-LEAK')));
    return child;
  } });
  await assert.rejects(provider.read(randomUUID()), error => error.code === 'keychain_unavailable' && !error.message.includes('DO-NOT-LEAK'));
  assert.equal(kills, failure === 'spawn' ? 0 : 1);
});

test('原生助手可编译；非法输入在Keychain调用前拒绝且无stdout', { timeout: 60_000 }, () => {
  const root = mkdtempSync(join(tmpdir(), 'guan-keychain-build-')); roots.push(root);
  const source = new URL('../扩展功能/本机凭据/系统钥匙串.swift', import.meta.url), output = join(root, '系统钥匙串');
  execFileSync('/usr/bin/swiftc', ['-warnings-as-errors', '-o', output, decodeURIComponent(source.pathname)], { timeout: 55_000, stdio: 'pipe' });
  for (const value of ['{}', '{broken', JSON.stringify({ protocol: 'guan-keychain-master.v1', workspaceId: '../old', operation: 'read' }), 'x'.repeat(1025)]) {
    const result = spawnSync(output, [], { input: value, encoding: 'utf8', timeout: 3000 });
    assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  }
  const swift = readFileSync(source, 'utf8');
  assert.ok(swift.indexOf('else { stop() }') < swift.indexOf('SecItemCopyMatching('));
  console.log(JSON.stringify({ nativeHelperCompiled: true, invalidInputOnly: true, keychainAPICalled: false, retainedOutput: output }));
});

test.after(() => console.log(JSON.stringify({ syntheticRoots: roots, retainedForInspection: true, realKeychainAccessed: false })));
