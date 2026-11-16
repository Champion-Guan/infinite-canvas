import test from 'node:test';
import assert from 'node:assert/strict';
import { variantModules } from './产品变体生成夹具.mjs';

function fixture() {
    const requests = [], bindings = [];
    const resolveModelChannel = (config, model) => config.channels.find(channel => channel.id === model.split('::')[0]) || config.channels[0];
    const resolveModelRequestConfig = (config, model) => ({ ...config, ...resolveModelChannel(config, model), model: model.split('::').at(-1) });
    const api = variantModules({
        '@/stores/use-config-store': {
            encodeChannelModel: (id, name) => `${id}::${name}`, resolveModelChannel, resolveModelRequestConfig,
            fallbackModelsByCapability: config => config.candidates,
        },
        '../画布生成/原版图片协议': {
            async prepareOriginalImageRequest(config) { requests.push(config); return { body: 'e30=', path: '/v1/images/generations' }; },
            parseOriginalImageResponse(config) { return [{ model: config.model, size: config.size }]; },
        },
        '../画布生成/图片任务衔接.mjs': { imageRequestHash: async () => 'hash' },
        './浏览器状态': { fallbackHost: () => ({ read: async () => ({ revision: 1 }) }) },
    }).load('故障切换/图片路由请求.ts');
    const config = {
        model: 'a::gpt-image-2.6-sunburst-1k', size: '1800x2400', quality: 'high',
        channels: [{ id: 'a', name: '客户随意命名', baseUrl: 'https://api.kunrouai.com/v1', apiFormat: 'openai',
            models: ['gpt-image-2.6-sunburst-1k', 'gpt-image-2.6-sunburst-4k', 'gpt-image-2.5-sunburst-4k'].map(name => ({ name, capability: 'image' })) }],
    };
    return { api, config, requests, bindings, bind: async config => { bindings.push(config); return 'binding'; } };
}

test('大于1k的目标仅升级同渠道完全同名4k，配置不变且绑定与任务记录使用实际型号', async () => {
    const f = fixture(), before = structuredClone(f.config);
    const result = await f.api.prepareRoutedImageRequest(f.config, '商品', [], f.bind);
    assert.equal(f.requests[0].model, 'a::gpt-image-2.6-sunburst-4k');
    assert.equal(f.requests[0].size, '1800x2400');
    assert.equal(f.bindings[0].model, f.requests[0].model);
    assert.equal(result.plan.candidates[0].modelName, 'gpt-image-2.6-sunburst-4k');
    assert.deepEqual(f.config, before);
});

test('缺少同名4k不跨版本、系列或渠道找替代，不使用脚本型号', () => {
    for (const replacement of ['gpt-image-2.5-sunburst-4k', 'gpt-image-2.6-flare-4k', 'gpt-image-2.6-4k']) {
        const { api, config } = fixture();
        config.channels[0].models = [{ name: replacement, capability: 'image' }];
        config.channels.push({ ...config.channels[0], id: 'b', models: [{ name: 'gpt-image-2.6-sunburst-4k', capability: 'image' }] });
        assert.equal(api.preferLargeImageModel(config, config.model), config.model);
    }
    const { api, config } = fixture();
    config.channels[0].models[1].script = 'custom';
    assert.equal(api.preferLargeImageModel(config, config.model), config.model);
    config.channels[0].models[1].script = undefined;
    config.channels[0].models[0].script = 'custom';
    assert.equal(api.preferLargeImageModel(config, config.model), config.model);
});

test('1k预设、800×500、auto、比例值、其他域名及已选4k不改型号', () => {
    for (const size of ['1152x1536', '1536x1024', '1024x1024', '800x500', 'auto', '3:4']) {
        const { api, config } = fixture(); config.size = size;
        assert.equal(api.preferLargeImageModel(config, config.model), config.model, size);
    }
    for (const baseUrl of ['https://api-cn.hi-code.cc', 'https://api.kunrouai.com.evil.invalid']) {
        const { api, config } = fixture(); config.channels[0].baseUrl = baseUrl;
        assert.equal(api.preferLargeImageModel(config, config.model), config.model);
    }
    const { api, config } = fixture(); config.model = 'a::gpt-image-2.6-sunburst-4k';
    assert.equal(api.preferLargeImageModel(config, config.model), config.model);
});

test('Fallback逐候选按自己的渠道规则升级，结果恢复不重新选择型号', async () => {
    const f = fixture();
    f.config.fallbackRequested = true; f.config.fallbackCapability = 'image';
    f.config.channels.push({ ...f.config.channels[0], id: 'b', baseUrl: 'https://api-cn.hi-code.cc' });
    f.config.candidates = [f.config.model, 'b::gpt-image-2.6-sunburst-1k'];
    const result = await f.api.prepareRoutedImageRequest(f.config, '商品', [], f.bind);
    assert.deepEqual(result.plan.candidates.map(item => item.modelName), ['gpt-image-2.6-sunburst-4k', 'gpt-image-2.6-sunburst-1k']);
    const image = f.api.parseRoutedImageResponse(f.config, '', { profileId: 'a', modelName: 'gpt-image-2.6-sunburst-4k',
        modelOption: 'a::gpt-image-2.6-sunburst-4k', endpoint: f.config.channels[0].baseUrl, kind: 'openai', quality: 'high', size: '1800x2400' })[0];
    assert.equal(image.model, 'a::gpt-image-2.6-sunburst-4k');
});

test('Fallback升级后与已有4k候选相同，只准备一次，不重复计费尝试', async () => {
    const f = fixture();
    f.config.fallbackRequested = true; f.config.fallbackCapability = 'image';
    f.config.candidates = [f.config.model, 'a::gpt-image-2.6-sunburst-4k'];
    const result = await f.api.prepareRoutedImageRequest(f.config, '商品', [], f.bind);
    assert.equal(f.requests.length, 1);
    assert.equal(result.plan.candidates.length, 1);
});
