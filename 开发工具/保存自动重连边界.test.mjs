import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { createRenewingDataClient } from '../扩展功能/本机存储/续期数据客户端.mjs';
import { createSessionController } from '../扩展功能/本机服务/受控会话.mjs';
import { createRecoverableShardedApplicationStorage } from '../扩展功能/本机存储/可恢复分片应用存储.mjs';
import { PROTOCOL, StorageError, serializeDocument } from '../扩展功能/本机存储/协议.mjs';

const code = expected => error => error.code === expected;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const input = (id = 'demo', title = '原保存快照') => ({ collection: 'canvas', id, value: { id, title, nodes: [], connections: [] }, expectedRevision: 0, operationId: randomUUID(), mediaIds: [] });
function fixture(t, { autoReconnect = true, lifetime = 180_000 } = {}) {
    let time = Date.now(), transport = (url, request, next) => next();
    t.mock.method(Date, 'now', () => time);
    const origin = 'http://localhost:3100', workspaceId = randomUUID();
    const sessions = new Map(), documents = new Map(), operations = new Map(), requests = [], states = [];
    const calls = { initialize: 0, renew: 0, reconnect: 0, issued: 0 };
    const service = {
        issueSession() {
            calls.issued++;
            const session = { protocol: PROTOCOL, workspaceId, origin, token: randomBytes(32).toString('hex'), csrf: randomBytes(32).toString('hex'), expiresAt: time + 60_000 };
            sessions.set(session.token, session); return session;
        },
        revokeSession: token => sessions.delete(token),
    };
    const controller = createSessionController({ service, origin, now: () => time, lifetime, renewalWindow: 10_000, schedule: () => 0, cancel() {} });
    t.after(() => controller.close());
    const port = controller.open();
    const host = Object.fromEntries(['initialize', 'renew', 'reconnect', 'close'].map(key => [key, async (...args) => { if (key in calls) calls[key]++; return port[key](...args); }]));
    const failure = (error, status = 401) => Response.json({ error: { code: error, message: '合成明确拒绝' } }, { status });
    async function respond(url, request) {
        const session = sessions.get(request.headers.Authorization.slice(7));
        if (!session || session.expiresAt <= time) return failure('session_denied');
        if (new URL(url).pathname === '/usage') return Response.json({ protocol: PROTOCOL, workspaceId, usage: 0, quota: null, contentBytes: 0, databases: [] });
        const [, collection, id] = new URL(url).pathname.match(/documents\/(canvas|extension)\/([^/]+)$/) ?? [];
        if (request.method === 'GET') {
            const saved = documents.get(id);
            return saved ? Response.json({ ...saved, collection, id, workspaceId }) : failure('document_not_found', 404);
        }
        const body = JSON.parse(request.body), previous = documents.get(id);
        if (operations.has(body.operationId)) return Response.json(operations.get(body.operationId));
        if ((previous?.revision ?? 0) !== body.expectedRevision) return failure('revision_conflict', 409);
        const hash = createHash('sha256').update(serializeDocument(collection, id, body.value, body.mediaIds)).digest('hex');
        const ack = { protocol: PROTOCOL, workspaceId, persisted: true, collection, id, operationId: body.operationId, revision: body.expectedRevision + 1, hash };
        documents.set(id, { ...structuredClone(body), hash, revision: ack.revision }); operations.set(body.operationId, ack);
        return Response.json(ack);
    }
    const client = createRenewingDataClient({ url: 'http://127.0.0.1:49999', origin, host, now: () => time, renewalWindow: 10_000, autoReconnect,
        onStatus: status => states.push(status), fetchImpl: async (url, request) => {
            requests.push({ method: request.method, body: request.body });
            return transport(url, request, () => respond(url, request));
        } });
    return { client, host, calls, states, documents, requests, failure, tick(ms) { time += ms; }, setTransport(fn) { transport = fn; } };
}

test('休眠过期后的新保存自动恢复，收到原操作回执才标记已保存', async t => {
    const f = fixture(t); await f.client.readUsage(); f.tick(60_000);
    const pending = deferred(), entered = deferred();
    f.setTransport(async (url, request, next) => { if (request.method === 'PUT') { entered.resolve(); await pending.promise; } return next(); });
    const original = input(), saving = f.client.writeDocument(original); original.value.title = '调用后修改';
    await entered.promise;
    assert.equal(f.calls.reconnect, 1); assert.equal(f.calls.initialize, 1);
    assert.equal(f.client.getStatus().state, 'saving'); assert.equal(f.documents.size, 0);
    pending.resolve(); const ack = await saving;
    assert.equal(ack.operationId, original.operationId); assert.equal(f.documents.get('demo').value.title, '原保存快照');
    assert.equal(f.client.getStatus().state, 'saved'); assert.equal(f.states.some(status => status.state === 'error'), false);
    await f.client.close();
});

