import { decodeInlineImage } from '../画布迁移扩展/内嵌图片解码.mjs';

// 请求网格与最终交付分开；原图和普通上传不经过尺寸改写。
/** @typedef {{width:number,height:number,contentWidth:number,contentHeight:number,left:number,top:number,targetWidth:number,targetHeight:number}} ImageRequestPadding */
/** @returns {{width:number,height:number,padding?:ImageRequestPadding}} */
export function imageRequestSizePlan(width, height) {
  if (![width, height].every(value => Number.isSafeInteger(value) && value > 0))
    throw Error('图片宽高必须为正整数。');
  if (Math.max(width, height) / Math.min(width, height) > 3)
    throw Error('上游不支持超过 3:1 的图片比例，请调整交付尺寸；未裁切或拉伸图片。');
  if (Math.max(width, height) > 3840 || width * height > 8294400)
    throw Error(`交付尺寸 ${width} × ${height} 超过上游范围（单边最多 3840、总像素最多 8294400），请先调整尺寸；未自动缩小图片。`);
  let a = width, b = height;
  while (b) { const remainder = a % b; a = b; b = remainder; }
  const unitWidth = width / a, unitHeight = height / a;
  const multiplier = Math.ceil(Math.max(a, Math.ceil(Math.sqrt(655360 / (unitWidth * unitHeight)))) / 16) * 16;
  const exactWidth = unitWidth * multiplier, exactHeight = unitHeight * multiplier;
  if (exactWidth <= 3840 && exactHeight <= 3840 && exactWidth * exactHeight <= 8294400)
    return { width: exactWidth, height: exactHeight };
  // 约分后互质的尺寸可能需要数倍放大才能对齐。改为内容等比放大到最低像素，再少量补边。
  const scale = Math.max(1, Math.sqrt(655360 / (width * height)));
  const contentWidth = Math.round(width * scale), contentHeight = Math.round(height * scale);
  const grid = value => Math.ceil(value / 16) * 16;
  let requestWidth = grid(contentWidth), requestHeight = grid(contentHeight);
  if (requestWidth > requestHeight * 3) requestHeight = grid(requestWidth / 3);
  if (requestHeight > requestWidth * 3) requestWidth = grid(requestHeight / 3);
  if (requestWidth > 3840 || requestHeight > 3840 || requestWidth * requestHeight > 8294400)
    throw Error('补边后的请求尺寸超过上游范围，请略微减小交付尺寸；未裁切或拉伸图片。');
  return { width: requestWidth, height: requestHeight, padding: {
    width: requestWidth, height: requestHeight, contentWidth, contentHeight,
    left: Math.floor((requestWidth - contentWidth) / 2), top: Math.floor((requestHeight - contentHeight) / 2),
    targetWidth: width, targetHeight: height,
  } };
}

/** @param {ImageRequestPadding} padding */
export function imagePaddingPrompt(padding) {
  return `\n\nOutput canvas adaptation: generate exactly ${padding.width} x ${padding.height} pixels. `
    + `Place the complete intended image inside the rectangle at x=${padding.left}, y=${padding.top}, `
    + `width=${padding.contentWidth}, height=${padding.contentHeight}. Keep all product content, text and annotations inside that rectangle. `
    + `The surrounding narrow margins are transport padding only; extend adjacent background into them. `
    + `Do not stretch or crop the product. The workbench will remove only these added margins and deliver ${padding.targetWidth} x ${padding.targetHeight} pixels.`;
}

/** @param {HTMLCanvasElement} canvas @param {AbortSignal | undefined} signal */
async function canvasBlob(canvas, signal) {
  const result = await new Promise((resolve, reject) => canvas.toBlob(value =>
    value ? resolve(value) : reject(Error('尺寸适配图片编码失败。')), 'image/png'));
  signal?.throwIfAborted();
  return /** @type {Blob} */ (result);
}

/** 仅对尺寸与完整输出画幅相符的参考图补边，其他实物参考图原样使用。
 * @param {string} dataUrl @param {ImageRequestPadding} padding @param {AbortSignal | undefined} signal
 * @returns {Promise<string>}
 */
