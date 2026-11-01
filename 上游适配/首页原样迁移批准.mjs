import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const 原样差异SHA256 = '489a758f2152a5f12b5d2e07925aed721d7c31a104104413e6e3b8db584492e1';
export const 原样清单SHA256 = 'c001998a9964d9070b762ae970ff498b99a6a2932f3270a3bdf01d762a703024';
const hash = x => createHash('sha256').update(x).digest('hex');
export function 读取原样首页批准() {
  const json = readFileSync(new URL('./待审查/首页原样迁移.json',import.meta.url));
  const patch = readFileSync(new URL('./待审查/首页原样迁移.patch',import.meta.url));
  if(hash(json)!==原样清单SHA256 || hash(patch)!==原样差异SHA256)throw Error('首页原样迁移指纹不符');
  const manifest = JSON.parse(json);
  if(manifest.文件.length!==3 || manifest.资源.length!==33)throw Error('首页原样迁移数量不符');
  return manifest;
}
export const 轮播兼容差异SHA256 = '46d1be6f337d597ad6bcce29184a49b5c377c4e8f20e84210a05c5ddf0a66402';
export function 读取轮播兼容批准() {
  const json = readFileSync(new URL('./待审查/首页原样轮播兼容.json',import.meta.url));
  const patch = readFileSync(new URL('./待审查/首页原样轮播兼容.patch',import.meta.url));
  if(hash(json)!=='3828c25decd741f866e1074b1e219bce2a03eb7ca0562d337f350e43201ebfb7' || hash(patch)!==轮播兼容差异SHA256) throw Error('轮播兼容批准指纹不符');
  const manifest = JSON.parse(json);
  if(manifest.文件.length!==5 || manifest.资源.length!==33)throw Error('轮播兼容数量不符');
  return manifest;
}
