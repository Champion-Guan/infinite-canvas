import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// 用户明确批准“首页替换补丁”及原轮播图片迁入；不包含其他待审查批次。
export const 首页差异SHA256 = '810e7ffdcb25ab0aec0f44cab6f48f661dc610a544c4a86a0f879481a7bf3a60';
export const 首页清单SHA256 = '6ae74e1620f056fbc70f1d8d11f0fd89e66f4fcceb3c7b5c8c1fb3f3aa4e5a6e';
const hash = value => createHash('sha256').update(value).digest('hex');

export function 核验首页批准(清单原文, 差异, 图片清单) {
  if (hash(清单原文) !== 首页清单SHA256 || hash(差异) !== 首页差异SHA256) throw Error('首页批准指纹不符。');
  const 清单 = JSON.parse(清单原文);
  if (hash(图片清单) !== 清单.图片清单SHA256 || 清单.文件.length !== 3 || 清单.资源.length !== 30) throw Error('首页素材清单不符。');
  return 清单;
}

export function 读取首页批准() {
  return 核验首页批准(
    readFileSync(new URL('./待审查/首页原图接入.json', import.meta.url)),
    readFileSync(new URL('./待审查/首页原图接入.patch', import.meta.url)),
    readFileSync(new URL('../界面资源/首页轮播/图片清单.json', import.meta.url)),
  );
}