export async function padImageReference(dataUrl, padding, signal = undefined) {
  signal?.throwIfAborted();
  const bitmap = await createImageBitmap(decodeInlineImage(dataUrl));
  let canvas;
  try {
    signal?.throwIfAborted();
    if (bitmap.width !== padding.targetWidth || bitmap.height !== padding.targetHeight) return dataUrl;
    canvas = document.createElement('canvas'); canvas.width = padding.width; canvas.height = padding.height;
    const context = canvas.getContext('2d');
    if (!context) throw Error('无法创建请求尺寸适配画布。');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    const right = padding.width - padding.left - padding.contentWidth, bottom = padding.height - padding.top - padding.contentHeight;
    const xs = [[0, 1, 0, padding.left], [0, bitmap.width, padding.left, padding.contentWidth], [bitmap.width - 1, 1, padding.left + padding.contentWidth, right]];
    const ys = [[0, 1, 0, padding.top], [0, bitmap.height, padding.top, padding.contentHeight], [bitmap.height - 1, 1, padding.top + padding.contentHeight, bottom]];
    for (const [sx, sw, dx, dw] of xs) for (const [sy, sh, dy, dh] of ys)
      if (dw && dh) context.drawImage(bitmap, sx, sy, sw, sh, dx, dy, dw, dh);
    const blob = await canvasBlob(canvas, signal);
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => { try { signal?.throwIfAborted(); resolve(String(reader.result)); } catch (error) { reject(error); } };
      reader.onerror = () => reject(Error('请求尺寸适配图片读取失败。'));
      reader.readAsDataURL(blob);
    });
  } finally {
    bitmap.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

export function parseDeliverySize(value) {
  const match = String(value || '').trim().match(/^(\d+)\s*[x×]\s*(\d+)$/i);
  if (!match) return undefined;
  const width = Number(match[1]), height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return undefined;
  if (width > 16384 || height > 16384 || width * height > 40_000_000)
    throw new Error('交付尺寸过大，请使用不超过 4000 万像素、单边不超过 16384 的尺寸');
  return { width, height };
}

export function deliveryAction(width, height, target) {
  if (!target || width === target.width && height === target.height) return 'original';
  // 仅容许整数像素舍入误差，不用近似宽高比代替同比例。
  const error = Math.abs(width * target.height - height * target.width);
  return error <= Math.max(width, height, target.width, target.height) / 2 ? 'resize' : 'ratio-mismatch';
}

export class ImageDeliverySizeError extends Error {
  constructor(actual, target) {
    super(`图片尺寸不符：要求 ${target.width} × ${target.height}，上游返回 ${actual.width} × ${actual.height}。未拉伸或裁切，已停止交付。`);
    this.name = 'ImageDeliverySizeError';
    this.code = 'image_delivery_size_mismatch';
    this.requestedSize = `${target.width}x${target.height}`;
    this.actualSize = `${actual.width}x${actual.height}`;
  }
}

/** @param {{errorCode?: string, code?: string, errorDetails?: string, message?: string} | null | undefined} failure */
export function imageSizeRetryBlocked(failure) {
  return failure?.errorCode === 'image_delivery_size_mismatch' || failure?.code === 'image_delivery_size_mismatch'
    || /^(?:图片尺寸不符：)/.test(failure?.errorDetails || failure?.message || '');
}

/** @param {Blob} blob @param {{width: number, height: number}} target @param {{signal?: AbortSignal}} options @returns {Promise<Blob>} */
export async function resizeDeliveryBlob(blob, target, { signal } = {}) {
  signal?.throwIfAborted();
  const bitmap = await createImageBitmap(blob);
  let canvas;
  try {
    signal?.throwIfAborted();
    canvas = document.createElement('canvas');
    canvas.width = target.width; canvas.height = target.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建交付图片画布');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, target.width, target.height);
    const result = await new Promise(/** @param {(value: Blob) => void} resolve */ (resolve, reject) => canvas.toBlob(
      value => value ? resolve(value) : reject(new Error('交付图片编码失败')), 'image/png'));
    signal?.throwIfAborted();
    return result;
  } finally {
    bitmap.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

/** @param {Blob} blob @param {{width: number, height: number}} metadata @param {{targetSize?: string, signal?: AbortSignal, padding?: ImageRequestPadding}} options */
export async function prepareGeneratedDelivery(blob, metadata, { targetSize, signal, padding } = {}) {
  signal?.throwIfAborted();
  const target = parseDeliverySize(targetSize);
  if (padding) {
    const expected = target && imageRequestSizePlan(target.width, target.height).padding;
    if (!expected || Object.keys(expected).some(key => expected[key] !== padding[key]))
      throw Error('请求补边记录与交付尺寸不一致，未裁切图片，原始响应已保留。');
    if (metadata.width !== padding.width || metadata.height !== padding.height)
      throw new ImageDeliverySizeError(metadata, { width: padding.width, height: padding.height });
    const bitmap = await createImageBitmap(blob);
    let canvas;
    try {
      signal?.throwIfAborted();
      if (bitmap.width !== padding.width || bitmap.height !== padding.height)
        throw new ImageDeliverySizeError(bitmap, { width: padding.width, height: padding.height });
      canvas = document.createElement('canvas'); canvas.width = target.width; canvas.height = target.height;
      const context = canvas.getContext('2d');
      if (!context) throw Error('无法创建交付图片画布。');
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, padding.left, padding.top, padding.contentWidth, padding.contentHeight, 0, 0, target.width, target.height);
      const delivery = await canvasBlob(canvas, signal);
      return { blob: delivery, metadata: target, deliveryNote: `已移除请求适配补边，按原尺寸 ${target.width} × ${target.height} 交付；上游原图另行保留` };
    } finally {
      bitmap.close();
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
  }
  const action = deliveryAction(metadata.width, metadata.height, target);
  if (!target || action === 'original') return { blob, metadata };
  if (action === 'ratio-mismatch') throw new ImageDeliverySizeError(metadata, target);
  const delivery = await resizeDeliveryBlob(blob, target, { signal });
  return { blob: delivery, metadata: target,
    deliveryNote: '已按交付尺寸等比例缩放，生成原图另行保留' };
}
