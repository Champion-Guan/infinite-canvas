import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isWorkbenchOrigin, listenWorkbench } from '../扩展功能/本机服务/工作台端口.mjs';
import { readWebAddress, waitWebAddress } from '../扩展功能/客户安装/Web运行地址.mjs';
import { writeState } from '../扩展功能/客户安装/Web安装目录.mjs';

function listener(failures) {
  const server = new EventEmitter(); server.calls = [];
  server.listen = (port, host) => {
    server.calls.push({ port, host });
    queueMicrotask(() => { const code = failures.shift(); if (code) server.emit('error', Object.assign(Error(code), { code })); else server.emit('listening'); });
  };
  return server;
}
test('3000和3001占用后顺延3002，全程仅绑定回环且清除临时监听', async () => {
  const server = listener(['EADDRINUSE', 'EADDRINUSE']);
  await listenWorkbench(server, 3000, { automatic: true });
  assert.deepEqual(server.calls, [3000, 3001, 3002].map(port => ({ port, host: '127.0.0.1' })));
  assert.equal(server.listenerCount('error'), 0); assert.equal(server.listenerCount('listening'), 0);
});
test('固定端口冲突、权限错误、端口耗尽立即报错，不吞掉异常', async () => {
  for (const [port, automatic, code] of [[3100, false, 'EADDRINUSE'], [3000, true, 'EACCES'], [65535, true, 'EADDRINUSE']]) {
    const server = listener([code]);
    await assert.rejects(listenWorkbench(server, port, { automatic }), e => e.code === code);
    assert.equal(server.calls.length, 1); assert.equal(server.listenerCount('error'), 0); assert.equal(server.listenerCount('listening'), 0);
  }
});
test('实际地址只接受规范的localhost工作台端口', () => {
  for (const port of [3000, 3001, 3100, 65535]) assert.equal(isWorkbenchOrigin('http://localhost:' + port), true);
  for (const value of [null, '', 'http://localhost:2999', 'http://localhost:65536', 'http://localhost:3000/', 'http://localhost:3000/path', 'https://localhost:3000', 'http://127.0.0.1:3000', 'http://evil.invalid:3000', 'http://user@localhost:3000']) assert.equal(isWorkbenchOrigin(value), false);
});
test('运行地址绑定本次进程、工作区和已提交版本，拒绝旧运行记录', async t => {
  const root = await mkdtemp(join(tmpdir(), '工作台地址-')); t.after(() => rm(root, { recursive: true, force: true }));
  const paths = { address: join(root, '运行地址.json'), state: join(root, '当前版本.json'), lock: join(root, '运行锁.json') };
  const owner = { pid: 123, started: '本次启动', command: '客户管理器' };
  const state = { phase: 'committed', current: { version: '2.0.0-beta.4' }, workspaceId: '原工作区' };
  const address = { owner, ready: true, origin: 'http://localhost:3001', version: state.current.version, workspaceId: state.workspaceId };
  const owns = value => value?.pid === owner.pid;
  await writeState(paths.address, address); await writeState(paths.state, state); await writeState(paths.lock, owner);
  assert.equal(await readWebAddress(paths, owner, state, owns), address.origin);
  assert.deepEqual(await waitWebAddress(paths, owns, { timeout: 1 }), { running: true, address: address.origin, version: address.version });
  for (const changes of [{ owner: { ...owner, started: '上次启动' } }, { owner: { ...owner, command: '其他进程' } }, { ready: false }, { version: '2.0.0-beta.3' }, { workspaceId: '其他工作区' }, { origin: 'http://evil.invalid:3000' }]) {
    await writeState(paths.address, { ...address, ...changes }); assert.equal(await readWebAddress(paths, owner, state, owns), null);
  }
  await writeState(paths.address, address);
  assert.equal(await readWebAddress(paths, owner, { ...state, phase: 'switching' }, owns), null);
  assert.equal(await readWebAddress(paths, owner, state, () => false), null);
});
