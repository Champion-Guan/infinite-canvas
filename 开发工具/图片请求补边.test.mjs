import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { imageRequestSizePlan, padImageReference, prepareGeneratedDelivery } from '../扩展功能/媒体交付/生成图片尺寸交付.mjs';
import { variantModules } from './产品变体生成夹具.mjs';

function protocol() {
    return variantModules({
        '@/i18n/index': { t: key => key },
        '@/stores/use-config-store': { resolveModelRequestConfig: value => value,
            resolveModelChannel: () => ({ id: 'test', name: '测试渠道' }), resolveModelScript: () => null },
        '@/lib/image-utils': { dataUrlToFile: image => new File([Buffer.from(image.dataUrl.split(',')[1], 'base64')], image.name, { type: 'image/png' }) },
        '@/services/image-storage': { imageToDataUrl: async image => image.dataUrl },
        '@/lib/image-reference-prompt': { buildImageReferencePromptText: text => text },
    }).load('画布生成/原版图片协议.ts');
}
const config = size => ({ model: 'gpt-image-2.5', quality: 'auto', size, count: '1', baseUrl: 'https://example.invalid', apiFormat: 'openai', systemPrompt: '' });

function rasterHost() {
    const before = { createImageBitmap: globalThis.createImageBitmap, document: globalThis.document, FileReader: globalThis.FileReader };
    let closed = 0, encodes = 0, canvases = [];
    globalThis.createImageBitmap = async blob => {
        const image = await loadImage(Buffer.from(await blob.arrayBuffer()));
        image.close = () => { closed++; }; return image;
    };
    globalThis.document = { createElement: () => {
        const canvas = createCanvas(1, 1); canvases.push(canvas);
        canvas.toBlob = callback => { encodes++; canvas.encode('png').then(value => callback(new Blob([value], { type: 'image/png' }))); };
        return canvas;
    } };
    globalThis.FileReader = class {
        readAsDataURL(blob) { blob.arrayBuffer().then(value => { this.result = 'data:image/png;base64,' + Buffer.from(value).toString('base64'); this.onload(); }, () => this.onerror()); }
    };
    return { closed: () => closed, encodes: () => encodes,
        restore() { Object.assign(globalThis, before); } };
}
async function source(width, height) {
    const canvas = createCanvas(width, height), context = canvas.getContext('2d');
    context.fillStyle = '#3ba581'; context.fillRect(0, 0, width, height);
    context.clearRect(20, 20, 15, 15);
    context.fillStyle = '#f53b57'; context.fillRect(0, 0, 4, height); context.fillRect(width - 4, 0, 4, height);
    const bytes = await canvas.encode('png');
    return { bytes, dataUrl: 'data:image/png;base64,' + bytes.toString('base64') };
}
function pixelData(image) {
    const canvas = createCanvas(image.width, image.height), context = canvas.getContext('2d');
    context.drawImage(image, 0, 0); return Buffer.from(context.getImageData(0, 0, image.width, image.height).data);
}

test('两个客户尺寸只补少量边缘，已有合法等比和已对齐尺寸保持原行为', () => {
    for (const [width, height, outputWidth, outputHeight, left] of [[790,1376,800,1376,5], [1176,2048,1184,2048,4]]) {
        const result = imageRequestSizePlan(width, height);
        assert.deepEqual([result.width, result.height, result.padding.left], [outputWidth, outputHeight, left]);
        assert.equal(result.padding.contentWidth, width); assert.equal(result.padding.contentHeight, height);
    }
    assert.deepEqual(imageRequestSizePlan(900,1200), { width: 912, height: 1216 });
    assert.deepEqual(imageRequestSizePlan(1152,1536), { width: 1152, height: 1536 });
    assert.deepEqual(imageRequestSizePlan(800,500), { width: 1024, height: 640 });
    for (const dimensions of [[4000,2000],[3840,3840],[700,2200],[0,100],[NaN,100]])
        assert.throws(() => imageRequestSizePlan(...dimensions));
});

test('不同宽高组合都满足网格、像素和比例范围，补边不产生数倍尺寸暴涨', () => {
    for (let width = 310; width <= 2600; width += 37) for (let height = 320; height <= 2600; height += 43) {
        if (Math.max(width,height) / Math.min(width,height) > 3) continue;
        const result = imageRequestSizePlan(width,height);
        assert.equal(result.width % 16, 0); assert.equal(result.height % 16, 0);
        assert.ok(result.width * result.height >= 655360 && result.width * result.height <= 8294400);
        assert.ok(result.width <= 3840 && result.height <= 3840);
        assert.ok(Math.max(result.width,result.height) <= Math.min(result.width,result.height) * 3);
        if (result.padding) {
            const p = result.padding;
            assert.ok(p.width - p.contentWidth <= 31 && p.height - p.contentHeight <= 31);
            assert.ok(p.contentWidth >= width && p.contentHeight >= height);
        }
    }
});

test('普通生图真实编码使用800×1376，响应携带可逆补边信息而原配置保持790×1376', async () => {
    const api = protocol(), original = config('790x1376'), before = structuredClone(original);
    const request = await api.prepareOriginalImageRequest(original, '画面内保留商品和标题');
    const body = JSON.parse(Buffer.from(request.body, 'base64'));
    assert.equal(body.size, '800x1376'); assert.match(body.prompt, /x=5, y=0, width=790, height=1376/);
    const images = api.parseOriginalImageResponse(original, Buffer.from(JSON.stringify({ data: [{ b64_json: 'dGVzdA==' }] })).toString('base64'));
    assert.equal(images[0].deliverySize, '790x1376'); assert.equal(images[0].upstreamSize, '800x1376');
    assert.deepEqual(images[0].padding, imageRequestSizePlan(790,1376).padding);
    assert.deepEqual(original, before);
});

