import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';

// 自生成128x128纯色PNG，仅用于独立浏览器合成媒体验收，无真实用户内容。
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(kind, bytes) {
  const type = Buffer.from(kind), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length); crc.writeUInt32BE(crc32(Buffer.concat([type, bytes])));
  return Buffer.concat([size, type, bytes, crc]);
}
const header = Buffer.alloc(13); header.writeUInt32BE(128, 0); header.writeUInt32BE(128, 4); header[8] = 8; header[9] = 6;
const pixels = Buffer.alloc((128 * 4 + 1) * 128);
for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
  const offset = y * 513 + x * 4 + 1; pixels.set([117, 84, 217, 255], offset);
}
const output = join(根目录, '.运行/output/playwright/产品悬浮删除-20261018'); mkdirSync(output, { recursive: true });
const path = join(output, '产品回收验收.png');
writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]));
console.log(path);
