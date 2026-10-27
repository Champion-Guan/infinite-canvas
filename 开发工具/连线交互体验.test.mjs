import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const frontendRequire=createRequire(new URL('../.运行/3100源/画布副本/web/package.json',import.meta.url));
const require=createRequire(frontendRequire.resolve('vite'));
const {buildSync}=require('esbuild');
async function load(file){const code=buildSync({entryPoints:[file],bundle:true,write:false,format:'esm',platform:'node'}).outputFiles[0].text;return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));}
const {connectionScreenMetrics,connectionDesign}=await load('扩展功能/画布连线/连线视觉设计.ts');
const {connectionInteractionFocus}=await load('扩展功能/画布连线/连线关系聚焦.ts');
const item=(id,from,to)=>({connection:{id,fromNodeId:from,toNodeId:to},from:{id:from},to:{id:to}});
const g=[item('input','source','config'),item('b','config','b'),item('c','config','c')];
test('线宽与命中区使用画布单位，随整体缩放同比变化',()=>{for(const zoom of [.29,.35,1,2]){const m=connectionScreenMetrics(zoom);assert.ok(Math.abs(m.line*zoom-1.8*zoom)<1e-8);assert.ok(Math.abs(m.hit*zoom-24*zoom)<1e-8);}});
test('无选择时悬浮图片B只显示其上游关系，不点亮C',()=>{const f=connectionInteractionFocus(g,new Set(),null,'b');assert.deepEqual([...f.connectionIds].sort(),['b','input']);});
test('悬浮移出后恢复原先选中的连线',()=>{assert.deepEqual([...connectionInteractionFocus(g,new Set(),'c','b').connectionIds].sort(),['b','input']);assert.deepEqual([...connectionInteractionFocus(g,new Set(),'c',null).connectionIds],['c']);});
test('无悬浮且无选择时不遗留高亮；浅深主题默认线均保持可读',()=>{assert.equal(connectionInteractionFocus(g,new Set(),null,null).connectionIds.size,0);assert.ok(connectionDesign.light.opacity>=.8);assert.ok(connectionDesign.dark.opacity>=.8);});
test('悬浮生成配置同时高亮输入和直接输出关系',()=>{assert.deepEqual([...connectionInteractionFocus(g,new Set(),null,'config').connectionIds].sort(),['b','c','input']);});
