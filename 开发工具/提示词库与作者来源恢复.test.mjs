import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { variantModules } from './产品变体生成夹具.mjs';

const root = resolve(import.meta.dirname, '..'), web = resolve(root, '.运行/3100源/画布副本/web');
const ts = createRequire(resolve(web, 'package.json'))('typescript');
const loader = variantModules(), policy = loader.load('产品配置/脚本与提示词来源.ts');
const presets = loader.load('services/api/prompt-source-presets.ts', true);
const loadText = source => {
    const module = { exports: {} };
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('require', 'module', 'exports', code)(id => { assert.equal(id, 'nanoid'); return { nanoid: () => 'new-source' }; }, module, module.exports);
    return module.exports;
};

test('提示词库、来源管理、新增、自动和全部刷新恢复；其他关闭功能不受影响', () => {
    for (const key of ['promptLibrary', 'promptSources', 'promptRefresh', 'promptSourceCreate', 'promptRefreshAll']) {
        assert.equal(policy.businessFeatures[key], true);
        assert.doesNotThrow(() => policy.requireBusinessFeature(key));
    }
    assert.throws(() => policy.requireBusinessFeature('modelScripts'), { code: 'product_feature_disabled' });
    assert.equal(policy.resolveBusinessConfigTab('prompt-sources'), 'prompt-sources');
    assert.equal(loader.load('产品配置/功能开关.ts').productFeatures.excel, false);
});

test('七个来源逐字段与锁定的作者版本一致，配置过滤保留原作者来源及自定义来源', () => {
    const baseline = JSON.parse(readFileSync(resolve(root, '上游基线.json'), 'utf8'));
    const original = loadText(execFileSync('git', ['show', `${baseline.提交}:web/src/services/api/prompt-source-presets.ts`],
        { cwd: resolve(root, baseline.目录), encoding: 'utf8' }));
    assert.equal(presets.DEFAULT_PROMPT_SOURCES.length, 7);
    assert.deepEqual(presets.DEFAULT_PROMPT_SOURCES, original.DEFAULT_PROMPT_SOURCES);
    const custom = { id: 'custom', name: '自定义', builtIn: false };
    assert.deepEqual(presets.filterWorkbenchPromptSources([...original.DEFAULT_PROMPT_SOURCES, custom]), [...original.DEFAULT_PROMPT_SOURCES, custom]);
});

test('旧空来源恢复预装来源，合并保留自定义、禁用状态与调度，不覆盖保存的数据', () => {
    for (const savedSources of [[], [{ ...presets.DEFAULT_PROMPT_SOURCES[0], enabled: false }]]) {
        let store;
        const custom = { id: 'custom', name: '原有来源', url: 'https://example.com/prompts.json', homepage: '', enabled: true, builtIn: false };
        const persisted = { sources: [...savedSources, custom], excelSources: { kept: { enabled: false } },
            schedule: { intervalMinutes: 60, lastFetchedAt: 'previous-refresh' } };
        const before = structuredClone(persisted);
        const api = variantModules({
            zustand: { create: () => initializer => {
                const get = () => store;
                store = initializer(patch => { store = { ...store, ...(typeof patch === 'function' ? patch(store) : patch) }; }, get);
                return { getState: get };
            } },
            'zustand/middleware': { createJSONStorage: () => ({}), persist: (initializer, options) => (set, get) => options.merge(persisted, initializer(set, get)) },
            '@/扩展功能/本机存储/上游浏览器存储桥': { sqliteStateStorage: {} },
        }).load('stores/use-prompt-source-store.ts', true).usePromptSourceStore;
        assert.equal(api.getState().sources.length, 8);
        assert.deepEqual(api.getState().sources.at(-1), custom);
        assert.equal(api.getState().sources[0].enabled, savedSources.length ? false : true);
        assert.deepEqual(api.getState().schedule, persisted.schedule);
        assert.deepEqual(api.getState().excelSources, persisted.excelSources);
        api.getState().saveSource({ ...custom, name: '编辑后' });
        assert.equal(api.getState().sources.at(-1).name, '编辑后');
        api.getState().updateSchedule('intervalMinutes', 0);
        assert.equal(api.getState().schedule.intervalMinutes, 0);
        assert.deepEqual(persisted, before);
    }
});

