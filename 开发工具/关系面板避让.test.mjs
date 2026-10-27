import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const frontendRequire=createRequire(new URL('../.运行/3100源/画布副本/web/package.json',import.meta.url));
const require=createRequire(frontendRequire.resolve('vite'));
const load=async entry=>import('data:text/javascript;base64,'+Buffer.from(require('esbuild').buildSync({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node'}).outputFiles[0].text).toString('base64'));
const {placeConnectionPicker:place}=await load('扩展功能/画布连线/关系面板避让.ts');
const {sharedConnectionChoices}=await load('扩展功能/画布连线/共享主干关系选择.ts');
const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
test('面板避开整组端点卡片及连线，不只避开点击位置',()=>{
 const view={left:0,top:0,right:1400,bottom:900},size={width:350,height:280};
 const cards=[{left:200,top:300,right:450,bottom:540},{left:650,top:300,right:830,bottom:540},{left:1000,top:300,right:1180,bottom:540}];
 const lines=[{left:450,top:408,right:1000,bottom:432}];
 const p=place(view,size,{x:600,y:420},cards,lines),box={...p,right:p.left+350,bottom:p.top+280};
 assert.ok([...cards,...lines].every(b=>!intersects(box,b)));assert.ok(p.left>=0&&p.top>=0&&box.right<=1400&&box.bottom<=900);
});
test('拥挤画布仍将面板保持在视口内',()=>{const p=place({left:100,top:20,right:800,bottom:600},{width:350,height:280},{x:790,y:590},[{left:100,top:20,right:800,bottom:600}],[]);assert.ok(p.left>=100&&p.left+350<=800&&p.top>=20&&p.top+280<=600);});
test('列表按路由长度排序而非端点直线距离或传入顺序',()=>{const edge=(id,points)=>({connection:{id},route:{points}});const g=[edge('绕路',[{x:0,y:0},{x:0,y:500},{x:100,y:500},{x:100,y:0}]),edge('直连',[{x:0,y:0},{x:300,y:0}]),edge('短线',[{x:0,y:0},{x:100,y:0}])];assert.deepEqual(sharedConnectionChoices(g.map(e=>e.connection.id),g).map(e=>e.connection.id),['短线','直连','绕路']);});
test('空间拥挤时优先保全当前关系卡片，不以遮挡它们换取较少的无关遮挡',()=>{
 const view={left:0,top:0,right:1000,bottom:700},size={width:400,height:250};
 const related={left:600,top:300,right:950,bottom:450};
 const unrelated={left:0,top:0,right:1000,bottom:270};
 const p=place(view,size,{x:800,y:300},[related,unrelated],[],[related]);
 assert.ok(!intersects({...p,right:p.left+size.width,bottom:p.top+size.height},related));
});
