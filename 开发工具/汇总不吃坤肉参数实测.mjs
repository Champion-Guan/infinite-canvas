import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = resolve(import.meta.dirname, '..');
const output = join(root, '开发文档/不吃坤肉图像参数实测20261116');
const testsAt = directory => ['测试结果.json', '补充测试结果.json'].flatMap(name => {
  const path = join(directory, name);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).tests : [];
});
const tests = testsAt(output);
const previous = testsAt(join(root, '开发文档/图像渠道参数实测20261116'));
const esc = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const result = test => {
  if (!test) return '未测试';
  const images = test.images?.filter(image => image.width);
  if (images?.length) return images.map(image => `${image.width}×${image.height} ${image.type}${image.transparentPixels ? ' 含透明像素' : ''}`).join('; ');
  return `${test.status || '未确认'} ${typeof test.error === 'string' ? test.error : test.error?.message || '无可解析图片'}`;
};
const dimensions = tests.filter(test => test.request.size && test.images?.some(image => image.width));
const mismatches = dimensions.filter(test => test.request.size !== 'auto'
  && test.images.some(image => image.width && `${image.width}x${image.height}` !== test.request.size));
const formatMismatches = tests.filter(test => test.request.output_format && test.images?.some(image => image.type && image.type !== test.request.output_format));
const metadataMismatches = tests.filter(test => test.responseMetadata?.size && test.images?.some(image => image.width && `${image.width}x${image.height}` !== test.responseMetadata.size));
const qualityTests = tests.filter(test => test.id.startsWith('质量-'));
const fidelityTests = tests.filter(test => test.id.startsWith('编辑保真'));
const countTest = tests.find(test => test.id === '张数-2');
const streamTests = tests.filter(test => test.request.stream);
const streamEvents = streamTests.map(test => `${test.id}: ${(test.events || []).map(event => event.type).join(', ') || '无事件'}`);
const rows = tests.map(test => `| ${esc(test.id)} | ${test.interface} | ${test.status || '未确认'} | ${esc(result(test))} | ${(test.durationMs / 1000).toFixed(1)} |`);
const compare = tests.filter(test => previous.some(item => item.id === test.id))
  .map(test => `| ${esc(test.id)} | ${esc(result(previous.find(item => item.id === test.id)))} | ${esc(result(test))} |`);
