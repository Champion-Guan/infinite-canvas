import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const frontendRequire=createRequire(new URL('../.运行/3100源/画布副本/web/package.json',import.meta.url));
const require=createRequire(frontendRequire.resolve('vite'));
const {buildSync}=require('esbuild');
const load=async entry=>import('data:text/javascript;base64,'+Buffer.from(buildSync({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node'}).outputFiles[0].text).toString('base64'));
const {buildSharedConnectionGeometry}=await load('扩展功能/画布连线/圆角连线路由.ts');
const {obscuredInlineResults,inlineResultOccluders}=await load('扩展功能/画布连线/并排图片关系透视.ts');
const nodes=[{id:'a',type:'config',position:{x:0,y:0},width:200,height:240},{id:'b',type:'image',position:{x:400,y:0},width:180,height:240},{id:'c',type:'image',position:{x:700,y:0},width:180,height:240}];
const lines=[{id:'ab',fromNodeId:'a',toNodeId:'b'},{id:'ac',fromNodeId:'a',toNodeId:'c'}];
const route=(ns=nodes,ls=lines)=>buildSharedConnectionGeometry(ls,new Map(ns.map(n=>[n.id,n])));
test('并排同源结果直穿，不生成图片之间的关系',()=>{const g=route();assert.deepEqual(g[1].route.points,[{x:200,y:120},{x:700,y:120}]);assert.deepEqual(g.map(e=>e.connection),lines);});
test('远图聚焦只淡化中间图，近图与取消聚焦不淡化',()=>{const g=route();assert.deepEqual([...obscuredInlineResults(g,new Set(['ac']))],['b']);assert.equal(obscuredInlineResults(g,new Set(['ab'])).size,0);assert.equal(obscuredInlineResults(g,new Set()).size,0);});
test('无关图片继续避障',()=>{const g=route(nodes,[lines[1]]);assert.ok(g[0].route.points.some(p=>p.y!==120));});

test('悬浮配置展示全部输出时，所有输出端点保持清晰',()=>{const g=route();assert.equal(obscuredInlineResults(g,new Set(['ab','ac'])).size,0);});
test('多张并排输出同时聚焦不会互相淡化，单独远图仍可透视',()=>{const ns=[...nodes,{id:'d',type:'image',position:{x:1000,y:0},width:180,height:240}];const ls=[...lines,{id:'ad',fromNodeId:'a',toNodeId:'d'}];const g=route(ns,ls);assert.equal(obscuredInlineResults(g,new Set(ls.map(l=>l.id))).size,0);assert.deepEqual([...obscuredInlineResults(g,new Set(['ad']))],['b','c']);});

test('未吸附的微小高差不能启用穿透',()=>{for(const delta of [0.001,0.5,2,12]){const ns=nodes.map(n=>n.id==='c'?{...n,position:{...n.position,y:delta}}:n);assert.equal(inlineResultOccluders(ns[0],ns[2],ns.slice(1)).size,0);const g=route(ns);assert.equal(obscuredInlineResults(g,new Set(['ac'])).size,0);}});
test('中间图片也必须端口同高才允许穿透',()=>{const ns=nodes.map(n=>n.id==='b'?{...n,position:{...n.position,y:1}}:n);assert.equal(inlineResultOccluders(ns[0],ns[2],ns.slice(1)).size,0);const g=route(ns);assert.ok(g.find(e=>e.connection.id==='ac').route.points.some(p=>p.y!==120));});