test('多笔并发过期操作只恢复一次，并保留各自内容快照和版本号', async t => {
    const f = fixture(t); await f.client.readUsage(); f.tick(60_000);
    const entered = deferred(), release = deferred(), reconnect = f.host.reconnect;
    f.host.reconnect = async session => { entered.resolve(); await release.promise; return reconnect(session); };
    const a = input('one'), b = input('two'), first = f.client.writeDocument(a), second = f.client.writeDocument(b);
    await entered.promise; a.value.title = '不应污染'; b.expectedRevision = 100;
    await assert.rejects(f.client.close(), code('save_not_confirmed'));
    release.resolve(); await Promise.all([first, second]);
    assert.equal(f.calls.reconnect, 1); assert.equal(f.calls.issued, 2);
    assert.equal(f.documents.get('one').value.title, '原保存快照'); assert.equal(f.documents.get('two').revision, 1);
});

test('续期途中跨过截止期，明确过期后恢复原授权再保存', async t => {
    const f = fixture(t); await f.client.readUsage(); f.tick(50_001);
    const renew = f.host.renew; f.host.renew = session => { f.tick(10_000); return renew(session); };
    await f.client.writeDocument(input()); assert.equal(f.calls.renew, 1); assert.equal(f.calls.reconnect, 1);
    assert.equal(f.documents.get('demo').revision, 1);
});

test('已发送请求遇到服务端明确过期拒绝，只重试一次且操作编号不变', async t => {
    const f = fixture(t); await f.client.readUsage(); let once = true;
    f.setTransport(async (url, request, next) => { if (request.method === 'PUT' && once) { once = false; f.tick(60_000); } return next(); });
    const original = input(); await f.client.writeDocument(original);
    const writes = f.requests.filter(item => item.method === 'PUT');
    assert.equal(writes.length, 2); assert.equal(writes[0].body, writes[1].body);
    assert.equal(f.calls.reconnect, 1); assert.equal(f.documents.get('demo').revision, 1);
});

test('本地异步序列化跨过期限时，自动恢复后才发送一次保存', async t => {
    const f = fixture(t); await f.client.readUsage();
    const digest = crypto.subtle.digest.bind(crypto.subtle); let first = true;
    t.mock.method(crypto.subtle, 'digest', async (...args) => { if (first) { first = false; f.tick(60_000); } return digest(...args); });
    await f.client.writeDocument(input());
    assert.equal(f.requests.filter(item => item.method === 'PUT').length, 1); assert.equal(f.calls.reconnect, 1);
});

test('网络丢失回执不自动重放；用户重试复用同一操作而非重复落盘', async t => {
    const f = fixture(t); await f.client.readUsage(); let lose = true;
    f.setTransport(async (url, request, next) => { const response = await next(); if (request.method === 'PUT' && lose) { lose = false; f.tick(60_000); throw Error('合成回执丢失'); } return response; });
    const original = input(); await assert.rejects(f.client.writeDocument(original), code('connection_failed'));
    assert.equal(f.requests.filter(item => item.method === 'PUT').length, 1); assert.equal(f.calls.reconnect, 0);
    assert.equal(f.documents.get('demo').revision, 1); assert.equal(f.client.getStatus().state, 'error');
    const ack = await f.client.writeDocument(original); assert.equal(ack.operationId, original.operationId);
    assert.equal(f.documents.get('demo').revision, 1); assert.equal(f.client.getStatus().state, 'saved');
});

test('过期恢复后版本冲突仍拒绝，不覆盖其他窗口', async t => {
    const f = fixture(t); await f.client.writeDocument(input('demo', '其他窗口已保存')); f.tick(60_000);
    await assert.rejects(f.client.writeDocument(input('demo', '本页过期旧稿')), code('revision_conflict'));
    assert.equal(f.documents.get('demo').value.title, '其他窗口已保存'); assert.equal(f.calls.reconnect, 1);
    assert.equal(f.client.getStatus().state, 'error');
});

test('未过期令牌被拒绝或回执校验失败时不自动恢复或重放', async t => {
    const f = fixture(t); await f.client.readUsage();
    f.setTransport(async () => f.failure('session_denied'));
    await assert.rejects(f.client.writeDocument(input()), code('session_denied'));
    assert.equal(f.calls.reconnect, 0); assert.equal(f.requests.filter(item => item.method === 'PUT').length, 1);
    f.setTransport(async (url, request, next) => { const response = await next(); const ack = await response.json(); return Response.json({ ...ack, operationId: randomUUID() }); });
    await assert.rejects(f.client.writeDocument(input()), code('invalid_ack'));
    assert.equal(f.calls.reconnect, 0); assert.equal(f.client.getStatus().state, 'error');
});

test('恢复返回其他工作区时不替换连接、不发送保存', async t => {
    const f = fixture(t); await f.client.readUsage(); f.tick(60_000);
    const reconnect = f.host.reconnect; f.host.reconnect = async session => ({ ...await reconnect(session), workspaceId: randomUUID() });
    await assert.rejects(f.client.writeDocument(input()), code('invalid_session'));
    assert.equal(f.documents.size, 0); assert.equal(f.requests.filter(item => item.method === 'PUT').length, 0);
    assert.equal(f.client.getStatus().state, 'error');
});