const text = `# 不吃坤肉渠道图像参数实测

日期：2026-11-16。渠道：不吃坤肉，https://api.kunrouai.com。主模型：gpt-image-2.6-sunburst-4k。沿用前一渠道的红色陶瓷杯提示词、低质量基线与单变量测试方法。测试9个已配置图像模型，不调用模型列表中的视频、音频或文本模型。密钥通过原本机绑定在内存中使用，原SQLite只读，不修改产品和渠道设置。原图、宽高、文件类型、透明像素、SHA256、请求摘要、usage及错误保存在本目录JSON。

## 当前统计

共${tests.length}次请求：HTTP 200 ${tests.filter(test => test.status === 200).length}次，HTTP非200 ${tests.filter(test => test.status && test.status !== 200).length}次，传输未确认${tests.filter(test => !test.status).length}次。共${tests.reduce((sum, test) => sum + (test.images || []).filter(image => image.file).length, 0)}张已下载原图。HTTP 200不等于全部参数生效，以下以真实图像字节为依据；没有测所有参数的笛卡尔积。

## 尺寸偏差

主模型的size不会始终按像素原样执行。当前记录中的1152×1536→864×1152、1536×2048→1728×2304、2480×3312→2448×3264、2400×3200→2448×3264，是直接API的实际输出，未经过工作台。Max和High均复现2480×3312→2448×3264。1000×1333也被接受并映射成精确3:4画幅，故不能保证任意自定义比例。具体内部映射规则仍需渠道服务端证据。

${mismatches.length ? mismatches.map(test => `- ${test.id}：请求${test.request.size}，实际${result(test)}。`).join('\n') : '当前已解析图片未发现明确像素请求偏差。'}

## 格式和元数据

请求格式与实际文件格式不一致${formatMismatches.length}项：${formatMismatches.map(test => `${test.id}（要求${test.request.output_format}，实际${test.images.map(image => image.type).join('/')}）`).join('；')}。因此返回200不能视为JPEG/WebP和压缩设置已经生效。

响应JSON的size字段与实际图片不一致${metadataMismatches.length}项：${metadataMismatches.map(test => `${test.id}（JSON ${test.responseMetadata.size}，实际${result(test)}）`).join('；')}。必须读取下载文件宽高，不能仅凭响应元数据宣称尺寸正确。

实际返回${streamTests.map(test => `${test.id}: ${test.contentType || '未确认'}`).join('；')}。仅application/json且无事件不能认定支持流式或部分图。
本次捕获事件：${streamEvents.join('；')}。当前两条测试均只有image_generation.completed，没有partial_image事件；因此已验证SSE最终事件封装，未验证中间预览图生效。

## 其他参数证据

- 质量档：${qualityTests.map(test => `${test.request.quality} HTTP ${test.status || '未确认'} / output_tokens=${test.usage?.output_tokens ?? '未知'}`).join('；')}。响应回显档位或HTTP 200不能证明各档原生推理策略相同或不同；同token数也不是模型来源的证据。
- 编辑保真：${fidelityTests.map(test => `${test.id} ${result(test)}`).join('；')}。这里只证明接口接受/拒绝，未证明商品细节或文本保真提升。
- n=2：${countTest ? `HTTP ${countTest.status}，解析到${countTest.images?.length || 0}张图` : '尚未测试'}。
- 输出格式与压缩：JPEG/WebP及JPEG压缩0/50/100的本轮请求均未得到相应格式，而是PNG；不能将随机PNG大小变化当作JPEG压缩设置生效。
- 个别编辑请求也可能出现反向格式偏差（请求PNG、实际WebP），以逐条文件字节检测为准，不概括为所有接口永远输出PNG。
- 遮罩测试只验证可提交并返回图像，没有进行遮罩外像素锁定对照。

## 全部结果

| 测试 | 接口 | HTTP | 原图结果或错误 | 秒 |
| --- | --- | --- | --- | --- |
${rows.join('\n')}

## 与hicode对照

主模型不同：hicode为gpt-image-2.6-sunburst，本渠道为gpt-image-2.6-sunburst-4k，因此对照只能说明这两个实际渠道/型号组合的行为差异，不能据此判定底层模型来源或诚信。所有图片未经工作台缩放、拉伸或裁切。

| 同一测试参数 | hicode | 不吃坤肉 |
| --- | --- | --- |
${compare.join('\n')}

## 验证范围

本轮为直接API诊断，不代表新增界面参数已接入或产品画布完成实页验收。超时请求不重发，无法从本地确认其最终完成或计费。原业务数据未覆盖，现有比例校验没有放宽。

本次确认该渠道存在尺寸映射，且不同后缀模型行为不同；未取得服务端转换代码，不能断言具体缩放算法或底层模型真伪。要求精确3:4时，可优先使用本轮成功验证的2448×3264；要求任意像素原生输出时，应选用已实测能准确执行size的渠道。最终尺寸不一致但比例相同可等比交付，比例不同仍保留失败与原始响应，不用拉伸掩盖问题。
`;
writeFileSync(join(output, '实测结论.md'), text);
const chosen = ['尺寸-2480x3312', '尺寸-1800x2400', '尺寸-800x500', '背景-transparent', '格式-jpeg', '格式-webp']
  .map(id => tests.find(test => test.id === id)).filter(test => test?.images?.[0]?.file);
if (chosen.length) {
  const canvas = createCanvas(1080, Math.ceil(chosen.length / 3) * 330), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [index, test] of chosen.entries()) {
    const x = index % 3 * 360, y = Math.floor(index / 3) * 330;
    const image = test.images[0], raster = await loadImage(readFileSync(join(output, image.file)));
    for (let a = 0; a < 320; a += 16) for (let b = 0; b < 260; b += 16) {
      ctx.fillStyle = (a / 16 + b / 16) % 2 ? '#eee' : '#fff'; ctx.fillRect(x + 20 + a, y + 10 + b, 16, 16);
    }
    const scale = Math.min(320 / raster.width, 260 / raster.height);
    ctx.drawImage(raster, x + (360 - raster.width * scale) / 2, y + 10 + (260 - raster.height * scale) / 2, raster.width * scale, raster.height * scale);
    ctx.fillStyle = '#111'; ctx.font = '15px sans-serif';
    ctx.fillText(`request: ${test.request.size} ${test.request.output_format}`, x + 20, y + 292);
    ctx.fillText(`actual: ${image.width} x ${image.height} ${image.type}`, x + 20, y + 315);
  }
  writeFileSync(join(output, '实测图片对照.png'), canvas.toBuffer('image/png'));
}
console.log(JSON.stringify({ tests: tests.length, mismatches: mismatches.length, report: join(output, '实测结论.md') }));
