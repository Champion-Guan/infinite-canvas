import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const frontendRequire=createRequire(new URL('../.运行/3100源/画布副本/web/package.json',import.meta.url));
const require=createRequire(frontendRequire.resolve('vite'));
const {buildSync}=require('esbuild');
const code=buildSync({entryPoints:['扩展功能/画布连线/圆角连线路由.ts'],bundle:true,write:false,format:'esm',platform:'node'}).outputFiles[0].text;
const {buildSharedConnectionGeometry,mergeSharedConnectionSegments}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const node=(id,x,y,w=200,h=120)=>({id,type:'image',position:{x,y},width:w,height:h});
const line=(id,a,b)=>({id,fromNodeId:a,toNodeId:b});
function route(nodes,lines,previous=[]){return buildSharedConnectionGeometry(lines,new Map(nodes.map(n=>[n.id,n])),undefined,previous);}
function clear(g,nodes){for(const item of g)for(let i=1;i<item.route.points.length;i++){
 const a=item.route.points[i-1],b=item.route.points[i];assert.ok(a.x===b.x||a.y===b.y);
 for(const n of nodes){const {x,y}=n.position;const hit=a.y===b.y?a.y>y&&a.y<y+n.height&&Math.max(a.x,b.x)>x&&Math.min(a.x,b.x)<x+n.width:a.x>x&&a.x<x+n.width&&Math.max(a.y,b.y)>y&&Math.min(a.y,b.y)<y+n.height;assert.equal(hit,false,`${item.connection.id} 穿过 ${n.id}`);}
 } }
