import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { 根目录, 上游目录 } from './公共.mjs';
import { ts, 精确替换, 生成候选 } from './检查首批功能适配.mjs';
import { 接入差异 } from '../上游适配/首批功能开关.mjs';
import { productFeatures, requireProductFeature, resolveConfigTab } from '../扩展功能/产品配置/功能开关.ts';

const 候选 = 生成候选();
const 关闭模块 = { productFeatures, requireProductFeature, resolveConfigTab };
const 禁用错误 = { code: 'product_feature_disabled' };

function 加载(文件, 依赖 = {}, globals = {}) {
  const 源 = 候选.get(文件).产物;
  const { outputText } = ts.transpileModule(源, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } });
  const module = { exports: {} };
  const sandbox = { module, exports: module.exports, require: key => {
    if (key === '@/guan/功能开关') return 关闭模块;
    if (Object.hasOwn(依赖, key)) return 依赖[key];
    throw Error(`测试缺少明确依赖：${key}`);
  }, ...globals };
  new vm.Script(outputText, { filename: 文件 }).runInNewContext(sandbox);
  return module.exports;
}

test('统一配置不可由运行时修改，本地代理默认开放，禁用与未知能力拒绝', () => {
  assert.deepEqual(productFeatures, { webdav: false, externalAgent: false, analytics: false, localProxy: true, nodePlugins: false, languageSwitch: false, themeSwitch: false, authorVersion: false, docsLink: false });
  assert.ok(Object.isFrozen(productFeatures));
  assert.throws(() => { productFeatures.webdav = true; }, TypeError);
  for (const key of [...Object.keys(productFeatures).filter(key => !productFeatures[key]), 'unknown']) assert.throws(() => requireProductFeature(key), 禁用错误);
  assert.doesNotThrow(() => requireProductFeature('localProxy'));
});

test('旧 WebDAV 页签回退到渠道，其他保留页签不变', () => {
  assert.equal(resolveConfigTab('webdav'), 'channels');
  for (const tab of ['channels', 'preferences', 'local-proxy', 'prompt-sources', 'local-storage']) assert.equal(resolveConfigTab(tab), tab);
});

test('所有精确候选锚点唯一，缺失和重复时停止，不写源码', () => {
  assert.equal(候选.size, 12);
  assert.equal(精确替换('a b c', [['b', 'd']]), 'a d c');
  assert.throws(() => 精确替换('a', [['b', 'd']]), /不唯一/);
  assert.throws(() => 精确替换('b b', [['b', 'd']]), /不唯一/);
  for (const 项 of 接入差异) assert.equal(候选.get(项.文件).原文, readFileSync(join(上游目录, 项.文件), 'utf8'));
});

test('全部 WebDAV 导出入口禁用时拒绝，不建定时器、不请求、不读取授权', async () => {
  let io = 0;
  const 模块 = 加载('web/src/services/webdav-sync.ts', {
    '@/i18n': { t: key => key },
    '@/stores/use-config-store': { withLocalProxy: () => { io++; } },
  }, {
    fetch: () => { io++; },
    window: { setTimeout: () => { io++; } },
    Headers: class { constructor() { io++; } },
  });
  const 配置 = new Proxy({}, { get() { io++; throw Error('不应读凭据'); } });
  for (const method of ['testWebdavConnection', 'downloadWebdavSyncFile', 'downloadWebdavFile', 'uploadWebdavSyncFile', 'uploadWebdavFile']) {
    await assert.rejects(模块[method](配置, 'file', { size: 1 }), 禁用错误);
  }
  assert.equal(io, 0);
});

test('高层 WebDAV 同步在 hydration、进度事件和业务数据库写入之前拒绝', async () => {
  let io = 0;
  const hit = () => { io++; throw Error('不应执行同步副作用'); };
  const 模块 = 加载('web/src/services/app-sync.ts', {
    localforage: { createInstance: () => ({ getItem: hit, setItem: hit }) },
    '@/i18n': { t: key => key },
    '@/services/file-storage': {},
    '@/services/image-storage': {},
    '@/services/webdav-sync': { downloadWebdavFile: hit, uploadWebdavFile: hit },
    '@/stores/use-asset-store': { useAssetStore: { getState: hit, subscribe: hit } },
    '@/stores/canvas/use-canvas-store': { useCanvasStore: { getState: hit, subscribe: hit } },
  });
  await assert.rejects(模块.syncAppDataToWebdav({}, hit), 禁用错误);
  assert.equal(io, 0);
});

