import { createHash } from 'node:crypto';

// 只用于临时画布验收，不接入应用。临时URL必须在编码器close/revoke前读取并校验内容。
// 原UI加载图片会补metadata.images=[]并更新project.updatedAt；其余业务字段不豁免。
export async function canvasSemanticSnapshot(canvas) {
  if (!canvas) return { value: canvas, projectTimes: {}, media: [] };
  const media = [], projectTimes = {}, copy = structuredClone(canvas);
  for (const project of copy.state.projects) {
    if (typeof project.updatedAt !== 'string' || !Number.isFinite(Date.parse(project.updatedAt))) throw Error('画布更新时间无效');
    projectTimes[project.id] = project.updatedAt;
    project.updatedAt = '<运行时编辑时间，单独核验>';
    for (const node of project.nodes) if (node.type === 'image' && node.metadata && !Object.hasOwn(node.metadata, 'images')) node.metadata.images = [];
  }
  async function walk(value) {
    if (typeof value === 'string' && value.startsWith('blob:')) {
      const response = await fetch(value); if (!response.ok) throw Error('临时媒体无法读取');
      const blob = await response.blob(), hash = createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex');
      const fingerprint = { hash, size: blob.size, mime: blob.type }; media.push(fingerprint);
      return 'media-sha256:' + hash + ':' + blob.size + ':' + blob.type;
    }
    if (Array.isArray(value)) return Promise.all(value.map(walk));
    if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await walk(item)])));
    return value;
  }
  return { value: await walk(copy), projectTimes, media };
}

export function validRefreshTimes(before, after) {
  return Object.keys(before).length === Object.keys(after).length && Object.entries(before).every(([id, time]) => Object.hasOwn(after, id) && Date.parse(after[id]) >= Date.parse(time));
}
