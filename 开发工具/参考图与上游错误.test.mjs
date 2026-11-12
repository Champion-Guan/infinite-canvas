import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { variantModules, variantFixture } from './产品变体生成夹具.mjs';
import { generationFixture } from './生成网关隔离夹具.mjs';
import { createGenerationClient } from '../扩展功能/生成任务/生成任务客户端.mjs';
import { runCanvasImageTask } from '../扩展功能/画布生成/图片任务衔接.mjs';
import { GENERATION_PROTOCOL } from '../扩展功能/生成网关/生成协议.mjs';
import { upstreamFailureMessage } from '../扩展功能/生成任务/上游失败原因.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const limitError = /最多支持 14 张，当前有 15 张/;
const providerError = '请求携带的图片数量过多，最多只能上传 14 张图片。';
const refs = count => Array.from({ length: count }, (_, i) => ({ id: `reference-${i}`, name: `${i}.png`, type: 'image/png',
    dataUrl: 'data:image/png;base64,' + Buffer.from('合成参考图').toString('base64') }));

test('单次参考图14张可编码，15张在读取图片前拒绝，OpenAI与Gemini一致', async () => {
    let reads = 0;
    const loader = variantModules({
        '@/i18n/index': { default: { t: key => key } },
        '@/stores/use-config-store': { resolveModelRequestConfig: config => config, resolveModelScript: () => '' },
        '@/lib/image-reference-prompt': { buildImageReferencePromptText: text => text },
        '@/services/image-storage': { imageToDataUrl: async image => { reads++; return image.dataUrl; } },
        '@/lib/image-utils': { dataUrlToFile: image => new File([image.dataUrl], image.name, { type: image.type }) },
    });
    const { prepareOriginalImageRequest } = loader.load('画布生成/原版图片协议.ts');
    const base = { model: 'gpt-image-2.5', apiFormat: 'openai', baseUrl: 'https://example.com', quality: 'high',
        count: '1', size: '1024x1024', systemPrompt: '', background: '' };
    for (const apiFormat of ['openai', 'gemini']) {
        const config = { ...base, apiFormat, model: apiFormat === 'gemini' ? 'gemini-image' : base.model };
        const request = await prepareOriginalImageRequest(config, '拍摄实物', refs(14));
        assert.equal(reads, apiFormat === 'openai' ? 14 : 28);
        if (apiFormat === 'openai') {
            const body = await new Response(Buffer.from(request.body, 'base64'), { headers: { 'content-type': request.contentType } }).formData();
            assert.equal(body.getAll('image[]').length, 14);
        } else {
            const body = JSON.parse(Buffer.from(request.body, 'base64').toString());
            assert.equal(body.contents[0].parts.filter(part => part.inlineData).length, 14);
        }
        const before = reads;
        await assert.rejects(prepareOriginalImageRequest(config, '拍摄实物', refs(15)), limitError);
        assert.equal(reads, before, '超限不加载、编码或上传图片');
    }
});

test('编辑原图计入总数，同一节点去重，不静默截掉第15张图', () => {
    const { imageGenerationReferences, assertImageReferenceLimit } = variantModules().load('画布生成/参考图数量限制.ts');
    const source = { id: 'original', type: 'image', title: '原图', metadata: { content: refs(1)[0].dataUrl } };
    const references = refs(14), before = structuredClone(references);
    const withSource = imageGenerationReferences(source, references);
    assert.equal(withSource.length, 15);
    assert.throws(() => assertImageReferenceLimit(withSource), limitError);
    assert.equal(imageGenerationReferences(source, [{ ...references[0], id: 'original' }, ...references.slice(1)]).length, 14);
    assert.equal(imageGenerationReferences(source, references, true).length, 14);
    assert.deepEqual(references, before);
});

test('产品可保留28张图供两个变体分别各用14张，单变体加共用图15张则整批预检拒绝', () => {
    const loader = variantModules(), f = variantFixture();
    const images = Array.from({ length: 28 }, (_, i) => f.image(`image-${i}`));
    f.parameter.metadata.productMainImages = images;
    f.parameter.metadata.productSharedImageIds = [];
    f.parameter.metadata.productVariants.forEach((variant, i) => {
        variant.imageIds = images.slice(i * 14, (i + 1) * 14).map(image => image.id);
        variant.primaryImageId = variant.imageIds[0];
    });
    const generation = loader.load('画布生成/产品变体生成.ts');
    assert.equal(generation.planProductGenerationJobs([f.config], f.nodes, f.connections, 'batch').length, 2);
    f.parameter.metadata.productSharedImageIds = [images[27].id];
    assert.throws(() => generation.planProductGenerationJobs([f.config], f.nodes, f.connections, 'batch'), limitError);
    assert.equal(f.parameter.metadata.productMainImages.length, 28, '不删除或截断素材');
});

