import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createRecoverableApplicationStorage } from '../扩展功能/本机存储/可恢复应用存储.mjs';

const require = createRequire(resolve('.运行/3100源/画布副本/web/package.json'));
const ts = require('typescript');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function load(file, dependencies = {}) {
    const source = readFileSync('扩展功能/' + file, 'utf8'), module = { exports: {} };
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', code)(id => {
        assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id];
    }, module, module.exports);
    return module.exports;
}
const rules = load('产品/画布保存判定.ts');
function fixture(t) {
    const directory = mkdtempSync(join(tmpdir(), '画布休眠恢复-'));
    const requests = [], flights = [], releases = [];
    let workspace, app;
    t.after(async () => {
        releases.forEach(release => release());
        await Promise.allSettled(flights);
        try { if (app) { await app.flush(); app.close(); } } catch { /* 失败用例只清理自己的临时工作区。 */ }
        workspace?.close();
        rmSync(directory, { recursive: true, force: true });
    });
    workspace = openWorkspace({ dataRoot: join(directory, '数据'), initialize: true });
    let control = async action => action();
    const client = {
        readDocument: async (collection, id) => workspace.readDocument(collection, id),
        writeDocument: async input => { requests.push(structuredClone(input)); return control(() => workspace.writeDocument(input), input); },
        writeMedia: async blob => workspace.writeMedia(Buffer.from(await blob.arrayBuffer()), blob.type),
        readMedia: async id => { const media = workspace.readMedia(id); return new Blob([media.bytes], { type: media.mime }); },
        readUsage: async () => workspace.readUsage(),
    };
    app = createRecoverableApplicationStorage({ client });
    const dormant = load('产品/画布休眠状态.ts', {
        '../本机存储/上游浏览器存储桥': { sqliteForage: app }, './画布保存判定': rules,
    });
    const observe = promise => { flights.push(promise); promise.catch(() => {}); return promise; };
    const delayNamespace = (namespace, failure) => {
        const started = deferred(), ack = deferred(); releases.push(ack.resolve);
        control = async (action, input) => {
            if (input.value.namespace === namespace) {
                started.resolve(); await ack.promise;
                if (failure) throw failure;
            }
            return action();
        };
        return { started: started.promise, release: ack.resolve };
    };
    return { app, ...dormant, requests, observe, delayNamespace, control: next => { control = next; } };
}
function snapshot(label) {
    const current = { nodes: [{ id: label, metadata: { content: label } }], connections: [], chatSessions: [],
        activeChatId: null, backgroundMode: 'lines', showImageInfo: true };
    return { version: 1, projectRevision: label, current, history: { past: [current], future: [] },
        selectedNodeIds: [label], selectedConnectionId: null, canvasTool: 'pan' };
}

test('恢复画布遇到其他画布休眠写入时等真实ACK，正常排队不误报未确认编辑', async t => {
    const f = fixture(t), original = snapshot('目标原画布');
    await f.saveDormantProduct('target', original);
    const gate = f.delayNamespace('prompt_cache');
    const saving = f.observe(f.saveDormantProduct('other', snapshot('另一画布')));
    await gate.started;
    let settled = false;
    const opening = f.observe(f.readDormantProduct('target').finally(() => { settled = true; }));
    await tick();
    assert.equal(settled, false, '应等待正常保存，而不是进入恢复失败页');
    gate.release(); await saving;
    assert.deepEqual(await opening, original);
    assert.equal(f.requests.length, 2, '读取不重放保存、不产生额外写入');
});

test('同一画布连续休眠期间恢复读取最新确认值，保留撤销栈共享引用', async t => {
    const f = fixture(t);
    await f.saveDormantProduct('target', snapshot('旧值'));
    const gate = f.delayNamespace('prompt_cache');
    const first = f.observe(f.saveDormantProduct('target', snapshot('中间值')));
    await gate.started;
    const latest = snapshot('最新值');
    const opening = f.observe(f.readDormantProduct('target'));
    const second = f.observe(f.saveDormantProduct('target', latest));
    gate.release(); await Promise.all([first, second]);
    const restored = await opening;
    assert.deepEqual(restored, latest);
    assert.equal(restored.current, restored.history.past[0]);
    assert.equal(f.requests.length, 3);
});

test('真正未确认保存仍阻止读取，显式重试复用原操作，不静默读取旧缓存', async t => {
    const f = fixture(t), original = snapshot('目标原值');
    await f.saveDormantProduct('target', original);
    f.control(async () => { throw Error('合成保存断线'); });
    await assert.rejects(f.saveDormantProduct('target', snapshot('未确认新值')));
    await assert.rejects(f.readDormantProduct('target'), error => error.code === 'pending_write_unresolved');
    assert.equal(f.app.getStatus().state, 'error');
    assert.equal(f.requests.length, 2, '读取不会自动重试或生成新操作');
    const failed = f.requests.at(-1);
    f.control(async action => action());
    await f.app.retryPending();
    assert.deepEqual(f.requests.at(-1), failed);
    assert.equal((await f.readDormantProduct('target')).projectRevision, '未确认新值');
});

test('等待中的保存最终失败时恢复读取也失败，不把旧值当作恢复成功', async t => {
    const f = fixture(t);
    await f.saveDormantProduct('target', snapshot('旧值'));
    const gate = f.delayNamespace('prompt_cache', Error('合成在途保存失败'));
    const saving = f.observe(f.saveDormantProduct('target', snapshot('新值')));
    await gate.started;
    const opening = f.observe(f.readDormantProduct('target'));
    gate.release();
    await assert.rejects(saving, /在途保存失败/);
    await assert.rejects(opening, error => error.code === 'pending_write_unresolved');
    assert.equal(f.app.getStatus().state, 'error');
    assert.equal(f.requests.length, 2);
});

test('只等自己的缓存区，不让无关命名空间的在途保存拖住恢复', async t => {
    const f = fixture(t), original = snapshot('目标画布');
    await f.saveDormantProduct('target', original);
    const gate = f.delayNamespace('preferences');
    const unrelated = f.observe(f.app.createInstance({ storeName: 'preferences' }).setItem('width', 400));
    await gate.started;
    assert.deepEqual(await f.readDormantProduct('target'), original);
    assert.equal(f.app.getStatus().pending > 0, true);
    gate.release(); await unrelated;
});
