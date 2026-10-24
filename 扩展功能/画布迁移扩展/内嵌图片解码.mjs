// 仅解码本机图片任务已允许的内嵌格式，不调用 fetch 或改变 CSP。
export function decodeInlineImage(value) {
  const match = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/]*={0,2})$/i.exec(value);
  if (!match || !match[2]) throw new Error('内嵌图片数据无效，原生成响应保留。');
  let binary;
  try { binary = atob(match[2]); }
  catch { throw new Error('内嵌图片编码无效，原生成响应保留。'); }
  if (!binary.length) throw new Error('内嵌图片为空，原生成响应保留。');
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1].toLowerCase().replace('image/jpg', 'image/jpeg') });
}
