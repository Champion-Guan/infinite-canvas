import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 读取首页批准 } from '../上游适配/首页接入批准.mjs';
import { 生成用户候选 } from './检查用户功能适配.mjs';
import { 预审类型, 生成审查差异 } from './检查首批功能适配.mjs';
import { 事务写入 } from './接入用户功能.mjs';
import { 读取原样首页批准, 读取轮播兼容批准 } from '../上游适配/首页原样迁移批准.mjs';

const status = 检查运行副本();
const compatibility = process.argv.includes('--轮播兼容');
const old = 读取首页批准();
const mappings = [
  ['扩展功能/首页/画布入口候选.tsx','web/src/guan/画布入口.tsx'],
  ['扩展功能/首页/工作台首页.tsx','web/src/guan/工作台首页.tsx'],
  ['扩展功能/首页/首页.module.css','web/src/guan/首页.module.css'],
];
if (compatibility || status.首页轮播兼容已应用) mappings.push(['扩展功能/首页/轮播依赖.js','web/src/guan/轮播依赖.js'],['扩展功能/首页/轮播依赖.d.ts','web/src/guan/轮播依赖.d.ts']);
if (status.首页轮播兼容已应用 || (status.首页原样迁移已应用 && !compatibility)) {
  const manifest = status.首页轮播兼容已应用 ? 读取轮播兼容批准() : 读取原样首页批准();
  for (const item of [...manifest.文件, ...manifest.资源]) {
    const source = item.文件.startsWith('web/public/guan/')
      ? join(根目录, '界面资源', item.文件.split('/guan/')[1])
      : join(根目录, mappings.find(([, target]) => target === item.文件)?.[0] ?? '拒绝未知来源');
    if (哈希(readFileSync(source)) !== item.候选SHA256) throw Error('当前权威首页源码已偏离批准：' + item.文件);
  }
  console.log('原样首页完整批次及权威源码指纹一致；不覆盖记录或重复生成事务。');
  process.exit(0);
}
const all = 生成用户候选();
const changes = new Map();
const files = old.文件.map(item => {
  const [from] = mappings.find(([,to])=>to===item.文件);
  const 产物 = readFileSync(join(根目录,from),'utf8');
  changes.set(item.文件,{原文:readFileSync(join(运行目录,item.文件),'utf8'),产物});
  all.set(item.文件,{产物});
  return {...item,候选SHA256:哈希(产物)};
});
for (const [from,to] of mappings.slice(3)) {
  const 产物 = readFileSync(join(根目录,from),'utf8');
  changes.set(to,{原文:null,产物});
  all.set(to,{产物});
  files.push({文件:to,原始SHA256:null,候选SHA256:哈希(产物)});
}
const resources = [...old.资源];
for (const name of ['轮播箭头.svg','Geist拉丁.woff2','工作台Logo.png']) {
  const 文件 = 'web/public/guan/首页原样资源/'+name;
  const 产物 = readFileSync(join(根目录,'界面资源/首页原样资源',name));
  changes.set(文件,{原文:null,产物});
  resources.push({文件,原始SHA256:null,候选SHA256:哈希(产物),字节:产物.length});
}
预审类型(new Map([...all].filter(([name])=>/\.tsx?$/.test(name))));
const patch = 生成审查差异(changes);
const manifest = JSON.stringify({...old,状态:'用户要求纠正首页：原实现迁移，禁止重新设计；不包含新的上游核心适配',上游提交:基线.提交,前置首页差异SHA256:old.差异SHA256,差异SHA256:哈希(patch),文件:files,资源:resources},null,2)+'\n';
const dir = join(根目录,'上游适配/待审查');
mkdirSync(dir,{recursive:true});
const prefix = compatibility ? '首页原样轮播兼容' : '首页原样迁移';
for (const [name,value] of [[prefix+'.patch',patch],[prefix+'.json',manifest]]) {
  const path = join(dir,name);
  if (existsSync(path) && readFileSync(path,'utf8')!==value) throw Error('不可覆盖既有审查记录');
  if (!existsSync(path)) writeFileSync(path,value);
}
console.log(JSON.stringify({差异SHA256:哈希(patch),清单SHA256:哈希(manifest)}));
if (process.argv.includes('--应用')) {
  const ordered = new Map([...changes].sort(([a],[b])=>Number(a.endsWith('/画布入口.tsx'))-Number(b.endsWith('/画布入口.tsx'))));
  const snapshot = mkdtempSync(join(根目录,'.运行/首页原样迁移-'));
  事务写入(运行目录,ordered,snapshot,{差异指纹:哈希(patch),写后检查:()=>{if(!检查运行副本().首页原样迁移已应用)throw Error('迁移后保护失败');}});
  console.log(JSON.stringify({snapshot}));
}
