import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// 2026-10-15：用户对已展示差异回复“批准”。不是任意后续补丁的通行许可。
export const 批准差异SHA256 = 'b76672614125cf0316b27c3347bff04d1bae8a1964dd28922a9e56d5bcd1bbc8';
export const 批准清单SHA256 = 'cd604a038492d5d1ce6e1a79e680ca1100a513172b81ec5d9e8beb26b9eed3cd';
const hash = value => createHash('sha256').update(value).digest('hex');

export function 核验批准产物(清单原文, 差异) {
  if (hash(清单原文) !== 批准清单SHA256 || hash(差异) !== 批准差异SHA256) throw Error('审查产物与用户批准的指纹不符。');
  const 清单 = JSON.parse(清单原文);
  if (清单.差异SHA256 !== 批准差异SHA256 || 清单.文件.length !== 24 || new Set(清单.文件.map(item => item.文件)).size !== 24) throw Error('批准清单结构不符。');
  return 清单;
}

export function 读取批准清单() {
  return 核验批准产物(
    readFileSync(new URL('./待审查/用户已选功能关闭.json', import.meta.url)),
    readFileSync(new URL('./待审查/用户已选功能关闭.patch', import.meta.url)),
  );
}