for (const [width,height] of [[790,1376],[1176,2048]]) test(`${width}×${height}编辑真实multipart补边，交付后像素完整恢复且原字节不变`, async () => {
    const host = rasterHost();
    try {
        const original = await source(width,height), before = Buffer.from(original.bytes), api = protocol();
        const reference = { id:'source', name:'原图.png', dataUrl:original.dataUrl, type:'image/png' };
        const request = await api.prepareOriginalImageRequest(config(`${width}x${height}`), '只换语言', [reference]);
        const body = await new Response(Buffer.from(request.body,'base64'), { headers:{'content-type':request.contentType} }).formData();
        const plan = imageRequestSizePlan(width,height), file = body.get('image');
        assert.equal(body.get('size'), `${plan.width}x${plan.height}`);
        const padded = await loadImage(Buffer.from(await file.arrayBuffer()));
        assert.deepEqual([padded.width,padded.height],[plan.width,plan.height]);
        const delivered = await prepareGeneratedDelivery(file, {width:padded.width,height:padded.height}, {targetSize:`${width}x${height}`,padding:plan.padding});
        const restored = await loadImage(Buffer.from(await delivered.blob.arrayBuffer()));
        assert.deepEqual(pixelData(restored),pixelData(await loadImage(original.bytes)));
        assert.deepEqual(original.bytes,before); assert.equal(reference.dataUrl,original.dataUrl);
        assert.match(delivered.deliveryNote,/移除请求适配补边/); assert.equal(host.closed(),2);
        const second = await api.prepareOriginalImageRequest(config(`${width}x${height}`), '只换语言', [reference]);
        assert.equal(second.body,request.body,'重试准备得到相同请求哈希，不更改未决任务内容');
    } finally { host.restore(); }
});

test('尺寸不符、缺失或篡改补边记录不裁图；取消释放位图；非同画幅参考不改写', async () => {
    const host=rasterHost();
    try {
        const plan=imageRequestSizePlan(790,1376), original=await source(790,1376);
        const encoded=await padImageReference(original.dataUrl,plan.padding), blob=new Blob([Buffer.from(encoded.split(',')[1],'base64')],{type:'image/png'});
        await assert.rejects(prepareGeneratedDelivery(blob,{width:1024,height:1536},{targetSize:'790x1376',padding:plan.padding}),{code:'image_delivery_size_mismatch'});
        await assert.rejects(prepareGeneratedDelivery(blob,{width:800,height:1376},{targetSize:'790x1376',padding:{...plan.padding,left:4}}),/记录/);
        await assert.rejects(prepareGeneratedDelivery(blob,{width:800,height:1376},{targetSize:'790x1376'}),{code:'image_delivery_size_mismatch'});
        const before=host.encodes(), controller=new AbortController();controller.abort();
        await assert.rejects(prepareGeneratedDelivery(blob,{width:800,height:1376},{targetSize:'790x1376',padding:plan.padding,signal:controller.signal}),{name:'AbortError'});
        assert.equal(host.encodes(),before);
        const unrelated=await source(64,64);
        assert.equal(await padImageReference(unrelated.dataUrl,plan.padding),unrelated.dataUrl);
    } finally{host.restore();}
});

test('独立原生生图接口与编辑接口复用同一尺寸方案，不依赖画布工具入口', async () => {
    const host=rasterHost(), requests=[];
    try {
        const loader=variantModules({
            '@/扩展功能/产品配置/模型配置门禁': {requireModelConfigured(){}},
            '@/扩展功能/生成网关/模型读取客户端': {},
            '@/扩展功能/网络代理/本地转发请求': {本地转发Axios:{post:async(url,body)=>{
                requests.push({url,body}); return {data:{data:[{b64_json:'dGVzdA=='}]}};
            }}},
            '@/stores/use-config-store': {resolveModelRequestConfig:value=>value,resolveModelScript:()=>null,
                withLocalProxy:value=>value,buildApiUrl:(base,path)=>base+path},
            './model-plugin': {},
            '@/lib/image-utils': {dataUrlToFile:image=>new File([Buffer.from(image.dataUrl.split(',')[1],'base64')],image.name,{type:'image/png'})},
            '@/services/image-storage': {imageToDataUrl:async image=>image.dataUrl},
            '@/lib/image-reference-prompt': {buildImageReferencePromptText:text=>text},
        });
        const api=loader.load('services/api/image.ts',true), settings=config('790x1376');
        const generated=await api.requestGeneration(settings,'完整商品图');
        assert.equal(requests[0].body.size,'800x1376');
        assert.match(requests[0].body.prompt,/transport padding/);
        assert.deepEqual(generated[0].padding,imageRequestSizePlan(790,1376).padding);
        const photo=await source(790,1376);
        const edited=await api.requestEdit(settings,'只换语言',[{id:'source',name:'原图.png',type:'image/png',dataUrl:photo.dataUrl}]);
        assert.equal(requests[1].body.get('size'),'800x1376');
        assert.deepEqual(edited[0].padding,generated[0].padding);
        const image=await loadImage(Buffer.from(await requests[1].body.get('image').arrayBuffer()));
        assert.deepEqual([image.width,image.height],[800,1376]);
        assert.equal(settings.size,'790x1376');
    } finally{host.restore();}
});
