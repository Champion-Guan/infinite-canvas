import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 读取轮播兼容批准 } from '../上游适配/首页原样迁移批准.mjs';
import { 预审类型 } from './检查首批功能适配.mjs';
import { 事务写入 } from './接入用户功能.mjs';

// 从功能关闭基线、历史首页或原样首页均可重建，复用不可变的完整产物指纹。
// 不重新生成/改写历史差异，也不把最新源码拿去匹配旧33项批准。
const status = 检查运行副本();
if (!status.用户功能关闭已应用) throw Error('先接入已批准功能关闭基线');
const manifest = 读取轮播兼容批准();
const mapping = new Map([
  ['web/src/guan/画布入口.tsx', '扩展功能/首页/画布入口候选.tsx'],
  ...['工作台首页.tsx', '首页.module.css', '轮播依赖.js', '轮播依赖.d.ts'].map(name => ['web/src/guan/' + name, '扩展功能/首页/' + name]),
  ...manifest.资源.map(item => [item.文件, '界面资源/' + item.文件.split('/guan/')[1]]),
]);
const files = new Map();
for (const item of [...manifest.文件, ...manifest.资源]) {
  const 产物 = readFileSync(join(根目录, mapping.get(item.文件)));
  if (哈希(产物) !== item.候选SHA256) throw Error('当前权威源码偏离批准：' + item.文件);
  files.set(item.文件, { 产物 });
}
预审类型(new Map([...files].filter(([name]) => /\.tsx?$/.test(name)).map(([name, item]) => [name, { 产物: item.产物.toString('utf8') }])));
if (process.argv.includes('--应用已批准差异') && !status.首页轮播兼容已应用) {
  检查运行副本();
  const ordered = new Map([...files].sort(([a], [b]) => Number(a.endsWith('/画布入口.tsx')) - Number(b.endsWith('/画布入口.tsx'))));
  const snapshot = mkdtempSync(join(根目录, '.运行/原样首页重建-'));
  事务写入(运行目录, ordered, snapshot, { 差异指纹: manifest.差异SHA256, 写后检查: () => { if (!检查运行副本().首页轮播兼容已应用) throw Error('原样首页重建校验失败'); } });
  console.log(JSON.stringify({ snapshot }));
} else {
  console.log(status.首页轮播兼容已应用 ? '原样首页已完整接入，源码指纹与类型检查通过；不重复写入。' : '38项源码指纹与类型预审通过；尚未应用。');
}