test('批量在任一配置超限时整批不提交，其余配置不先发出；调整到14张后正常执行', async () => {
    let count = 15, generated = 0;
    const errors = [];
    const loader = variantModules({
        '@/lib/canvas/canvas-generation-helpers': { getGenerationCount: value => Number(value || 1), buildGenerationConfig: () => ({ model: '合成模型' }) },
        './商品提示词生成': { buildProductGenerationContext: id => ({ referenceImages: refs(id === 'B' ? count : 1) }) },
        './批量保存协调': { beginBatchCanvasSave() {}, finishBatchCanvasSave: () => null, completeBatchCanvasSave() {} },
    });
    const { useCanvasBatchGeneration } = loader.load('画布生成/批量生成操作.ts');
    const nodesRef = { current: ['A', 'B'].map(id => ({ id, type: 'config', position: { x: 0, y: 0 },
        width: 340, height: 240, metadata: { generationMode: 'image' } })) };
    const api = useCanvasBatchGeneration({ projectId: 'synthetic', nodesRef, connectionsRef: { current: [] }, effectiveConfig: {},
        setNodes() {}, setConnections() {}, setSelectedNodeIds() {}, setSelectedConnectionId() {},
        handleGenerateNode: async () => { generated++; }, message: { info() {}, error: text => errors.push(text) } });
    await api.generateAllConfigNodes();
    assert.equal(generated, 0);
    assert.match(errors[0], limitError);
    count = 14;
    await api.generateAllConfigNodes();
    assert.equal(generated, 2);
});

for (const [name, body, type, expected] of [
    ['OpenAI/Gemini', { error: { message: providerError } }, 'application/json', providerError],
    ['中转msg', { code: 400, msg: providerError }, 'application/json', providerError],
    ['detail', { detail: providerError }, 'application/json', providerError],
    ['纯文本', 'status_code=400, ' + providerError, 'text/plain', providerError],
    ['HTML', '<html><body>内部错误</body></html>', 'text/html', '上游返回 HTTP 400，生成失败。'],
    ['未知JSON', { prompt: '不应显示请求正文', internal: '堆栈' }, 'application/json', '上游返回 HTTP 400，生成失败。'],
]) test(`上游错误解析：${name}`, () => {
    const bytes = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    assert.ok(upstreamFailureMessage(bytes, 400, type).includes(expected));
    assert.doesNotMatch(upstreamFailureMessage(bytes, 400, type), /内部错误|不应显示请求正文|堆栈/);
});

test('HTTP400原文经网关脱敏、SQLite落盘及客户端摘要核验后显示，不重新提交或切换渠道', async () => {
    const f = await generationFixture(), records = [], operations = [];
    try {
        const binding = await f.bind();
        f.reply.status = 400;
        f.reply.bytes = Buffer.from(JSON.stringify({ error: { message: `${providerError} ${binding.value}` } }));
        const client = createGenerationClient({ command: async value => {
            operations.push(value.operation);
            let result;
            if (value.operation === 'submit') result = await f.tasks.submit(value.task);
            else if (value.operation === 'get') result = f.tasks.get(value.id);
            else if (value.operation === 'result') {
                const saved = f.tasks.result(value.id);
                result = { ...saved, bytes: saved.bytes.toString('base64') };
            } else assert.fail(`不应执行 ${value.operation}`);
            return { protocol: GENERATION_PROTOCOL, result };
        } });
        const options = { host: client, scope: { productId: 'product-A', nodeId: 'result-A', slotId: 'slot' },
            bind: async () => binding.binding, prepare: async () => f.submit(binding.binding).request,
            recordTask: async task => records.push(task), wait: () => f.tasks.drain(),
            applyAndSave: () => assert.fail('失败响应不得应用成成功图片') };
        await assert.rejects(runCanvasImageTask(options), error => {
            assert.equal(error.code, 'generation_failed'); assert.equal(error.status, 400);
            assert.ok(error.message.includes(providerError));
            assert.doesNotMatch(error.message, /原生成任务未成功|synthetic-not-real/);
            return true;
        });
        assert.equal(records.length, 1); assert.equal(f.requests.length, 1);
        assert.equal(operations.filter(value => value === 'result').length, 1);
        await assert.rejects(runCanvasImageTask({ ...options, previous: records[0] }), error =>
            error.code === 'generation_explicit_retry_required' && error.message.includes(providerError));
        assert.equal(f.requests.length, 1);
        const saved = f.tasks.result(records[0].taskId);
        assert.equal(saved.result.id, digest(saved.bytes));
        assert.doesNotMatch(saved.bytes.toString(), /synthetic-not-real/);
    } finally { await f.close(); }
});

test('失败响应内容或归属被篡改时不展示正文，保留失败状态且不发新请求', async () => {
    const id = '00000000-0000-4000-8000-000000000001', bytes = Buffer.from('{"error":{"message":"伪造的错误"}}');
    const job = { id, productId: 'A', nodeId: 'N', state: 'failed', applied: false, bytes: bytes.toString('base64'),
        result: { id: '0'.repeat(64), status: 400, contentType: 'application/json', size: bytes.length } };
    const commands = [], client = createGenerationClient({ command: async value => {
        commands.push(value.operation);
        return { protocol: GENERATION_PROTOCOL, result: structuredClone(job) };
    } });
    await assert.rejects(client.failure({ id, productId: 'A', nodeId: 'N' }), error => error.code === 'generation_result_invalid');
    job.result.id = digest(bytes); job.productId = 'other';
    await assert.rejects(client.failure({ id, productId: 'A', nodeId: 'N' }), error => error.code === 'generation_scope_mismatch');
    assert.deepEqual(commands, ['result', 'result']);
});
