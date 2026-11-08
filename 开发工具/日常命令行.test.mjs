import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { 核验准备产物, 静态产物清单, 安全文件, 指纹 } from './日常运行包.mjs';
import { 安装稳定助手, 核验稳定助手, 稳定助手路径 } from './日常助手部署.mjs';
import { 解析日常命令, 管理日常会话, 停止确认 } from './日常命令行会话.mjs';
import { 日常启动差异SHA256 } from '../上游适配/SQLite日常启动批准.mjs';
import { 写入协调差异SHA256 } from '../上游适配/SQLite写入协调批准.mjs';

const roots = [], tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'guan-daily-cli-unit-')); roots.push(root);
  mkdirSync(join(root, 'web')); writeFileSync(join(root, 'web/index.html'), '<!doctype html><head></head><body>合成产物单元测试，非原UI</body>');
  mkdirSync(join(root, '系统助手'), { mode: 0o700 }); const helperPath = join(root, '系统助手/系统钥匙串');
  writeFileSync(helperPath, 'not executed - synthetic helper bytes', { mode: 0o700 });
  const manifest = { protocol: 'guan-daily-runtime.v1', platform: 'darwin', arch: 'arm64', nodeMajor: 24, createdAt: new Date().toISOString(),
    日常记录: 'synthetic', 协调记录: 'synthetic', 日常差异SHA256: 日常启动差异SHA256, 协调差异SHA256: 写入协调差异SHA256,
    web: 静态产物清单(join(root, 'web')), helper: { path: '系统助手/系统钥匙串', sourceSHA256: 'a'.repeat(64), ...安全文件(helperPath, { executable: true }) } };
  const bytes = JSON.stringify(manifest); writeFileSync(join(root, '准备清单.json'), bytes, { mode: 0o600 });
  return { root, helperPath, manifest, hash: 指纹(bytes) };
}
function support() { const root = mkdtempSync(join(realpathSync(tmpdir()), 'guan-daily-helper-install-unit-')); roots.push(root); return root; }
const prepared = f => 核验准备产物(f.root, f.hash);
test('命令默认帮助，严格区分准备/检查/安装/启动/隔离，不接受路径/端口/凭据覆盖', () => {
  assert.equal(解析日常命令([]).mode, '--帮助');
  const base = ['--运行包=synthetic', '--清单指纹=' + '0'.repeat(64)];
  for (const mode of ['--检查', '--隔离验收']) assert.equal(解析日常命令([mode, ...base]).mode, mode);
  assert.equal(解析日常命令(['--启动', ...base, '--已保存并关闭', '--首次初始化']).fields.has('--首次初始化'), true);
  assert.equal(解析日常命令(['--安装助手', ...base, '--批准安装助手']).mode, '--安装助手');
  for (const args of [['--启动', ...base], ['--安装助手', ...base], ['--帮助', '--已保存并关闭'], ['--准备', '--日常记录=x'],
    ['--检查', ...base, '--运行包=other'], ['--隔离验收', ...base, '--端口=3100'], ['--隔离验收', ...base, '--数据根=old'],
    ['--检查', ...base, '--Token=synthetic'], ['--启动', ...base, '--已保存并关闭=false']]) assert.throws(() => 解析日常命令(args));
});
test('准备清单固定指纹、完整文件内容匹配，不改构建产物和助手', () => {
  const f = fixture(), result = prepared(f); assert.equal(result.helperPath, f.helperPath); assert.equal(result.webRoot, join(f.root, 'web'));
  assert.throws(() => 核验准备产物(f.root, '0'.repeat(64)), /指纹/);
  writeFileSync(join(f.root, '准备清单.json'), readFileSync(join(f.root, '准备清单.json'), 'utf8') + ' '); assert.throws(() => prepared(f), /指纹/);
});
test('静态产物修改、缺失、额外文件、未知空目录和非法后缀均拒绝', () => {
  for (const kind of ['modify', 'missing', 'extra', 'empty-directory', 'suffix']) {
    const f = fixture(), web = join(f.root, 'web');
    if (kind === 'modify') writeFileSync(join(web, 'index.html'), 'unknown');
    if (kind === 'missing') unlinkSync(join(web, 'index.html'));
    if (kind === 'extra') writeFileSync(join(web, 'extra.js'), 'export{}');
    if (kind === 'empty-directory') mkdirSync(join(web, 'unknown'));
    if (kind === 'suffix') writeFileSync(join(web, 'private.sqlite'), 'unknown');
    assert.throws(() => prepared(f));
  }
});
test('准备包未知内容、符号/硬链接和不安全权限拒绝，不自动修复', () => {
  for (const kind of ['root-extra', 'symbolic', 'hard', 'writable', 'no-execute']) {
    const f = fixture(), external = join(support(), '外部');
    if (kind === 'root-extra') writeFileSync(join(f.root, 'unknown'), 'unknown');
    if (kind === 'symbolic' || kind === 'hard') { writeFileSync(external, readFileSync(f.helperPath), { mode: 0o700 }); unlinkSync(f.helperPath); if (kind === 'symbolic') symlinkSync(external, f.helperPath); else linkSync(external, f.helperPath); }
    if (kind === 'writable') chmodSync(f.helperPath, 0o722);
    if (kind === 'no-execute') chmodSync(f.helperPath, 0o600);
    assert.throws(() => prepared(f));
    if (kind === 'writable') assert.equal(lstatSync(f.helperPath).mode & 0o777, 0o722);
  }
});
test('助手只在明确安装时复制到独立稳定目录；相同包复用且不执行助手', () => {
  const f = fixture(), value = prepared(f), parent = support(), paths = 稳定助手路径(f.manifest.helper.sourceSHA256, parent);
  assert.throws(() => 安装稳定助手(value, { applicationSupport: parent }), /批准/); assert.deepEqual(readdirSync(parent), []);
  const first = 安装稳定助手(value, { approved: true, applicationSupport: parent }); assert.equal(first.reused, false);
  const bytes = readFileSync(paths.helperPath), stat = lstatSync(paths.helperPath);
  assert.equal(lstatSync(paths.container).mode & 0o777, 0o700); assert.equal(stat.mode & 0o777, 0o700);
  assert.equal(安装稳定助手(value, { approved: true, applicationSupport: parent }).reused, true);
  assert.equal(lstatSync(paths.helperPath).ino, stat.ino); assert.deepEqual(readFileSync(paths.helperPath), bytes);
  assert.deepEqual(核验稳定助手(value, parent), paths);
});
test('稳定助手内容或登记变化、部分安装、未知文件和链接拒绝，现场保留', () => {
  for (const kind of ['binary', 'receipt', 'partial', 'unknown', 'directory-link', 'dangling']) {
    const f = fixture(), value = prepared(f), parent = support(), paths = 安装稳定助手(value, { approved: true, applicationSupport: parent });
    if (kind === 'binary') writeFileSync(paths.helperPath, 'unknown');
    if (kind === 'receipt') writeFileSync(paths.receiptPath, '{}');
    if (kind === 'partial') unlinkSync(paths.receiptPath);
    if (kind === 'unknown') writeFileSync(join(paths.directory, '私人文件'), 'preserve');
    if (kind === 'directory-link' || kind === 'dangling') { unlinkSync(paths.helperPath); symlinkSync(kind === 'dangling' ? join(parent, '不存在') : f.helperPath, paths.helperPath); }
    assert.throws(() => 安装稳定助手(value, { approved: true, applicationSupport: parent }));
    if (kind === 'unknown') assert.equal(readFileSync(join(paths.directory, '私人文件'), 'utf8'), 'preserve');
  }
});
test('同源码但二进制身份不同不自动覆盖旧助手；新准备包必须选回原身份', () => {
  const f = fixture(), value = prepared(f), parent = support(), installed = 安装稳定助手(value, { approved: true, applicationSupport: parent });
  const before = readFileSync(installed.helperPath); writeFileSync(f.helperPath, 'new unselected build');
  const changed = { ...value, manifest: { ...value.manifest, helper: { ...value.manifest.helper, ...安全文件(f.helperPath, { executable: true }) } } };
  assert.throws(() => 安装稳定助手(changed, { approved: true, applicationSupport: parent }), /身份不同/); assert.deepEqual(readFileSync(installed.helperPath), before);
});
test('运行中信号和错误确认不关闭服务，当前精确确认串行停止且移除信号监听', async () => {
  const input = new PassThrough(), signals = new EventEmitter(), events = [], calls = [];
  const finished = 管理日常会话({ async close(options) { calls.push(options); } }, { input, signals, emit: event => events.push(event) });
  signals.emit('SIGINT'); signals.emit('SIGTERM'); input.write('停止\n状态\n'); await tick(); assert.equal(calls.length, 0);
  input.write(停止确认 + '\n' + 停止确认 + '\n'); await finished;
  assert.deepEqual(calls, [{ savedAndClosed: true }]); assert.equal(events.at(-1).phase, 'stopped');
  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) assert.equal(signals.listenerCount(name), 0);
});
test('stdin EOF不是保存确认，不自动关闭服务或伪报已停止', async () => {
  const input = new PassThrough(), signals = new EventEmitter(), events = []; let closes = 0, resolved = false;
  管理日常会话({ async close() { closes++; } }, { input, signals, emit: event => events.push(event) }).then(() => { resolved = true; });
  input.end(); await tick(); assert.equal(closes, 0); assert.equal(resolved, false); assert.equal(events.at(-1).phase, 'control-input-closed');
});
test('停止异常不伪报成功、不退出或清锁，保留维护控制', async () => {
  const input = new PassThrough(), signals = new EventEmitter(), events = []; let calls = 0;
  const finished = 管理日常会话({ async close() { if (++calls === 1) throw Error('synthetic failure'); } }, { input, signals, emit: event => events.push(event) });
  input.write(停止确认 + '\n'); await tick(); assert.equal(events.at(-1).phase, 'stop-failed');
  input.write(停止确认 + '\n'); await finished; assert.equal(calls, 2);
});
test.after(() => console.log(JSON.stringify({ syntheticRoots: roots, realKeychainAccessed: false, productionHelperInstalled: false, retained: true })));
