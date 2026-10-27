import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const frontendRequire=createRequire(new URL('../.运行/3100源/画布副本/web/package.json',import.meta.url));
const require=createRequire(frontendRequire.resolve('vite'));
const code=require('esbuild').buildSync({entryPoints:['扩展功能/画布连线/连线端口吸附.ts'],bundle:true,write:false,format:'esm',platform:'node'}).outputFiles[0].text;
const {snapConnectionPorts:snap}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const node=(id,y)=>({id,type:'image',position:{x:id==='a'?0:600,y},width:200,height:120});
const edges=[{id:'ab',fromNodeId:'a',toNodeId:'b'}];
test('各缩放下以16屏幕像素为阈值，吸附后端口严格同高',()=>{
 for(const k of [.29,1,1.85,2]){
  const nodes=[node('a',0),node('b',15/k)];
  const result=snap(nodes,edges,new Set(['b']),k);
  assert.equal(result.nodes[1].position.y,0);assert.ok(result.guide);
  assert.equal(nodes[1].position.y,15/k);
  assert.equal(snap([node('a',0),node('b',17/k)],edges,new Set(['b']),k).guide,null);
 }
});
test('来源也可吸附，多选保持相对位置，内部关系不自吸附',()=>{
 const nodes=[node('a',4),node('b',0),node('c',100)];
 const result=snap(nodes,edges,new Set(['a','c']),1);
 assert.equal(result.nodes[0].position.y,0);assert.equal(result.nodes[2].position.y,96);
 assert.equal(result.nodes[1],nodes[1]);
 assert.equal(snap(nodes,edges,new Set(['a','b']),1).guide,null);
});
