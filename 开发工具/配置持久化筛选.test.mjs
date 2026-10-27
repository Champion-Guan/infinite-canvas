import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../.运行/3100源/画布副本/web/package.json', import.meta.url));
const ts = require('typescript');
const { createStore } = require('zustand/vanilla');
const { persist, createJSONStorage } = require('zustand/middleware');
const source = readFileSync(new URL('../扩展功能/本机存储/配置持久化筛选.ts', import.meta.url), 'utf8');
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { createConfigPersistence } = await import('data:text/javascript;base64,' + Buffer.from(javascript).toString('base64'));
const name = 'config';
const state = () => ({ config: { title: '原配置' }, webdav: {} });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('真实 Zustand 页签与面板快速切换不序列化、不保存；改配置只保存一次', async () => {
    let serializations = 0;
    const writes = [];
    const filtered = createConfigPersistence(createJSONStorage(() => ({
        getItem: () => JSON.stringify({ state: state(), version: 0 }),
        setItem: (key, value) => { writes.push(JSON.parse(value)); },
        removeItem() {},
    }), { replacer(key, value) { if (key === '') serializations++; return value; } }), name);
    const store = createStore(persist(() => ({ ...state(), configTab: 'channels', isConfigOpen: false }), {
        name, storage: filtered.storage,
        partialize: current => ({ config: current.config, webdav: current.webdav }),
        onRehydrateStorage: () => current => filtered.seed({ config: current.config, webdav: current.webdav }),
    }));
    for (let i = 0; i < 200; i++) store.setState({ configTab: `tab-${i % 5}`, isConfigOpen: !!(i % 2) });
    assert.equal(serializations, 0); assert.equal(writes.length, 0);
    await store.setState({ config: { title: '新配置' } });
    for (let i = 0; i < 50; i++) store.setState({ configTab: `tab-${i}` });
    assert.equal(serializations, 1); assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].state, { config: { title: '新配置' }, webdav: {} });
});

test('同值在途调用共享回执，失败后相同配置可以重试', async () => {
    const flight = deferred(); let calls = 0;
    const filtered = createConfigPersistence({ getItem() {}, setItem() { return ++calls === 1 ? flight.promise : Promise.resolve(); }, removeItem() {} }, name);
    const value = { state: state(), version: 0 };
    const first = filtered.storage.setItem(name, value), repeated = filtered.storage.setItem(name, value);
    assert.equal(first, repeated); assert.equal(calls, 1);
    flight.reject(Error('合成保存失败'));
    await assert.rejects(first, /合成保存失败/);
    await filtered.storage.setItem(name, value); assert.equal(calls, 2);
});

test('旧保存失败不使更新的在途配置失效；版本变化和删除仍传递', async () => {
    const flight = deferred(); const writes = []; const removed = [];
    const filtered = createConfigPersistence({ getItem() {}, setItem(key, value) { writes.push(value); return writes.length === 1 ? flight.promise : undefined; }, removeItem(key) { removed.push(key); } }, name);
    const one = { state: state(), version: 0 }, two = { state: state(), version: 0 };
    const first = filtered.storage.setItem(name, one);
    await filtered.storage.setItem(name, two); flight.reject(Error('旧保存失败')); await assert.rejects(first);
    await filtered.storage.setItem(name, two); assert.equal(writes.length, 2);
    await filtered.storage.setItem(name, { ...two, version: 1 }); assert.equal(writes.length, 3);
    filtered.storage.removeItem(name); assert.deepEqual(removed, [name]);
    await filtered.storage.setItem(name, two); assert.equal(writes.length, 4);
});

test('同步失败同样不缓存成功', async () => {
    let calls = 0;
    const filtered = createConfigPersistence({ getItem() {}, setItem() { calls++; throw Error('合成同步错误'); }, removeItem() {} }, name);
    const value = { state: state(), version: 0 };
    assert.throws(() => filtered.storage.setItem(name, value));
    assert.throws(() => filtered.storage.setItem(name, value)); assert.equal(calls, 2);
});
