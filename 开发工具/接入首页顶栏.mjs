import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 检查运行副本, 运行目录 } from './检查运行副本.mjs';
import { 顶栏差异SHA256 } from '../上游适配/首页顶栏批准.mjs';
import { 生成首页顶栏候选 } from './生成首页顶栏候选.mjs';
import { 预审类型 } from './检查首批功能适配.mjs';
import { 事务写入 } from './接入用户功能.mjs';

const status = 检查运行副本();
if (!status.首页轮播兼容已应用) throw Error('先接入完整原样首页');
const files = 生成首页顶栏候选();
预审类型(new Map([...files].filter(([name]) => name.endsWith('.tsx'))));
if (status.首页顶栏已应用) console.log('首页顶栏已接入，指纹和类型检查通过，不重复写入。');
else if (process.argv.includes('--应用已批准差异')) {
  检查运行副本();
  const ordered = new Map([...files].sort(([a], [b]) => Number(a.endsWith('/user-layout.tsx')) - Number(b.endsWith('/user-layout.tsx'))));
  const snapshot = mkdtempSync(join(根目录, '.运行/首页顶栏接入-'));
  事务写入(运行目录, ordered, snapshot, { 差异指纹: 顶栏差异SHA256, 写后检查: () => { if (!检查运行副本().首页顶栏已应用) throw Error('首页顶栏写后校验失败'); } });
  console.log(JSON.stringify({ applied: true, snapshot }));
} else console.log('首页顶栏3项精确批准产物和类型预审通过；未写入副本。');