test('恢复返回其他Origin时不替换连接、不发送保存', async t => {
    const f = fixture(t); await f.client.readUsage(); f.tick(60_000);
    const reconnect = f.host.reconnect; f.host.reconnect = async session => ({ ...await reconnect(session), origin: 'http://localhost:3000' });
    await assert.rejects(f.client.writeDocument(input()), code('invalid_session'));
    assert.equal(f.documents.size, 0); assert.equal(f.requests.filter(item => item.method === 'PUT').length, 0);
    assert.equal(f.client.getStatus().state, 'error');
});

test('页面绝对授权到期时拒绝恢复，不交换新授权或清除失败', async t => {
    const f = fixture(t, { lifetime: 90_000 }); await f.client.readUsage(); f.tick(90_000);
    await assert.rejects(f.client.writeDocument(input()), code('lease_expired'));
    assert.equal(f.calls.initialize, 1); assert.equal(f.calls.issued, 1); assert.equal(f.documents.size, 0);
    assert.equal(f.client.getStatus().state, 'error');
});

test('恢复响应丢失不会自动循环；下一次新保存复用受控会话的幂等恢复', async t => {
    const f = fixture(t); await f.client.readUsage(); f.tick(60_000);
    const reconnect = f.host.reconnect; let lose = true;
    f.host.reconnect = async session => { const result = await reconnect(session); if (lose) { lose = false; throw Error('合成恢复响应丢失'); } return result; };
    const original = input(); await assert.rejects(f.client.writeDocument(original), code('connection_failed'));
    assert.equal(f.calls.reconnect, 1); assert.equal(f.documents.size, 0);
    await f.client.writeDocument(original); assert.equal(f.calls.reconnect, 2); assert.equal(f.calls.issued, 2);
    assert.equal(f.documents.get('demo').revision, 1);
});

test('同一操作至多恢复重试一次，反复过期不无限发送', async t => {
    const f = fixture(t); await f.client.readUsage();
    f.setTransport(async (url, request, next) => { if (request.method === 'PUT') f.tick(60_000); return next(); });
    await assert.rejects(f.client.writeDocument(input()), code('session_denied'));
    assert.equal(f.calls.reconnect, 1); assert.equal(f.requests.filter(item => item.method === 'PUT').length, 2);
    assert.equal(f.documents.size, 0);
});

test('手动模式保持原行为，重连完成仍不冒充保存成功', async t => {
    const f = fixture(t, { autoReconnect: false }); await f.client.readUsage(); f.tick(60_000);
    const original = input(); await assert.rejects(f.client.writeDocument(original), code('session_expired'));
    assert.equal(f.calls.reconnect, 0); await f.client.reconnect(); assert.equal(f.client.getStatus().state, 'error');
    await f.client.writeDocument(original); assert.equal(f.client.getStatus().state, 'saved');
});

test('应用分片队列在休眠后新编辑自动恢复并完成原队列', async t => {
    const f = fixture(t), app = createRecoverableShardedApplicationStorage({ client: f.client }), store = app.createInstance();
    await store.setItem('one', { title: '初稿' }); f.tick(60_000);
    await store.setItem('one', { title: '休眠后编辑' }); await app.flush();
    assert.equal(await store.getItem('one').then(value => value.title), '休眠后编辑');
    assert.equal(f.calls.reconnect, 1); assert.equal(app.getStatus().state, 'saved'); app.close();
});


test('续期响应丢失一次自动取回原结果，业务保存只发送一次', async t => {
    const f = fixture(t); await f.client.readUsage(); f.tick(50_001);
    const renew = f.host.renew; let lose = true;
    f.host.renew = async session => { const result = await renew(session); if (lose) { lose = false; throw new StorageError('authorization_connection_failed', '合成续期响应丢失', 503); } return result; };
    const original = input(); const ack = await f.client.writeDocument(original);
    assert.equal(f.calls.renew, 2); assert.equal(f.calls.issued, 2); assert.equal(f.calls.reconnect, 0);
    assert.equal(f.requests.filter(item => item.method === 'PUT').length, 1);
    assert.equal(ack.operationId, original.operationId); assert.equal(f.documents.get('demo').revision, 1);
    assert.equal(f.client.getStatus().state, 'saved');
});

test('续期持续丢响应只重试一次，过期后新操作可用原会话恢复', async t => {
    const f = fixture(t); await f.client.readUsage(); f.tick(50_001);
    const renew = f.host.renew;
    f.host.renew = async session => { await renew(session); throw new StorageError('authorization_connection_failed', '合成持续丢失', 503); };
    const original = input(); await assert.rejects(f.client.writeDocument(original), code('authorization_connection_failed'));
    assert.equal(f.calls.renew, 2); assert.equal(f.calls.issued, 2); assert.equal(f.documents.size, 0);
    assert.equal(f.client.getStatus().state, 'error'); f.tick(60_000);
    await f.client.writeDocument(original);
    assert.equal(f.calls.reconnect, 1); assert.equal(f.calls.issued, 3);
    assert.equal(f.requests.filter(item => item.method === 'PUT').length, 1);
    assert.equal(f.documents.get('demo').revision, 1);
});
