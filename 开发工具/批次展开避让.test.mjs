import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { variantModules } from './产品变体生成夹具.mjs';
const api = variantModules().load('画布布局/批次展开避让.ts');
const card = (id,x,y,count=1) => ({id,type:'image',position:{x,y},width:200,height:120,metadata:{images:Array.from({length:count},(_,i)=>({id:String(i)}))}});
const intersects = (a,b) => a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;

test('展开临时推开邻近卡片，不推成新的重叠；收起返回原始对象和精确坐标',()=>{
    const nodes=[card('root',0,0,3),card('near',220,0),card('next',450,0),card('far',1600,900)];
    const original=structuredClone(nodes),expanded=new Set(['root']);
    const offsets=api.batchExpansionOffsets(nodes,expanded),shown=api.displayBatchNodes(nodes,offsets);
    const boxes=shown.map(node=>api.batchExpansionBox(node,expanded.has(node.id)));
    for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)assert.equal(intersects(boxes[i],boxes[j]),false);
    assert.ok(offsets.has('near'));assert.ok(offsets.has('next'));assert.ok(!offsets.has('far'));
    assert.deepEqual(nodes,original,'显示偏移不写原始坐标或元数据');
    assert.equal(api.displayBatchNodes(nodes,api.batchExpansionOffsets(nodes,new Set())),nodes);
});

test('多个展开批次、负坐标、多行与15张均可避让，重复计算确定一致',()=>{
    for(const count of [2,3,5,15]){
        const nodes=[card('a',-300,-200,count),card('b',-70,-200,5),...Array.from({length:15},(_,i)=>card('n'+i,(i%5)*225-300,Math.floor(i/5)*145-200))];
        const open=new Set(['a','b']),offsets=api.batchExpansionOffsets(nodes,open),shown=api.displayBatchNodes(nodes,offsets);
        const expanded=shown.filter(n=>open.has(n.id)).map(n=>api.batchExpansionBox(n,true));
        for(const root of expanded)for(const n of shown.filter(n=>!open.has(n.id)))assert.equal(intersects(root,api.batchExpansionBox(n,false)),false);
        assert.equal(intersects(expanded[0],expanded[1]),false);
        assert.deepEqual(offsets,api.batchExpansionOffsets(nodes,open));
    }
});

test('其他组整体避让，组内成员相对位置不变；批次所在组内部也能避让',()=>{
    const root=card('root',0,0,3),group={id:'g',type:'group',position:{x:210,y:-20},width:440,height:180,metadata:{}};
    const a=card('a',230,0),b=card('b',450,0);a.metadata.groupId='g';b.metadata.groupId='g';
    const nodes=[root,group,a,b],offsets=api.batchExpansionOffsets(nodes,new Set(['root']));
    assert.deepEqual(offsets.get('a'),offsets.get('b'));assert.deepEqual(offsets.get('g'),offsets.get('a'));
    root.metadata.groupId='g';group.position={x:-20,y:-20};group.width=670;
    const shown=api.displayBatchNodes(nodes,api.batchExpansionOffsets(nodes,new Set(['root'])));
    for(const n of shown.filter(n=>n.id==='a'||n.id==='b'))assert.equal(intersects(api.batchExpansionBox(shown[0],true),api.batchExpansionBox(n,false)),false);
});

test('适度平移只补足屏外部分，不改变缩放；超大展开区域居中且保留缩放',()=>{
    const view={x:0,y:0,k:1},canvas={left:250,top:80,right:1440,bottom:900},safe={left:262,top:156,right:1428,bottom:808};
    assert.deepEqual(api.revealBatchExpansion(view,{left:100,top:100,right:600,bottom:500},canvas,safe),view);
    const next=api.revealBatchExpansion(view,{left:900,top:700,right:1300,bottom:1000},canvas,safe);
    assert.equal(next.k,1);assert.equal(next.x,-122);assert.equal(next.y,-272);
    assert.equal(api.revealBatchExpansion(view,{left:-1000,top:-1000,right:3000,bottom:3000},canvas,safe).k,1);
    const root={left:100,top:100,right:300,bottom:220};
    const huge=api.revealBatchExpansion(view,{left:100,top:-300,right:2000,bottom:220},canvas,safe,root);
    const buttonX=canvas.left+huge.x+(root.right-24)*huge.k,buttonY=canvas.top+huge.y+(root.top+24)*huge.k;
    assert.ok(buttonX>=safe.left+16&&buttonX<=safe.right-16);
    assert.ok(buttonY>=safe.top+16&&buttonY<=safe.bottom-16);
});