test('Agent 网络入口与包装函数直接调用也拒绝，错误不包含凭据', async () => {
  let requests = 0;
  const 模块 = 加载('web/src/services/api/canvas-agent.ts', { '@/i18n': { t: key => key } }, { fetch: () => { requests++; } });
  const methods = [
    'postState', 'activateAgentClient', 'postToolResult', 'postCodexApproval', 'interruptCodexTurn',
    'acknowledgeCodexHistory', 'revealAgentLocalFile', 'fetchCodexSkills', 'fetchCodexSkill',
    'createCodexSkill', 'createCodexSkillDraft', 'updateCodexSkill', 'deleteCodexSkill', 'setCodexSkillEnabled',
    'fetchAgentJson', 'discoverAgentConfig',
  ];
  for (const method of methods) {
    // 同步包装函数与 async 函数都要处理；所有参数都是合成值。
    await assert.rejects(async () => 模块[method]('https://example.invalid', 'synthetic-test-credential', {}, {}), error => {
      assert.equal(error.code, 'product_feature_disabled');
      assert.ok(!error.message.includes('synthetic-test-credential'));
      return true;
    });
  }
  assert.equal(模块.resolveAgentMessageAssetUrl('https://example.invalid', 'synthetic-test-credential', 'agent-asset:dummy'), '');
  assert.equal(requests, 0);
});

test('已有 Agent 保存配置不能触发连接或打开面板，不覆盖配置', () => {
  let writes = 0;
  const saved = new Map([['canvas-agent-url', 'https://example.invalid'], ['canvas-agent-token', 'synthetic-test-credential']]);
  const create = initializer => {
    let state;
    const set = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
    const get = () => state;
    state = initializer(set, get);
    return { getState: get };
  };
  const 模块 = 加载('web/src/stores/use-agent-store.ts', { zustand: { create }, '@/i18n': { t: key => key } }, {
    window: {},
    localStorage: { getItem: key => saved.get(key), setItem: () => { writes++; } },
  });
  const store = 模块.useAgentStore.getState();
  store.openPanel();
  store.togglePanel();
  store.connectAgent({ silent: true });
  assert.equal(store.panelMounted, false);
  assert.equal(模块.useAgentStore.getState().panelOpen, false);
  assert.equal(模块.useAgentStore.getState().enabled, false);
  assert.equal(模块.useAgentStore.getState().token, saved.get('canvas-agent-token'));
  assert.equal(writes, 0);
});

test('即使构建配置包含统计 ID，禁用后也不注入脚本、不上报', () => {
  let io = 0;
  const 模块 = 加载('web/src/lib/analytics.ts', {
    '@/constant/runtime-config': { ANALYTICS_GA4_ID: 'G-SYNTHETIC', ANALYTICS_BAIDU_ID: '0'.repeat(32) },
  }, {
    window: { gtag: () => { io++; }, _hmt: { push: () => { io++; } } },
    document: { createElement: () => { io++; }, head: { appendChild: () => { io++; } } },
  });
  模块.initAnalytics();
  模块.initAnalytics();
  模块.trackPageview('/canvas/test');
  assert.equal(io, 0);
});

test('Agent 共享插件指令不被禁用，路由定义、保留导航和数据库 schema 不改', () => {
  const bridge = 候选.get('web/src/pages/canvas/hooks/use-agent-bridge.ts');
  const before = bridge.原文.slice(bridge.原文.indexOf('    const applyAgentOps ='), bridge.原文.indexOf('    useEffect(() => {'));
  const after = bridge.产物.slice(bridge.产物.indexOf('    const applyAgentOps ='), bridge.产物.indexOf('    useEffect(() => {'));
  assert.equal(after, before);
  const route = 候选.get('web/src/router.tsx');
  assert.equal(route.产物.slice(route.产物.indexOf('        children: [')), route.原文.slice(route.原文.indexOf('        children: [')));
  assert.ok(!接入差异.some(item => /canvas-agent-ops|use-plugin-host|use-canvas-store|use-config-store|navigation-tools|image-storage|file-storage/.test(item.文件)));
  for (const item of 接入差异) {
    for (const [, 新文] of item.替换) assert.ok(!/removeItem|clear\(|deleteDatabase/.test(新文));
  }
  assert.ok(!/localStorage|indexedDB|removeItem|deleteDatabase/.test(候选.get('web/src/guan/功能开关.ts').产物));
  assert.ok(readFileSync(join(根目录, '开发工具/检查运行副本.mjs'), 'utf8').includes('上游适配/模型编辑器语义.json'));
  assert.ok(!readFileSync(join(根目录, '开发工具/检查运行副本.mjs'), 'utf8').includes('首批功能开关'));
});