test('同高无障碍直接连接，不为了共享主干上下绕行',()=>{const n=[node('a',0,0),node('b',700,0),node('c',700,300)];const g=route(n,[line('ab','a','b'),line('ac','a','c')]);assert.deepEqual(g[0].route.points,[{x:200,y:60},{x:700,y:60}]);clear(g,n);});
test('中间卡片阻挡时绕行，最后从左侧水平准确接入',()=>{const n=[node('a',0,100),node('b',700,300),node('block',300,80,250,400)];const g=route(n,[line('ab','a','b')]);assert.equal(g.length,1);clear(g,n);const p=g[0].route.points;assert.deepEqual(p.at(-1),{x:700,y:360});assert.equal(p.at(-2).y,360);assert.ok(p.at(-2).x<700);});
test('正向窄间距仍可连接',()=>{for(const gap of [1,10,28,56,84]){const n=[node('a',0,0),node('b',200+gap,140)];const g=route(n,[line('ab','a','b')]);assert.equal(g.length,1);clear(g,n);}});
test('反向关系避开来源与目标',()=>{const n=[node('a',700,300),node('b',0,0),node('block',350,-100,200,600)];const g=route(n,[line('ab','a','b')]);assert.equal(g.length,1);clear(g,n);});
test('同源分支实际共享段仍保留各自关系ID',()=>{const n=[node('a',0,0),node('b',700,300),node('c',700,600)];const g=route(n,[line('ab','a','b'),line('ac','a','c')]);clear(g,n);assert.ok(mergeSharedConnectionSegments(g).some(s=>s.connectionIds.length===2));});
const lanes=item=>[...new Set(item.route.points.slice(1).flatMap((p,i)=>p.x===item.route.points[i].x&&p.y!==item.route.points[i].y?[p.x]:[]))];
test('拖近一个目标时整组重选主干，不留下截图中的空白矩形双轨',()=>{
 const lines=[line('ab','a','b'),line('ac','a','c')];
 const initial=[node('a',0,0),node('b',700,300),node('c',700,600)];
 const old=route(initial,lines);
 const moved=[initial[0],node('b',310,300),initial[2]];
 const current=route(moved,lines,old);clear(current,moved);
 assert.deepEqual(lanes(current[0]),lanes(current[1]));
 assert.notDeepEqual(lanes(current[0]),lanes(old[0]),'不能继续保留越过近目标左端口的旧主干');
 assert.ok(mergeSharedConnectionSegments(current).some(s=>s.key.startsWith('V:')&&s.connectionIds.length===2));
});
test('旧记忆已分裂时重新协调，安全小幅移动后整组保持同一旧主干',()=>{
 const lines=[line('ab','a','b'),line('ac','a','c')];
 const n=[node('a',0,0),node('b',700,300),node('c',700,600)];
 const old=route(n,lines);
 const split=old.map((item,i)=>({...item,route:{...item.route,points:item.route.points.map((p,k)=>k===1||k===2?{...p,x:i?360:255}:p)}}));
 const joined=route(n,lines,split);assert.deepEqual(lanes(joined[0]),lanes(joined[1]));clear(joined,n);
 const shifted=[node('a',2,3),n[1],n[2]];
 const stable=route(shifted,lines,joined);clear(stable,shifted);
 assert.deepEqual(stable.map(lanes),joined.map(lanes));
 const reversed=route(shifted,[...lines].reverse(),joined);
 for(const item of stable)assert.deepEqual(reversed.find(r=>r.connection.id===item.connection.id).route.points,item.route.points);
});
test('旧共享通道被新障碍阻挡时整组放弃旧主干，同高分支仍保持直连',()=>{
 const lines=[line('ab','a','b'),line('ac','a','c'),line('ad','a','d')];
 const n=[node('a',0,0),node('b',700,300),node('c',700,600),node('d',700,0)];
 const old=route(n,lines);const blocked=[...n,node('block',340,150,40,100)];
 const current=route(blocked,lines,old);clear(current,blocked);
 assert.deepEqual(lanes(current[0]),lanes(current[1]));
 assert.notDeepEqual(lanes(current[0]),lanes(old[0]));
 assert.deepEqual(current[2].route.points,[{x:200,y:60},{x:700,y:60}]);
});
test('下方结果不强迫右侧结果走U形主干，目标轻微高差也不绕远',()=>{
 for(const dy of [0,2,12]){
  const n=[node('a',0,100),node('right',900,100+dy),node('lower',550,450)];
  const g=route(n,[line('lower','a','lower'),line('right','a','right')]);
  const p=g.find(i=>i.connection.id==='right').route.points;
  assert.ok(p.every(v=>v.y>=160&&v.y<=160+dy));
  assert.ok(p.length<=4);clear(g,n);
 }
});
test('截图回归：参考图与右下提示词共用目标入口竖向通道',()=>{
 const n=[node('reference',0,140),node('prompt',650,500),node('config',1000,0)];
 const lines=[line('ref','reference','config'),line('prompt','prompt','config')];
 const g=route(n,lines);assert.equal(g.length,2);clear(g,n);
 const verticals=g.map(item=>item.route.points.slice(1).flatMap((b,i)=>{const a=item.route.points[i];return a.x===b.x&&a.y!==b.y?[a.x]:[];}));
 assert.equal(verticals[0].length,1);assert.equal(verticals[1].length,1);assert.equal(verticals[0][0],verticals[1][0]);
 const shared=mergeSharedConnectionSegments(g).filter(s=>s.connectionIds.length===2);
 assert.ok(shared.some(s=>s.key.startsWith('V:')));assert.ok(shared.some(s=>s.key.startsWith('H:')));
 const reordered=route(n,[...lines].reverse());
 for(const item of g)assert.equal(reordered.find(x=>x.connection.id===item.connection.id).route.d,item.route.d);
});
test('入口主干遇障碍时仍避障，不为了合并穿过卡片',()=>{
 const n=[node('a',0,0),node('b',400,500),node('target',1000,100),node('block',700,150,180,200)];
 const g=route(n,[line('a','a','target'),line('b','b','target')]);assert.equal(g.length,2);clear(g,n);
});
test('不同目标不因多来源汇流被强迫共用入口竖线',()=>{
 const n=[node('a',0,100),node('b',450,450),node('target',1000,0),node('other',700,100)];
 const g=route(n,[line('a','a','target'),line('b','b','target'),line('other','a','other')]);clear(g,n);
 assert.deepEqual(g.find(x=>x.connection.id==='other').route.points,[{x:200,y:160},{x:700,y:160}]);
});