test('首次加载拉取内置提示词并缓存，搜索与来源读取可用；刷新失败保留已有提示词', async () => {
    const cache = new Map(), source = presets.DEFAULT_PROMPT_SOURCES[0];
    let requests = 0, fail = false;
    const api = variantModules({
        '@/扩展功能/本机存储/上游浏览器存储桥': { sqliteForage: { createInstance: () => ({
            getItem: async key => cache.get(key), setItem: async (key, value) => { cache.set(key, value); },
        }) } },
        '@/stores/use-prompt-source-store': { usePromptSourceStore: { getState: () => ({ sources: [source] }) } },
        './prompt-source-runtime': { runPromptSource: async () => {
            requests++; if (fail) throw Error('网络暂不可用');
            return [{ id: 'original', title: '原作者提示词', prompt: 'Product photography with soft daylight', tags: ['商品'], referenceImageUrls: [] }];
        } },
    }).load('services/api/prompts.ts', true);
    assert.equal((await api.fetchPrompts({ keyword: 'daylight' })).total, 1);
    assert.equal(requests, 1);
    assert.equal((await api.fetchSourcePrompts(source.id))[0].title, '原作者提示词');
    assert.equal(requests, 1);
    fail = true;
    await assert.rejects(api.refreshSource(source.id), /网络暂不可用/);
    assert.equal((await api.fetchPrompts()).total, 1);
    assert.equal((await api.fetchPromptSourceStatuses())[source.id].count, 1);
});

test('公开HTTPS提示词JSON使用本机转发，保留取消信号及原始URL作为相对图片地址基准', async () => {
    const calls = [], signal = new AbortController().signal;
    const source = presets.DEFAULT_PROMPT_SOURCES[0];
    const runtime = variantModules({
        '@/扩展功能/网络代理/本地转发请求': {
            本地转发地址: url => `http://localhost/relay/${url}`,
            本地转发请求: async (url, options) => {
                calls.push({ url, options });
                return { ok: true, json: async () => [{ id: 'one', title: '标题', prompt: 'prompt', coverUrl: './cover.png' }] };
            },
        },
    }).load('services/api/prompt-source-runtime.ts', true);
    const items = await runtime.runPromptSource(source, { signal });
    assert.equal(calls[0].url, `http://localhost/relay/${source.url}`);
    assert.equal(calls[0].options.signal, signal);
    assert.equal(items[0].coverUrl, new URL('./cover.png', source.url).href);
});

test('全部来源排队使用同一代理入口，失败不阻断后续来源，已取消的排队请求不发送', async () => {
    let active = 0, peak = 0, release;
    const calls = [], pending = new Promise(resolve => { release = resolve; });
    const controller = new AbortController();
    const runtime = variantModules({
        '@/扩展功能/网络代理/本地转发请求': {
            本地转发地址: url => url,
            本地转发请求: async url => {
                calls.push(url); peak = Math.max(peak, ++active);
                try {
                    if (calls.length === 1) { await pending; throw Error('模拟网络失败'); }
                    return { ok: true, json: async () => [{ title: '正常', prompt: 'preserved prompt' }] };
                } finally { active--; }
            },
        },
    }).load('services/api/prompt-source-runtime.ts', true);
    const [one, two, three] = presets.DEFAULT_PROMPT_SOURCES;
    const results = Promise.allSettled([
        runtime.runPromptSource(one),
        runtime.runPromptSource(two, { signal: controller.signal }),
        runtime.runPromptSource(three),
    ]);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [one.url]);
    controller.abort(); release();
    const settled = await results;
    assert.deepEqual(calls, [one.url, three.url]);
    assert.equal(peak, 1);
    assert.deepEqual(settled.map(result => result.status), ['rejected', 'rejected', 'fulfilled']);
});
