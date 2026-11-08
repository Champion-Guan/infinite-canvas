import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 哈希 } from './检查运行副本.mjs';

// 历史全文件差异是不可变验收样本，不把当前源码冒充旧批准产物。
export function 读取首页批准产物(清单, 差异文件) {
  const patch = readFileSync(join(根目录, '上游适配/待审查', 差异文件), 'utf8');
  if (哈希(patch) !== 清单.差异SHA256) throw Error('首页差异指纹不符');
  const 文件 = new Map();
  for (const block of patch.split(/^--- /m).slice(1)) {
    const lines = block.split('\n');
    const target = lines.find(line => line.startsWith('+++ b/'))?.slice(6);
    if (!target) continue;
    const hunks = lines.filter(line => line.startsWith('@@'));
    if (hunks.length !== 1 || !/^@@ -\d+(?:,\d+)? \+1(?:,\d+)? @@/.test(hunks[0])) throw Error('不是可完整还原的首页全文件差异');
    const content = lines.slice(lines.indexOf(hunks[0]) + 1).filter(line => line.startsWith('+') || line.startsWith(' ')).map(line => line.slice(1)).join('\n') + '\n';
    const item = 清单.文件.find(item => item.文件 === target);
    if (!item || 哈希(content) !== item.候选SHA256) throw Error('首页历史样本指纹不符：' + target);
    文件.set(target, { 产物: Buffer.from(content) });
  }
  for (const item of 清单.资源) {
    const source = join(根目录, '界面资源', item.文件.split('/guan/')[1]);
    const bytes = readFileSync(source);
    if (哈希(bytes) !== item.候选SHA256) throw Error('首页资源指纹不符');
    文件.set(item.文件, { 产物: bytes });
  }
  if (文件.size !== 清单.文件.length + 清单.资源.length) throw Error('历史首页产物数不符');
  return 文件;
}
