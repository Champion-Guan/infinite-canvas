import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const root = resolve(import.meta.dirname, '..');
const output = join(root, '开发文档/图像渠道参数实测20261116');
const report = JSON.parse(readFileSync(join(output, '测试结果.json'), 'utf8'));
const supplemental = join(output, '补充测试结果.json');
if (existsSync(supplemental)) report.tests.push(...JSON.parse(readFileSync(supplemental, 'utf8')).tests);
const escape = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
const rows = report.tests.map(test => {
  const dimensions = test.images?.map(image => image.width ? `${image.width}×${image.height} ${image.type} ${image.bytes}字节${image.transparentPixels ? ' 含透明像素' : ''}` : image.delivery).join('; ');
  const error = test.error ? typeof test.error === 'string' ? test.error : JSON.stringify(test.error) : '';
  return `| ${escape(test.id)} | ${test.interface} | ${test.status ?? '未确认'} | ${escape(dimensions || error || '无可解析图片')} | ${(test.durationMs / 1000).toFixed(1)} |`;
});
const text = `# hicode 生图渠道真实参数测试

测试日期：2026-11-16。渠道：hicode生图，https://api-cn.hi-code.cc。使用用户已配置的绑定，密钥仅在内存使用。模型列表通过真实 /v1/models 读取。诊断脚本只读原工作区，不修改渠道、产品或原任务；测试图和结构化结果保存在本目录。

## 方法与证据

以 gpt-image-2.6-sunburst 为主模型，单变量测试；四模型均执行基础生成，另对不同模型执行自定义尺寸交叉测试。基线是 size=1024x1024、quality=low、n=1、output_format=png、moderation=auto。直接调用 /v1/images/generations（JSON）及 /v1/images/edits（multipart）；解析真实图片字节、宽高、格式及 alpha。输出文件 SHA256、请求摘要、时间、HTTP状态、usage 和参数见「测试结果.json」。图片不经工作台缩放或裁切。

HTTP 200 只能证明接受了请求，不能单凭它证明每个参数都生效，更不能证明转发商底层模型来源。尺寸、文件格式、透明像素及返回张数分别以实际图片验证；质量效果不以随机样本的文件体积或主观观感作强结论。没有遍历所有参数的笛卡尔积，没有验证所有可能像素组合。

## 尺寸问题

- 新渠道明确要求宽高均为16的倍数。1800×2400、800×500、1000×1333 直接提交收到400及对应错误信息。
- 新渠道已按请求返回2480×3312、2448×3264、2400×3200等合法尺寸，不能把旧渠道的尺寸改写归因于所有GPT生图接口。
- 当前界面4k/3:4预设2480×3312的比例是155:207，约0.74879；2448×3264为精确3:4，等比缩放不能将两者精确互换。旧任务尺寸校验因此拒绝交付，符合现有不拉伸、不裁主体的规则。旧渠道为何内部改写尺寸尚无服务端证据。
- 工作台的 imageRequestSizePlan 会把非网格交付尺寸变成合法请求尺寸，例如1800×2400→1824×2432（精确3:4），800×500→1024×640（精确8:5），1000×1333→1008×1344并记下补边。结果回写时再按明确记录等比缩放或移除约定补边。
- 1824×2432、1024×640、1008×1344 已分别直接实测，均收到对应精确尺寸。真实协议编码、补边和交付保护共41项定向测试通过。此次未在浏览器提交产品图，不能将API诊断记作新渠道全部界面的实页验收。
- 自动尺寸不固定比例；本次auto返回1536×1024。需要固定比例时应传明确size，不应依赖auto或仅在提示词里声明像素。

## 参数结果

累计 ${report.tests.length} 个真实测试请求，${report.tests.filter(test => test.status === 200).length} 个HTTP 200。每行的请求完整参数保存在JSON，不从结果截图反推参数。

### 关键限制

- 两次stream=true测试（partial_images=0/1）均返回application/json，不是text/event-stream；没有收到部分图事件。此接口接受字段不等于实现流式输出。
- gpt-image-2.6-sunburst的input_fidelity=low/high均返回400，明确说明该模型不支持此参数。带input_fidelity的遮罩测试同样被此字段阻断，遮罩本身需以「编辑遮罩独立」测试判断。
- 独立遮罩测试成功；编辑接口1824×2432成功且尺寸精确；gpt-image-2.5-sunburst的input_fidelity=high也明确返回不支持。遮罩的局部约束强度未做像素锁定对照，成功不等于逐像素保护承诺。
- quality=auto/low/medium/high/xhigh均成功，输出token用量随档位有区别；max的1024×1024请求180秒未确认，而max的2480×3312请求成功且尺寸精确。超时未重发，无法据此确认前一条的最终完成或计费状态。
- PNG/JPEG/WebP都得到对应真实文件；JPEG压缩0/50/100、WebP压缩50均接受。透明PNG/WebP含真实alpha，透明+JPEG返回不透明JPEG，不可用JPEG交付透明图。
- n=2实际返回两张。response_format=b64_json返回可解码图片，url返回URL（未携带密钥访问返回的下载地址）。moderation=auto/low及user字段被接受，安全审核强度和用户归因的服务端效果未做对抗或账户级验证。

| 测试 | 接口 | HTTP | 实际结果或错误 | 秒 |
| --- | --- | --- | --- | --- |
${rows.join('\n')}

## 工作台当前支持范围

工作台原版图片协议目前固定输出PNG，支持size、quality、moderation、n与透明背景；input_fidelity、输出压缩、其他输出格式和流式图像等没有全部暴露为界面设置。高质量档按模型名称决定是否传出，auto质量以省略quality实现。新渠道接受某参数不代表工作台当前已经发送了它。

本次聚焦参数诊断，不修改现有渠道、生成配置、预设表或尺寸保护，不将一次随机质量对比作为自动改写用户设置的依据。

建议：明确区分交付尺寸和请求尺寸；任意非网格尺寸通过已验证的适配路径交付。要求精确3:4的大图可使用2400×3200或2448×3264；2480×3312虽然本渠道接受，但不应称为数学上精确3:4。保留真实尺寸校验，禁止为消除报错而拉伸或任意裁切商品。是否增加JPEG/WebP、压缩和遮罩等界面设置属于后续功能实现范围，不能把本报告记成已接入。

关联会话读取工具在本轮不可用（read_thread工具搜索未返回可调用接口）；本报告依据当前源码、已有任务记录和本轮真实API结果，不声称已读取该关联会话。
`;
writeFileSync(join(output, '实测结论.md'), text);
const wanted = ['尺寸-1152x1536', '尺寸-2480x3312', '尺寸-2448x3264', '背景-transparent', '格式-jpeg', '格式-webp'];
const selected = wanted.map(id => report.tests.find(test => test.id === id)).filter(test => test?.images?.[0]?.file);
if (selected.length) {
  const width = 1080, cellWidth = 360, cellHeight = 330;
  const canvas = createCanvas(width, Math.ceil(selected.length / 3) * cellHeight);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  for (const [index, test] of selected.entries()) {
    const x = (index % 3) * cellWidth, y = Math.floor(index / 3) * cellHeight, data = test.images[0];
    for (let gx = 0; gx < 320; gx += 16) for (let gy = 0; gy < 260; gy += 16) {
      context.fillStyle = (gx / 16 + gy / 16) % 2 ? '#eee' : '#fff';
      context.fillRect(x + 20 + gx, y + 10 + gy, 16, 16);
    }
    const image = await loadImage(readFileSync(join(output, data.file)));
    const scale = Math.min(320 / image.width, 260 / image.height);
    context.drawImage(image, x + (cellWidth - image.width * scale) / 2, y + 10 + (260 - image.height * scale) / 2, image.width * scale, image.height * scale);
    context.fillStyle = '#111'; context.font = '16px sans-serif';
    context.fillText(test.id.replace('尺寸-', 'size=').replace('背景-', 'background=').replace('格式-', 'format='), x + 20, y + 292);
    context.font = '14px sans-serif';
    context.fillText(`${data.width} x ${data.height}  ${data.type}`, x + 20, y + 315);
  }
  writeFileSync(join(output, '实测图片对照.png'), canvas.toBuffer('image/png'));
}
console.log(JSON.stringify({ tests: report.tests.length, report: join(output, '实测结论.md') }));
