// 只处理生成结果的明确像素尺寸；原图和普通上传不经过尺寸改写。
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

/** @param {Blob} blob @param {{width: number, height: number}} metadata @param {{targetSize?: string, signal?: AbortSignal}} options */
export async function prepareGeneratedDelivery(blob, metadata, { targetSize, signal } = {}) {
  signal?.throwIfAborted();
  const target = parseDeliverySize(targetSize);
  const action = deliveryAction(metadata.width, metadata.height, target);
  if (!target || action === 'original') return { blob, metadata };
  if (action === 'ratio-mismatch') return { blob, metadata,
    deliveryNote: '上游图片比例与交付尺寸不同，已保留原图，未拉伸或裁切' };
  const delivery = await resizeDeliveryBlob(blob, target, { signal });
  return { blob: delivery, metadata: target,
    deliveryNote: '已按交付尺寸等比例缩放，生成原图另行保留' };
}
