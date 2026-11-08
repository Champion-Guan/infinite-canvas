import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mapping = JSON.parse(readFileSync(join(root, '上游适配/开发源码映射.json'), 'utf8'));
const patchPath = join(root, '上游适配/透明图片卡片背景.patch');
const sourcePath = join(root, '.运行/3100源/画布副本/web/src/components/canvas/canvas-node.tsx');
const patch = readFileSync(patchPath);
const source = readFileSync(sourcePath, 'utf8');
const record = mapping.接入补丁.find((item) => item.文件 === '上游适配/透明图片卡片背景.patch');
assert.ok(record, '透明图片背景补丁未登记');
assert.equal(createHash('sha256').update(patch).digest('hex'), record.SHA256, '补丁指纹不一致');
assert.match(source, /<div className="h-full w-full overflow-hidden rounded-3xl" style=\{\{ background: theme\.node\.fill \}\}>/);
assert.match(source, /height: node\.height,\n\s+background: theme\.node\.fill,/);
console.log('透明图片卡片背景检查通过');