test('接入只替换显示、连线及命中坐标，保存和历史仍使用原节点；按钮双击独立隔离',()=>{
    const page=readFileSync('.运行/3100源/画布副本/web/src/pages/canvas/project.tsx','utf8');
    assert.match(page,/const displayNodes = useBatchExpansionDisplay/);
    assert.match(page,/useCanvasConnectionSystem\(connections, displayNodeById/);
    assert.match(page,/nodes: nodesRef.current/);
    assert.match(page,/basePosition \|\| node.position/);
    assert.match(page,/visibleNodes: visibleMediaNodes/,'媒体恢复仅交付原始对象，防止显示偏移混入恢复写回');
    const node=readFileSync('.运行/3100源/画布副本/web/src/components/canvas/canvas-node.tsx','utf8');
    assert.equal((node.match(/aria-expanded=\{batchExpanded\}/g)||[]).length,2);
    assert.match(node,/closest\("button,\[role='button'\]"\)/);
    assert.ok((node.match(/onDoubleClick=\{\(event\) => event.stopPropagation\(\)\}/g)||[]).length>=2);
});

test('实际卡片双击处理器忽略按钮与按钮子图标，普通图片双击仍打开详情',()=>{
    const require=createRequire(new URL('../.运行/3100源/画布副本/web/package.json',import.meta.url)),ts=require('typescript');
    const text=readFileSync('.运行/3100源/画布副本/web/src/components/canvas/canvas-node.tsx','utf8');
    const tree=ts.createSourceFile('canvas-node.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    let handler;
    const visit=node=>{
        if(ts.isJsxAttribute(node)&&node.name.getText(tree)==='onDoubleClick'){
            const body=node.initializer?.expression?.getText(tree);
            if(body?.includes('onViewImage?.(data)'))handler=body;
        }
        ts.forEachChild(node,visit);
    };
    visit(tree);assert.ok(handler);
    const compiled=ts.transpileModule('const handler='+handler,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
    let details=0,stops=0;
    const action=new Function('referenceSelectionState','definition','pluginContext','data','CanvasNodeType','hasImageContent','onViewImage','setIsEditingContent',compiled+';return handler;')(
        null,null,null,{id:'batch',type:'image'},{Image:'image',Text:'text'},true,()=>details++,()=>{throw Error('不应编辑文字')});
    for(const button of [true,true,true])action({target:{closest:()=>button},stopPropagation(){stops++;}});
    assert.equal(details,0);assert.equal(stops,3);
    action({target:{closest:()=>null},stopPropagation(){stops++;}});
    assert.equal(details,1);
});

test('避让与归位240ms连续过渡，反向从当前坐标接续，减少动态效果即时完成并可清理',()=>{
    const {createBatchDisplacementPlayer}=variantModules().load('画布布局/批次避让过渡.ts');
    let now=0,id=0,current;const frames=new Map();
    const player=createBatchDisplacementPlayer({frame:fn=>{frames.set(++id,fn);return id},cancel:id=>frames.delete(id),now:()=>now,write:value=>{current=value}});
    const advance=time=>{now=time;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(now));};
    player.move(new Map([['a',{x:300,y:120}]]),false);advance(80);
    const middle=current.get('a');assert.ok(middle.x>0&&middle.x<300);
    player.move(new Map(),false);advance(80);assert.deepEqual(current.get('a'),middle,'反向第一帧不闪回');
    advance(200);assert.ok(current.get('a').x<middle.x&&current.get('a').x>0);
    advance(320);assert.equal(current.size,0);assert.equal(frames.size,0);
    player.move(new Map([['a',{x:100,y:20}]]),true);assert.equal(current.get('a').x,100);assert.equal(frames.size,0);
    player.move(new Map(),false);assert.equal(frames.size,1);player.stop();assert.equal(frames.size,0);
});
