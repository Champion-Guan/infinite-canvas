import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const frontendRequire=createRequire(new URL('../.运行/3100源/画布副本/web/package.json',import.meta.url));
const require=createRequire(frontendRequire.resolve('vite'));
const load=async file=>import('data:text/javascript;base64,'+Buffer.from(require('esbuild').buildSync({entryPoints:[file],bundle:true,write:false,format:'esm',platform:'node'}).outputFiles[0].text).toString('base64'));
const {sharedResultDetours}=await load('扩展功能/画布连线/并排结果共享绕行.ts');
const {buildConnectionFocus,connectionInteractionFocus}=await load('扩展功能/画布连线/连线关系聚焦.ts');
const {obscuredInlineResults}=await load('扩展功能/画布连线/并排图片关系透视.ts');
const {buildSharedConnectionGeometry}=await load('扩展功能/画布连线/圆角连线路由.ts');
const node=(id,type,x,y)=>({id,type,position:{x,y},width:200,height:240});
const edge=(id,fromNodeId,toNodeId)=>({id,fromNodeId,toNodeId});
const nodes=[node('input','text',0,0),node('config','config',400,0),node('b','image',800,0),node('c','image',1100,0)];
const connections=[edge('input','input','config'),edge('b','config','b'),edge('c','config','c')];
const g=buildSharedConnectionGeometry(connections,new Map(nodes.map(n=>[n.id,n])));
test('选择和悬浮配置统一查看整组，所有输出均受保护',()=>{
 const selected=buildConnectionFocus(g,new Set(['config']),null),hover=connectionInteractionFocus(g,new Set(),null,'config');
 assert.deepEqual([...selected.connectionIds].sort(),['b','c','input']);assert.deepEqual([...hover.connectionIds].sort(),[...selected.connectionIds].sort());
 assert.equal(obscuredInlineResults(g,selected.connectionIds).size,0);assert.ok(selected.protectedNodeIds.has('b')&&selected.protectedNodeIds.has('c'));
});
test('图片聚焦只追溯自己，离开悬浮恢复原选线',()=>{
 const hovered=connectionInteractionFocus(g,new Set(),'b','c');assert.ok(hovered.connectionIds.has('c'));assert.ok(!hovered.connectionIds.has('b'));
 const restored=connectionInteractionFocus(g,new Set(),'b',null);assert.deepEqual([...restored.connectionIds],['b']);
 assert.deepEqual([...obscuredInlineResults(g,hovered.connectionIds)],['b']);
});
const branches=[{id:'near',start:{x:200,y:120},end:{x:400,y:121},boxes:[{left:400,right:600,top:0,bottom:240}]},{id:'far',start:{x:200,y:120},end:{x:800,y:121},boxes:[{left:382,right:618,top:-18,bottom:258}]}];
test('微小路径差不换侧，旧侧遇障碍立即放弃',()=>{
 const kept=sharedResultDetours(branches,0,240,'bottom');assert.equal(kept.get('far')[2].y,258);
 const blocked=branches.map(b=>({...b,boxes:[...b.boxes,{left:650,right:700,top:250,bottom:280}]}));
 const changed=sharedResultDetours(blocked,0,240,'bottom');assert.equal(changed.get('far')[2].y,-18);
});

const {retainSafeConnectionRoute:retain}=await load('扩展功能/画布连线/连线路径稳定.ts');
test('普通路径小幅移动保留主干，但不能保留穿障碍或明显绕远的旧路径',()=>{
 const previous=[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:300,y:100}];
 const fresh=[{x:0,y:2},{x:150,y:2},{x:150,y:101},{x:300,y:101}];
 const stable=retain(previous,fresh,[]);assert.equal(stable[1].x,100);assert.equal(stable[0].y,2);assert.equal(stable.at(-1).y,101);
 assert.equal(retain(previous,fresh,[{left:90,right:110,top:20,bottom:80}]),fresh);
 assert.equal(retain(previous,[{x:0,y:2},{x:300,y:2}],[]).length,2);
});
