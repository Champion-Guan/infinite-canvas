import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';

// 用户已确认可使用旧轮播原图。只复制这30张公共图片，不读取旧配置或运行数据。
const source = '/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench/public/assets/media/tools';
const target = join(根目录, '界面资源/首页轮播');
const hash = value => createHash('sha256').update(value).digest('hex');
const files = [];
for (let group = 1; group <= 3; group++) {
  for (const [section, count, label] of [[1, 3, '商品图'], [2, 1, '详情长图'], [3, 6, '效果图']]) {
    for (let index = 1; index <= count; index++) {
      const 原文件 = `detail-page-${group}-${section}-${index}.webp`;
      const 文件名 = `第${group}组-${label}${index}.webp`;
      const bytes = readFileSync(join(source, 原文件));
      if (bytes.subarray(0, 4).toString() !== 'RIFF' || bytes.subarray(8, 12).toString() !== 'WEBP') throw Error('素材不是WebP，停止');
      files.push({ 原文件, 来源: `界面资源/首页轮播/${文件名}`, 产物: `web/public/guan/首页轮播/${文件名}`, 字节: bytes.length, SHA256: hash(bytes) });
    }
  }
}
mkdirSync(target, { recursive: true });
for (const item of files) {
  const dest = join(根目录, item.来源);
  if (existsSync(dest)) {
    if (hash(readFileSync(dest)) !== item.SHA256) throw Error('同名图片不同，拒绝覆盖');
  } else copyFileSync(join(source, item.原文件), dest, constants.COPYFILE_EXCL);
}
const manifest = JSON.stringify({ 授权依据: '用户明确确认原轮播图片开源并要求直接迁入；保留来源记录，不虚构具体许可证或将图片归为作者MIT授权。', 来源目录: source, 文件: files }, null, 2) + '\n';
const manifestPath = join(target, '图片清单.json');
if (existsSync(manifestPath) && readFileSync(manifestPath, 'utf8') !== manifest) throw Error('已有素材清单不同，拒绝覆盖');
if (!existsSync(manifestPath)) writeFileSync(manifestPath, manifest);
console.log(JSON.stringify({ 图片数: files.length, 总字节: files.reduce((sum, item) => sum + item.字节, 0), 清单SHA256: hash(manifest) }));
