// 七文件配置价格回归，来源 开发工具/配置文件安全.test.mjs SHA256 d44817ea1adaf5f12811ba0dc5b4bb843ccb5ca5a46efc36010c6d1a34f1ad30；保留原安全矩阵并增加价格冷读。
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ts } from './检查首批功能适配.mjs';
import { 根目录 } from './公共.mjs';
import { 配置安全旧目录 } from './预审配置文件安全.mjs';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { openSQLiteCredentialVault } from '../扩展功能/本机凭据/SQLite凭据保管.mjs';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { containsText } from './生成网关隔离夹具.mjs';
import { generationFixture } from './生成网关隔离夹具.mjs';
import { createCredentialClient } from '../扩展功能/本机凭据/凭据客户端.mjs';
import { sealConfiguration } from '../扩展功能/本机凭据/渠道编辑流程.mjs';
import { createProviderCredentialGateway } from '../扩展功能/生成网关/渠道凭据网关.mjs';
import { createWriteCoordinator } from '../扩展功能/本机服务/写入协调.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const source = readFileSync(join(根目录, '扩展功能/配置文件/配置文件安全.ts'), 'utf8');
const baseline = join(根目录, '.运行/3100源/画布副本');
const i18n = { t: key => key };
function evaluate(code, imports = {}, globals = {}) {
  const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputText, { exports: module.exports, module, URL, Blob, TextEncoder, console, ...globals,
    require: id => { assert.ok(Object.hasOwn(imports, id), '未授权测试依赖：' + id); return imports[id]; } });
  return module.exports;
}
const configFile = ts.createSourceFile('config.ts', readFileSync(join(baseline, 'web/src/stores/use-config-store.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const selected = new Set(['OPENAI_BASE_URL', 'GEMINI_BASE_URL', 'DEFAULT_LOCAL_PROXY_URL', 'defaultConfig', 'defaultWebdavSyncConfig']);
const defaults = evaluate(configFile.statements.filter(node => ts.isVariableStatement(node) && selected.has(node.declarationList.declarations[0].name.text)).map(node => node.getText(configFile)).join('\n'), {}, { i18n, 本地转发前缀: () => '/local-proxy' });
const initialSources = [{ id: 'banana-prompt-quicker', name: 'Banana Prompt Quicker', url: 'https://source.example/prompts.json', homepage: 'https://source.example', enabled: true, builtIn: true }];
const schedule = { intervalMinutes: 30, lastFetchedAt: '' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const file = value => new File([JSON.stringify(value)], 'synthetic-config.json', { type: 'application/json' });
function fixture({ flush = async () => {}, persist = () => {}, sealConfigurationCredentials = async value => value } = {}) {
  let configState = { config: clone(defaults.defaultConfig), webdav: clone(defaults.defaultWebdavSyncConfig), untouched: true };
  let promptState = { sources: clone(initialSources), schedule: { ...schedule }, saveSource() {} };
  let writes = 0, flushes = 0;
  const downloads = [], events = [];
  const configStore = { getState: () => configState, setState: patch => { configState = { ...configState, ...patch }; writes++; events.push('config'); persist('config', clone(patch)); } };
  const promptStore = { getState: () => promptState, setState: patch => { promptState = { ...promptState, ...patch }; writes++; events.push('sources'); persist('sources', clone(patch)); } };
  const imports = {
    'file-saver': { saveAs: (blob, name) => downloads.push({ blob, name }) }, '@/i18n/index': { default: i18n },
    '@/stores/use-config-store': { ...defaults, useConfigStore: configStore }, '@/stores/use-prompt-source-store': { usePromptSourceStore: promptStore },
    '@/services/api/prompt-source-presets': { filterWorkbenchPromptSources: sources => sources.filter(item => !item.builtIn || item.id === 'banana-prompt-quicker') },
    '../本机凭据/配置凭据封存': { sealConfigurationCredentials },
    '../本机存储/上游浏览器存储桥': { flushSQLiteStorage: async () => { events.push('flush'); await flush(++flushes); } },
  };
  const api = evaluate(source, imports);
  function payload(portable = false) {
    const value = { app: 'infinite-canvas', version: 1, exportedAt: '2026-10-20T00:00:00Z', config: clone(configState.config), webdav: clone(configState.webdav),
      promptSources: { sources: clone(promptState.sources), schedule: clone(promptState.schedule) } };
    if (portable) value.credentialsOmitted = true;
    return value;
  }
  return { api, configStore, promptStore, downloads, payload, events, get writes() { return writes; }, get flushes() { return flushes; } };
}

test('导出剥离三类凭据、模型脚本和未知JSON字段，不改页面原配置', async () => {
  const f = fixture(), cfg = f.configStore.getState().config, dav = f.configStore.getState().webdav;
  cfg.apiKey = 'synthetic-root-secret'; cfg.channels[0].apiKey = 'synthetic-channel-secret'; dav.password = 'synthetic-' + 'webdav-secret';
  cfg.channels[0].models[0].script = 'synthetic-embedded-script-secret'; cfg.extra = 'synthetic-unknown-secret';
  cfg.channels[0].extra = 'synthetic-unknown-secret'; f.promptStore.getState().sources[0].extra = 'synthetic-unknown-secret';
  const before = JSON.stringify(f.payload());
  f.api.exportAppConfig();
  const { blob, name } = f.downloads[0], text = await blob.text(), data = JSON.parse(text);
  assert.equal(name, 'guan-workbench-config-no-credentials.json'); assert.equal(blob.type, 'application/json;charset=utf-8');
  assert.equal(data.credentialsOmitted, true);
  for (const marker of ['synthetic-root-secret', 'synthetic-channel-secret', 'synthetic-webdav-secret', 'synthetic-embedded-script-secret', 'synthetic-unknown-secret']) assert.equal(text.includes(marker), false);
  assert.equal(JSON.stringify(f.payload()), before); assert.equal(f.writes, 0); assert.equal(f.flushes, 0);
});
test('认证/查询/片段及本机绑定URL不进入导出，普通端点保留', async () => {
  const f = fixture(), state = f.configStore.getState(), source = f.promptStore.getState().sources[0];
  state.config.baseUrl = 'https://' + 'user:synthetic-password@api.example/v1';
  state.config.proxyUrl = 'https://proxy.example/?token=synthetic-token';
  state.config.channels[0].baseUrl = 'http://localhost:3000/%6cocal-secure-api/synthetic-binding';
  state.webdav.url = 'https://dav.example/#synthetic-token'; source.url = 'https://source.example/?token=synthetic-token';
  const data = f.api.createPortableAppConfig(state.config, state.webdav, [source], schedule);
  for (const value of [data.config.baseUrl, data.config.proxyUrl, data.config.channels[0].baseUrl, data.webdav.url, data.promptSources.sources[0].url]) assert.equal(value, '');
  assert.equal(data.promptSources.sources[0].homepage, 'https://source.example');
});
test('旧导出核心字段行为对照：脱敏后的共同字段一致', () => {
  const oldFile = ts.createSourceFile('old.ts', readFileSync(join(配置安全旧目录, 'src/canvas/services/config-file.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  const functions = oldFile.statements.filter(node => ts.isFunctionDeclaration(node) && ['portableEndpoint', 'createPortableAppConfig'].includes(node.name?.text));
  const old = evaluate(functions.map(node => node.getText(oldFile)).join('\n'));
  const f = fixture(), data = f.payload(), oldValue = clone(old.createPortableAppConfig(data.config, data.webdav, data.promptSources.sources, data.promptSources.schedule));
  const next = clone(f.api.createPortableAppConfig(data.config, data.webdav, data.promptSources.sources, data.promptSources.schedule));
  delete oldValue.exportedAt; delete next.exportedAt; assert.deepEqual(next, oldValue);
});
test('文件超4MiB时不读取正文；伪造size也受UTF8字节限制', async () => {
  const f = fixture();
  await assert.rejects(f.api.importAppConfig({ size: f.api.MAX_CONFIG_BYTES + 1, text: () => assert.fail('不应读大文件') }), /config.invalidFile/);
  await assert.rejects(f.api.importAppConfig({ size: 1, text: async () => '汉'.repeat(1_400_000) }), /config.invalidFile/);
  assert.equal(f.writes, 0);
});
for (const [title, change] of [
  ['空值', () => null], ['错误版本', v => ({ ...v, version: 2 })], ['数组配置', v => ({ ...v, config: [] })],
  ['空渠道', v => { v.config.channels = []; return v; }], ['重复渠道ID', v => { v.config.channels.push(clone(v.config.channels[0])); return v; }],
  ['错误model数组', v => { v.config.models = [false]; return v; }], ['未知能力', v => { v.config.channels[0].models[0].capability = 'executable'; return v; }],
  ['错类型凭据', v => { v.config.channels[0].apiKey = { ref: 'secret:forged' }; return v; }], ['超限凭据', v => { v.webdav.password = '汉'.repeat(683); return v; }],
  ['无效Unicode凭据', v => { v.config.apiKey = '\ud800'; return v; }],
  ['错类型布尔偏好', v => { v.config.proxyEnabled = 'false'; return v; }], ['错类型来源', v => { v.promptSources.sources = [null]; return v; }],
  ['重复来源ID', v => { v.promptSources.sources.push(clone(v.promptSources.sources[0])); return v; }],
  ['错类型调度', v => { v.promptSources.schedule.intervalMinutes = '30'; return v; }], ['非法脱敏标记', v => ({ ...v, credentialsOmitted: 'true' })],
]) test('拒绝结构损坏且不修改任何store：' + title, async () => {
  const f = fixture(), before = JSON.stringify(f.payload());
  await assert.rejects(f.api.importAppConfig(file(change(f.payload()))), /config.invalidFile/);
  assert.equal(f.writes, 0); assert.equal(JSON.stringify(f.payload()), before);
});
for (const [title, change] of [
  ['旧凭据引用', v => { v.config.apiKey = ' guan-vault:synthetic-local-account '; }],
  ['SQLite凭据引用', v => { v.config.channels[0].apiKey = 'secret:' + '1'.repeat(64); }],
  ['网关绑定引用', v => { v.webdav.password = 'provider:' + 'a'.repeat(64); }],
  ['旧安全端点', v => { v.config.channels[0].baseUrl = 'http://localhost:3000/local-secure-api/synthetic'; }],
  ['编码安全端点', v => { v.webdav.url = 'http://localhost:3000/%6cocal-secure-api/synthetic'; }],
]) test('拒绝导入本机引用：' + title, async () => {
  const f = fixture(), value = f.payload(); change(value);
  await assert.rejects(f.api.importAppConfig(file(value)), /原工作区/); assert.equal(f.writes, 0);
});
test('脱敏导出重导入仅保留相同身份的本机凭据，忽略伪造的脱敏文件密钥', async () => {
  const f = fixture(), state = f.configStore.getState();
  state.config.apiKey = 'synthetic-existing-root'; state.config.channels[0].apiKey = 'synthetic-existing-channel';
  state.webdav = { ...state.webdav, username: 'account-A', url: 'https://dav.example', password: 'synthetic-' + 'existing-dav' };
  const input = f.payload(true); input.config.channels[0].apiKey = 'synthetic-forged'; input.webdav.password = 'synthetic-' + 'forged'; input.config.apiKey = 'synthetic-forged';
  await f.api.importAppConfig(file(input));
  assert.equal(f.configStore.getState().config.apiKey, 'synthetic-existing-root');
  assert.equal(f.configStore.getState().config.channels[0].apiKey, 'synthetic-existing-channel');
  assert.equal(f.configStore.getState().webdav.password, 'synthetic-existing-dav');
  assert.deepEqual(f.events, ['flush', 'config', 'sources', 'flush']);
});
for (const [title, change] of [
  ['渠道ID', v => { v.config.channels[0].id = 'other'; }], ['渠道端点', v => { v.config.channels[0].baseUrl = 'https://other.example'; }],
  ['渠道协议', v => { v.config.channels[0].apiFormat = 'gemini'; }], ['空渠道端点', v => { v.config.channels[0].baseUrl = ''; }],
]) test('不向其他渠道复用已有密钥：' + title, async () => {
  const f = fixture(); f.configStore.getState().config.channels[0].apiKey = 'synthetic-keep-local';
  const input = f.payload(true); change(input); await f.api.importAppConfig(file(input));
  assert.equal(f.configStore.getState().config.channels[0].apiKey, '');
});
test('WebDAV账户/端点或顶层协议/端点变化时不复用本机凭据', async () => {
  const f = fixture(), state = f.configStore.getState(); state.config.apiKey = 'synthetic-root';
  state.webdav = { ...state.webdav, url: 'https://dav.example', username: 'account-A', password: 'synthetic-dav' };
  const input = f.payload(true); input.config.baseUrl = 'https://other.example'; input.webdav.username = 'account-B';
  await f.api.importAppConfig(file(input)); assert.equal(f.configStore.getState().config.apiKey, ''); assert.equal(f.configStore.getState().webdav.password, '');
});
test('传统明文格式可导入，未知字段不进store，来源操作方法不被JSON覆盖', async () => {
  const f = fixture(), action = f.promptStore.getState().saveSource, input = f.payload();
  input.config.apiKey = 'synthetic-legacy-secret'; input.config.extra = 'ignored';
  input.promptSources.saveSource = 'forged'; Object.defineProperty(input.promptSources, '__proto__', { value: { poisoned: true }, enumerable: true });
  input.promptSources.sources.push({ ...input.promptSources.sources[0], id: 'removed-built-in' });
  input.promptSources.sources.push({ ...input.promptSources.sources[0], id: 'custom-preserved', builtIn: false });
  await f.api.importAppConfig(file(input));
  assert.equal(f.configStore.getState().config.apiKey, 'synthetic-legacy-secret'); assert.equal(f.configStore.getState().config.extra, undefined);
  assert.equal(f.promptStore.getState().saveSource, action); assert.equal(f.promptStore.getState().poisoned, undefined);
  assert.deepEqual(clone(f.promptStore.getState().sources.map(item => item.id)), ['banana-prompt-quicker', 'custom-preserved']);
});
test('旧文件缺少新增偏好时补默认值，不借用本机秘密', async () => {
  const f = fixture(), input = f.payload(); f.configStore.getState().config.apiKey = 'synthetic-not-default';
  delete input.config.apiKey; delete input.config.autoFocusOnSelect; delete input.webdav.lastSyncedAt;
  await f.api.importAppConfig(file(input));
  assert.equal(f.configStore.getState().config.autoFocusOnSelect, false); assert.equal(f.configStore.getState().config.apiKey, '');
});
test('读取文件期间发生配置或来源编辑时拒绝覆盖', async () => {
  for (const kind of ['config', 'sources']) {
    const f = fixture(), gate = deferred(), entered = deferred(), text = JSON.stringify(f.payload());
    const importing = f.api.importAppConfig({ size: text.length, text: async () => { entered.resolve(); await gate.promise; return text; } });
    await entered.promise;
    if (kind === 'config') f.configStore.setState({ config: { ...f.configStore.getState().config, size: '1536x1024' } });
    else f.promptStore.setState({ schedule: { ...schedule, intervalMinutes: 60 } });
    gate.resolve(); await assert.rejects(importing, /未覆盖现有编辑/); assert.equal(f.writes, 1);
  }
});
test('同时导入被拦截，失败后可以再次尝试', async () => {
  const f = fixture(), gate = deferred(), entered = deferred(), text = JSON.stringify(f.payload());
  const importing = f.api.importAppConfig({ size: text.length, text: async () => { entered.resolve(); await gate.promise; return text; } });
  await entered.promise; await assert.rejects(f.api.importAppConfig(file(f.payload())), /正在导入/);
  gate.resolve(); await importing; await f.api.importAppConfig(file(f.payload())); assert.equal(f.writes, 4);
});
test('既有保存失败时不改配置；导入保存未ACK时不返回成功', async () => {
  const first = fixture({ flush: async () => { throw Error('synthetic-unsaved'); } });
  await assert.rejects(first.api.importAppConfig(file(first.payload()))); assert.equal(first.writes, 0);
  const gate = deferred(), entered = deferred(), second = fixture({ flush: async count => { if (count === 2) { entered.resolve(); await gate.promise; } } });
  let done = false; const importing = second.api.importAppConfig(file(second.payload())).then(() => { done = true; });
  await entered.promise; assert.equal(done, false); gate.resolve(); await importing; assert.equal(done, true);
});
test('保存失败保留导入值供保存栏重试，错误不含凭据，不自动回滚期间编辑', async () => {
  let f;
  f = fixture({ flush: async count => {
    if (count === 2) { f.configStore.setState({ config: { ...f.configStore.getState().config, size: '1280x720' } }); throw Error('synthetic-error-secret'); }
  } });
  const input = f.payload(); input.config.apiKey = 'synthetic-imported-secret';
  await assert.rejects(f.api.importAppConfig(file(input)), error => /保存尚未确认/.test(error.message) && !error.message.includes('synthetic'));
  assert.equal(f.configStore.getState().config.size, '1280x720'); assert.equal(f.configStore.getState().config.apiKey, 'synthetic-imported-secret');
});
test('真实临时SQLite凭据加密写入、冷重开恢复与脱敏再导出', async () => {
  const backend = await generationFixture();
  const key = Buffer.from(backend.key);
  let workspace = backend.workspace, vault = backend.vault, codec, gateway = backend.gateway, coordinator, backendClosed = false;
  const makeCodec = () => createValueCodec({ client: {}, secretPort: createCredentialClient({
    command: async command => ({ format: 'guan-credentials.v1', ref: command.operation === 'store' ? await vault.store(command.value) : (await vault.inspect(command.ref), command.ref) }),
    generationPort: { bind: value => gateway.bind(value), describe: async id => gateway.describe(id), resolveSaved: async profile => gateway.resolveSaved(profile) },
  }) });
  try {
    codec = makeCodec(); const pending = [];
    const f = fixture({ sealConfigurationCredentials: config => sealConfiguration(config, () => backend.gateway), persist: (id, value) => pending.push({ id, value }), flush: async () => {
      for (const { id, value } of pending.splice(0)) {
        const encoded = await codec.encode(value);
        const previous = workspace.readDocument('extension', 'config-safe-' + id);
        workspace.writeDocument({ collection: 'extension', id: 'config-safe-' + id, value: { tree: encoded.tree }, mediaIds: encoded.mediaIds, expectedRevision: previous?.revision || 0, operationId: randomUUID() });
      }
    } });
    const input = f.payload(); input.config.apiKey = 'synthetic-cold-root'; input.config.baseUrl = backend.providerOrigin; input.config.channels[0].apiKey = 'synthetic-cold-channel'; input.config.channels[0].baseUrl = backend.providerOrigin; input.webdav.password = 'synthetic-' + 'cold-dav'; input.config.channels[0].models[0].price = 0.123456;
    await f.api.importAppConfig(file(input));
    assert.match(f.configStore.getState().config.apiKey, /^provider:/);
    assert.match(f.configStore.getState().config.channels[0].apiKey, /^provider:/);
    for (const value of ['synthetic-cold-root', 'synthetic-cold-channel', 'synthetic-cold-dav']) assert.equal(containsText(backend.dataRoot, value), false);
    codec.close(); await backend.close(); backendClosed = true;
    workspace = openWorkspace({ dataRoot: backend.dataRoot }); vault = await openSQLiteCredentialVault({ workspace, keyProvider: { read: async () => Buffer.from(key), create: async () => { throw Error('冷恢复不能新建主密钥'); } } });
    coordinator = createWriteCoordinator();
    const headers = [];
    gateway = createProviderCredentialGateway({ workspace, vault, coordinator, testOrigins: [backend.providerOrigin], requestBytes: async request => {
      headers.push(request.headers.authorization); return { status: 200, contentType: 'application/json', bytes: Buffer.from('{"data":[]}') };
    } });
    codec = makeCodec();
    const restored = await codec.decode(workspace.readDocument('extension', 'config-safe-config').value.tree);
    assert.match(restored.config.apiKey, /^provider:[a-f0-9]{64}$/); assert.match(restored.config.channels[0].apiKey, /^provider:[a-f0-9]{64}$/); assert.match(restored.webdav.password, /^guan-vault:secret:[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(restored).includes('synthetic-cold-'), false);
    for (const binding of [restored.config.apiKey, restored.config.channels[0].apiKey]) await gateway.execute(binding, { method: 'GET', path: '/v1/models', contentType: '', body: '' });
    assert.deepEqual(headers, ['Bearer synthetic-cold-root', 'Bearer ' + 'synthetic-cold-channel']);
    assert.equal(restored.config.channels[0].models[0].price, 0.123456);
    f.configStore.setState(restored); f.api.exportAppConfig(); assert.equal((await f.downloads[0].blob.text()).includes('synthetic-cold-'), false);
    assert.equal(JSON.parse(await f.downloads[0].blob.text()).config.channels[0].models[0].price, 0.123456);
  } finally {
    codec?.close();
    if (backendClosed) { await coordinator?.close(); vault?.close(); workspace.close(); } else await backend.close();
    key.fill(0); rmSync(backend.parent, { recursive: true, force: true });
  }
});

test('导入封存失败不覆盖配置，封存期间的新编辑也不被迟到候选覆盖', async () => {
  const failed = fixture({ sealConfigurationCredentials: async () => { throw Error('unavailable'); } });
  await assert.rejects(failed.api.importAppConfig(file(failed.payload()))); assert.equal(failed.writes, 0);
  const gate = deferred(), entered = deferred();
  const f = fixture({ sealConfigurationCredentials: async config => { entered.resolve(); await gate.promise; return config; } });
  const importing = f.api.importAppConfig(file(f.payload())); await entered.promise;
  f.configStore.setState({ config: { ...f.configStore.getState().config, size: '1280x720' } });
  gate.resolve(); await assert.rejects(importing, /配置已改变/);
  assert.equal(f.writes, 1); assert.equal(f.configStore.getState().config.size, '1280x720');
});
test('当前配置服务只接入根安全模块，装配内容与本轮受测来源一致', () => {
  const service = readFileSync(join(baseline, 'web/src/services/config-file.ts'), 'utf8');
  assert.match(service, /@\/扩展功能\/配置文件\/配置文件安全/);
  assert.equal(readFileSync(join(baseline, 'web/src/扩展功能/配置文件/配置文件安全.ts'), 'utf8'), source);
});
test('脱敏导出保留合法小数与零值，去除价格字段里伪装的秘密', async () => {
  const f = fixture(), cfg = f.configStore.getState().config;
  cfg.channels[0].models = [{ name: 'decimal', capability: 'image', price: 0.000001, script: 'synthetic-script' }, { name: 'zero', capability: 'text', price: 0 }, { name: 'bad', capability: 'text', price: { token: 'synthetic-hidden-secret' } }];
  f.api.exportAppConfig(); const raw = await f.downloads[0].blob.text(), models = JSON.parse(raw).config.channels[0].models;
  assert.equal(models[0].price, 0.000001); assert.equal(models[1].price, 0); assert.equal(Object.hasOwn(models[2], 'price'), false);
  assert.equal(raw.includes('synthetic-script'), false); assert.equal(raw.includes('synthetic-hidden-secret'), false);
});
for (const price of ['1.2', null, -1, [], { token: 'synthetic-hidden-secret' }, Number.MAX_VALUE * 2]) test('拒绝无效导入价格：' + JSON.stringify(price), async () => {
  const f = fixture(), value = f.payload(); value.config.channels[0].models[0].price = price;
  await assert.rejects(f.api.importAppConfig(file(value)), /config.invalidFile/); assert.equal(f.writes, 0);
});
test('合法价格可导入/再导出，缺失价格清空旧值，同渠道安全凭据绑定保持', async () => {
  const f = fixture(), state = f.configStore.getState(); state.config.channels[0].apiKey = 'secret:synthetic-local';
  const input = f.payload(true); input.config.channels[0].apiKey = ''; input.config.channels[0].models[0].price = 0.123456;
  await f.api.importAppConfig(file(input));
  assert.equal(f.configStore.getState().config.channels[0].apiKey, 'secret:synthetic-local');
  assert.equal(f.configStore.getState().config.channels[0].models[0].price, 0.123456);
  f.api.exportAppConfig(); const portable = JSON.parse(await f.downloads[0].blob.text());
  assert.equal(portable.config.channels[0].models[0].price, 0.123456); assert.equal(portable.config.channels[0].apiKey, '');
  delete portable.config.channels[0].models[0].price;
  await f.api.importAppConfig(file(portable));
  assert.equal(Object.hasOwn(f.configStore.getState().config.channels[0].models[0], 'price'), false);
  assert.equal(f.configStore.getState().config.channels[0].apiKey, 'secret:synthetic-local');
});
