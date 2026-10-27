import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const frontendRequire=createRequire(new URL('../.运行/3100源/画布副本/web/package.json',import.meta.url));
const require=createRequire(frontendRequire.resolve('vite'));
const code=require('esbuild').buildSync({entryPoints:['扩展功能/画布连线/连线交点整理.ts'],bundle:true,write:false,format:'esm',platform:'node'}).outputFiles[0].text;
const {connectionJunctions,softJunctionContours,connectionJunctionDots}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const p=(x,y)=>({x,y});
const trunk=[p(100,0),p(100,400)], branches=[100,200,300].map(y=>[p(0,y),p(100,y),p(100,400)]);
const routes=[trunk,...branches];
test('连续主干中途接入的每一支线都识别为交点',()=>{
 const junctions=connectionJunctions(routes);
 for(const y of [100,200,300])assert.ok(junctions.has(`100000:${y*1000}`));
 assert.equal(junctions.size,3);
});
test('轮廓助手半径计算稳定，仅填内侧，不改变路由或制造空洞',()=>{
 for(const scale of [.29,.59,1,1.41,2]){
  const path=softJunctionContours(routes,routes,scale,1.8);
  assert.equal((path.match(/ Q /g)||[]).length,6);
  assert.equal((path.match(/ Z/g)||[]).length,6);
  const numbers=path.match(/-?\d+(?:\.\d+)?/g).map(Number);
  assert.ok(numbers.every(Number.isFinite));
  assert.ok(Math.abs((numbers[0]-numbers[2])*scale+3)<1e-9);
 }
});
test('单线高亮只柔化它经过的方向，直线与普通弯道不添加交点轮廓',()=>{
 assert.equal((softJunctionContours([branches[0]],routes,1,2.6).match(/ Q /g)||[]).length,1);
 assert.equal(softJunctionContours([trunk],routes,1,2.6),'');
 assert.equal(softJunctionContours([branches[0]],[branches[0]],1,1.8),'');
});

test('圆点只出现在实际接合处，单条关系经过时可高亮且不重复',()=>{
 const dots=connectionJunctionDots(routes);
 assert.equal(dots.length,3);assert.equal(new Set(dots.map(p=>p.key)).size,3);
 assert.equal(connectionJunctionDots([branches[0]]).length,0);
 assert.ok(connectionJunctionDots([branches[0]],routes).some(p=>p.y===100));
 assert.equal(connectionJunctionDots([[p(0,10),p(200,10)],[p(100,0),p(100,400)]]).length,0);
});
