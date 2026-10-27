import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const frontendRequire=createRequire(new URL('../.运行/3100源/画布副本/web/package.json',import.meta.url));
const require=createRequire(frontendRequire.resolve('vite'));
const code=require('esbuild').buildSync({entryPoints:['扩展功能/画布连线/共享网络数据流.ts'],bundle:true,write:false,format:'esm',platform:'node'}).outputFiles[0].text;
const {sharedNetworkFlow:flow}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const edge=(id,from,to,points)=>({connection:{id},from:{id:from},to:{id:to},route:{points,d:''}});
const p=(x,y)=>({x,y});
test('共享主干只有一份数据流，分叉同时出发',()=>{
 const f=flow([edge('ab','a','b',[p(0,0),p(100,0),p(100,100),p(200,100)]),edge('ac','a','c',[p(0,0),p(100,0),p(100,-100),p(200,-100)])]);
 const trunk=f.segments.filter(s=>s.from==='0:0');assert.equal(trunk.length,1);
 const branches=f.segments.filter(s=>s.from==='100000:0');assert.equal(branches.length,2);
 assert.equal(branches[0].start,branches[1].start);assert.equal(branches[0].start,trunk[0].end);
});
test('不同路程同时汇入，汇合后只沿一条主干继续',()=>{
 const f=flow([edge('at','a','t',[p(0,0),p(100,0),p(100,100),p(200,100)]),edge('bt','b','t',[p(100,200),p(100,100),p(200,100)])]);
 const trunk=f.segments.find(s=>s.from==='100000:100000'&&s.to==='200000:100000');
 assert.ok(trunk);
 const inputs=f.segments.filter(s=>s.to==='100000:100000');assert.equal(inputs.length,2);
 assert.ok(inputs.every(s=>s.end===trunk.start));
});

test('短分支延后出发，长短分支及直线圆角全程同速，并在汇入点同步合并',()=>{
 const f=flow([
  edge('long','long','t',[p(-500,-300),p(100,-300),p(100,100),p(300,100)]),
  edge('short1','short','card',[p(0,200),p(80,200)]),
  edge('short2','card','t',[p(180,200),p(200,200),p(200,100),p(300,100)])
 ]);
 const merge=f.segments.find(s=>s.from==='200000:100000'&&s.to==='300000:100000');assert.ok(merge);
 const first=f.segments.find(s=>s.from==='0:200000');
 const tail=f.segments.find(s=>s.to==='200000:100000'&&s.from.startsWith('200000:'));
 assert.ok(first&&tail);
 const speed=s=>s.length/(s.end-s.start);
 assert.ok(first.start > 0, '短分支必须延后出发');
 const longFirst=f.segments.find(s=>s.from==='-500000:-300000');assert.equal(longFirst.start,0);
 for(const segment of f.segments) assert.ok(Math.abs(speed(segment)-f.total)<1e-6, '每条分支都保持正常速度，不能整条减速');
 assert.ok(Math.abs(speed(first)-speed(tail))<1e-6);
 assert.equal(tail.end,merge.start);
});

test('仅高亮一条分支时仍沿完整网络T字交点，不切圆角捷径',()=>{
 const g=[edge('ab','a','b',[p(0,0),p(100,0),p(100,100),p(200,100)]),edge('ac','a','c',[p(0,0),p(100,0),p(100,-100),p(200,-100)])];
 const f=flow([g[0]],g);
 assert.ok(f.segments.some(s=>s.to==='100000:0'));
 assert.ok(f.segments.some(s=>s.from==='100000:0'));
 assert.ok(!f.segments.some(s=>s.d.includes('Q 100 0 ')));
 assert.ok(f.segments.some(s=>s.d.includes('Q 100 100 ')),'普通转弯仍然保留圆角');
});
test('仅高亮一条汇入关系时仍通过T字汇合中心',()=>{
 const g=[edge('at','a','t',[p(0,0),p(100,0),p(100,100),p(200,100)]),edge('bt','b','t',[p(100,200),p(100,100),p(200,100)])];
 const f=flow([g[0]],g);
 assert.ok(f.segments.some(s=>s.to==='100000:100000'));
 assert.ok(f.segments.some(s=>s.from==='100000:100000'));
 assert.ok(!f.segments.some(s=>s.d.includes('Q 100 100 ')));
});


test('极端长短分支不会因速度差拥挤，发点间距一致且短支出发前不可见',()=>{
 const f=flow([
  edge('long','a','t',[p(-20000,0),p(0,0),p(100,0)]),
  edge('short','b','t',[p(0,40),p(0,0),p(100,0)])
 ]);
 const long=f.segments.find(s=>s.from==='-20000000:0');
 const short=f.segments.find(s=>s.from==='0:40000');
 const trunk=f.segments.find(s=>s.from==='0:0'&&s.to==='100000:0');
 assert.ok(long&&short&&trunk);assert.equal(long.start,0);assert.ok(short.start>.9);
 assert.equal(short.end,trunk.start);assert.equal(long.end,trunk.start);
 const count=Math.max(1,Math.floor(f.total/180)),duration=Math.max(1.2,f.total/100);
 for(const segment of f.segments){
  const velocity=segment.length/((segment.end-segment.start)*duration);
  assert.ok(Math.abs(velocity-100)<1e-6, '长短支实际速度应相同');
  assert.ok(velocity*duration/count>=180-1e-6, '点间距不能被短支减速压缩');
 }
 const visibleAt=(segment,phase)=>phase>=segment.start&&phase<segment.end;
 assert.equal(visibleAt(short,short.start-1e-6),false);
 assert.equal(visibleAt(short,short.start+1e-6),true);
 assert.equal(visibleAt(short,trunk.start),false);assert.equal(visibleAt(trunk,trunk.start),true);
});

test('同一来源分叉后再次汇流，短路等待发车，所有可视段仍同速且主干不重复',()=>{
 const f=flow([
  edge('long','source','target',[p(0,0),p(100,0),p(100,-300),p(300,-300),p(300,0),p(400,0)]),
  edge('short','source','target',[p(0,0),p(100,0),p(300,0),p(400,0)])
 ]);
 const first=f.segments.filter(s=>s.from==='0:0');assert.equal(first.length,1);
 const merge=f.segments.find(s=>s.from==='300000:0'&&s.to==='400000:0');assert.ok(merge);
 const inputs=f.segments.filter(s=>s.to==='300000:0');assert.equal(inputs.length,2);
 assert.ok(inputs.every(s=>s.end===merge.start));
 for(const s of f.segments)assert.ok(Math.abs(s.length/(s.end-s.start)-f.total)<1e-6);
 const short=f.segments.find(s=>s.from==='100000:0'&&s.to==='300000:0');assert.ok(short.start>first[0].end);
});