test('截图回归：入口附近另一配置阻挡时，所有输入一起改用安全共享通道',()=>{
 const n=[node('reference',-614,17,276,224),node('prompt',286,425,340,240),node('target',856,-169,340,240),node('block',730,324,340,240),node('upper',252,-156,340,240)];
 const g=route(n,[line('ref','reference','target'),line('prompt','prompt','target')]);
 assert.equal(g.length,2);clear(g,n);
 const shared=mergeSharedConnectionSegments(g).filter(s=>s.connectionIds.length===2);
 assert.ok(shared.some(s=>s.key.startsWith('V:712')),JSON.stringify(shared));
 for(const item of g)assert.equal(item.route.points.filter((p,i,a)=>i&&p.x===a[i-1].x&&p.y!==a[i-1].y).length,1);
});

test('同一参考图通往相邻入口时不产生距离很近的平行主干',()=>{
 const n=[node('ref',-614,17,276,224),node('p1',286,425,340,240),node('p2',278,722,340,240),node('t1',730,324,340,240),node('t2',714,722,340,240)];
 const g=route(n,[line('r1','ref','t1'),line('r2','ref','t2'),line('p1','p1','t1'),line('p2','p2','t2')]);
 clear(g,n);
 const vertical=item=>item.route.points.slice(1).flatMap((b,i)=>b.x===item.route.points[i].x&&b.y!==item.route.points[i].y?[b.x]:[]);
 assert.deepEqual(vertical(g.find(x=>x.connection.id==='r1')),vertical(g.find(x=>x.connection.id==='r2')));
 assert.ok(mergeSharedConnectionSegments(g).some(s=>s.key.startsWith('V:')&&s.connectionIds.includes('r1')&&s.connectionIds.includes('r2')));
});

test('共享主干T形分叉不叠加尖嘴圆角，单关系高亮也使用相同交点形状',()=>{
 const nodes=[node('a',0,300),node('up',700,0),node('down',700,600)];
 const g=route(nodes,[line('up','a','up'),line('down','a','down')]);
 const network=mergeSharedConnectionSegments(g);
 const junction=g[0].route.points[1];
 const cornerAtJunction=segments=>segments.some(s=>s.key.startsWith('Q:')&&s.key.endsWith(`:${junction.x} ${junction.y}`));
 assert.equal(cornerAtJunction(network),false);
 assert.equal(cornerAtJunction(mergeSharedConnectionSegments([g[0]],g)),false);
 assert.ok(network.some(s=>s.key.startsWith('H:')&&s.connectionIds.length===2));
 assert.ok(network.some(s=>s.key.startsWith('Q:')),'普通转弯仍保留圆角');
 assert.ok(mergeSharedConnectionSegments([g[0]]).some(s=>s.key.startsWith('Q:')&&s.key.endsWith(`:${junction.x} ${junction.y}`)),'独立弯道保持圆角');
});
test('并排结果有轻微高差时统一绕行侧，不形成上下包围回路',()=>{
 const n=[{...node('config',0,0,340,240),type:'config'},node('near',480,0,180,240),node('middle',800,-24,180,240),node('far',1120,3,180,240)];
 const lines=[line('near','config','near'),line('middle','config','middle'),line('far','config','far')];
 const g=route(n,lines);assert.equal(g.length,3);clear(g,n);
 const detours=g.filter(e=>e.connection.id!=='near');
 const lanes=detours.map(e=>e.route.points.filter(p=>p.y<-24||p.y>243).map(p=>p.y));
 assert.ok(lanes.every(v=>v.length>0));assert.equal(new Set(lanes.flat()).size,1);
 assert.ok(detours.every(e=>e.route.points.length<=6));
 const reversed=route(n,[...lines].reverse());for(const e of g)assert.equal(reversed.find(r=>r.connection.id===e.connection.id).route.d,e.route.d);
});
