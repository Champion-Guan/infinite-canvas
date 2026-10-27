import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
async function temporary(prefix) { const root = await mkdtemp(join(tmpdir(), prefix)); roots.push(root); return root; }
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';
import { SoftwareUpdates } from '../扩展功能/软件更新/software-updates.mjs';
import { WEB_REPOSITORY } from '../扩展功能/客户安装/Web发布协议.mjs';
import { UpdateError } from '../扩展功能/软件更新/update-auth.mjs';

const identity = {repository: WEB_REPOSITORY, version: '2.0.0-beta.7', downloadId: 'verified-download'};
async function fixture(overrides = {}) {
    const calls=[];
    const updates=new SoftwareUpdates({directory:await temporary('在线安装-'),currentVersion:'2.0.0-beta.6',auth:{},
        downloader:{status:()=>({state:'verified'}),stageIdentity:()=>identity},
        manager:{status:async()=>({allowed:true,state:'staged',canApprove:true}),stagedIdentity:async()=>identity,
            approve:async(...args)=>calls.push(args),...overrides}});
    await updates.configure({developerMode:true});
    return {updates,calls};
}
test('手动安装在自动安装关闭时仍可明确确认，且不改变安装偏好',async()=>{
    const {updates,calls}=await fixture();
    assert.equal((await updates.preferences()).autoInstall,false);
    await assert.rejects(updates.approve('saved-and-all-tasks-ended'),e=>e.code==='install_disabled');
    await updates.approve('saved-and-all-tasks-ended',{manual:true});
    assert.deepEqual(calls,[[identity,'saved-and-all-tasks-ended']]);
    assert.equal((await updates.preferences()).autoInstall,false);
});
test('手动安装仍拒绝缺少确认、错误仓库、重复版本及管理器任务阻断',async()=>{
    const first=await fixture();
    await assert.rejects(first.updates.approve('wrong',{manual:true}),e=>e.code==='install_operator_confirmation_required');
    assert.equal(first.calls.length,0);
    for(const staged of [{...identity,repository:'other/repo'},{...identity,version:'2.0.0-beta.6'}]){
        const f=await fixture({stagedIdentity:async()=>staged});
        await assert.rejects(f.updates.approve('saved-and-all-tasks-ended',{manual:true}));assert.equal(f.calls.length,0);
    }
    const blocked=await fixture({approve:async()=>{throw new UpdateError('install_tasks_pending');}});
    await assert.rejects(blocked.updates.approve('saved-and-all-tasks-ended',{manual:true}),e=>e.code==='install_tasks_pending');
});
test('源码模式没有独立管理器，不能因手动选项而取得安装能力',async()=>{
    const {updates}=await fixture();updates.manager=null;
    await assert.rejects(updates.approve('saved-and-all-tasks-ended',{manual:true}),e=>e.code==='update_stage_unavailable');
});
const source=await readFile(new URL('../扩展功能/软件更新/在线安装操作.tsx',import.meta.url),'utf8');
const {code:compiled}=await transformWithEsbuild(source,'在线安装操作.tsx',{loader:'tsx',jsx:'automatic',format:'cjs',target:'es2022',tsconfigRaw:'{}'});
function render(status, { blockedPopup = false, progressError = false } = {}){
    const calls=[],confirmations=[],module={exports:{}};
    const jsx=(type,props)=>({type,props});
    const fakeRequire=name=>name.includes('产品界面边界')?{useProductActive:()=>true}:name.includes('独立进度窗口')?{connectUpdateProgressWindow:async popup=>{if(!popup||progressError)throw Error('进度未连接');calls.push('progress-window');}}:name.includes('更新进度面板')?{UpdateProgressPanel:'progress'}:name==='react'?{useEffect(){},useState:()=>[false,()=>{}]}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:
        name==='antd'?{App:{useApp:()=>({message:{error(){}},modal:{confirm:options=>confirmations.push(options)}})},Button:'button'}:
        {installationMessages:{},updateMessages:{},updateRequest:async operation=>{calls.push(operation);}};
    new Function('require','module','exports','window',compiled)(fakeRequire,module,module.exports,{open:()=>blockedPopup?null:{close(){}}});
    const tree=module.exports.OnlineInstallActions({status,refresh:async()=>{calls.push('refresh');}});
    const buttons=tree.props.children[1].props.children.filter(child=>child?.type==='button');
    const button=buttons[0];
    return {tree,button,buttons,calls,confirmations};
}
const status=(extra={})=>({download:{state:'verified'},preferences:{autoInstall:false},install:{allowed:true,state:'idle'},...extra});
test('共享入口先暂存，再经确认提交手动安装；不会为安装自动开启偏好',async()=>{
    const first=render(status());assert.equal(first.button.props.disabled,false);await first.button.props.onClick();
    // onClick启动异步任务，等待其一次微任务完成。
    await Promise.resolve();assert.deepEqual(first.calls,['stage','refresh']);
    const staged=render(status({install:{allowed:true,state:'staged',canApprove:true}}));
    assert.equal(staged.button.props.disabled,false);assert.equal(staged.button.props.children,'确认并安装');
    staged.button.props.onClick();assert.equal(staged.calls.length,0);assert.equal(staged.confirmations.length,1);
    await staged.confirmations[0].onOk();assert.deepEqual(staged.calls,['progress-window','approve-manual','refresh']);
});
test('进度窗口被拦截或连接失败时不确认安装',async()=>{
    for(const options of [{blockedPopup:true},{progressError:true}]){
        const f=render(status({install:{allowed:true,state:'staged',canApprove:true}}),options);
        f.button.props.onClick();await assert.rejects(f.confirmations[0].onOk(),/进度未连接/);
        assert.equal(f.calls.includes('approve-manual'),false);
    }
});
test('共享入口在源码、未验签、暂存中及切换中禁用，页面等待状态保留稍后安装',()=>{
    for(const input of [status({install:{allowed:false,state:'source-development'}}),status({download:{state:'downloading'}}),
        status({install:{allowed:true,state:'idle',staging:true}}),status({install:{allowed:true,state:'switching'}})])assert.equal(render(input).button.props.disabled,true);
    const waiting=render(status({install:{allowed:true,state:'awaiting-browser-exit'}}));
    assert.equal(waiting.button.props.disabled,true);assert.equal(waiting.buttons[1].props.children,'稍后安装');
});
test('授权HTTP手动入口保持偏好关闭，不接受额外身份并保留双重授权',async()=>{
    const { assembleSoftwareUpdates }=await import('../扩展功能/软件更新/更新服务装配.mjs');
    const { PassThrough }=await import('node:stream');
    let authorizations=0,approvals=0;
    const service=assembleSoftwareUpdates({dataRoot:await temporary('在线安装HTTP-'),origin:'http://localhost:3001',currentVersion:'2.0.0-beta.6',
        authorize:async()=>{authorizations++;},networkProxy:{getStatus:()=>({enabled:false})},manager:{status:async()=>({allowed:true,state:'staged',canApprove:true}),
            stagedIdentity:async()=>identity,approve:async(received,ack)=>{assert.deepEqual(received,identity);assert.equal(ack,'saved-and-all-tasks-ended');approvals++;}}});
    async function request(input){
        const req=new PassThrough();req.url='/__guan-local/software-updates';req.method='POST';req.headers={host:'localhost:3001',origin:'http://localhost:3001','content-type':'application/json','x-guan-local-protocol':'guan-local-authorization.v1'};
        let statusCode,body;const res={destroyed:false,writableEnded:false,writeHead(code){statusCode=code;},end(value){body=JSON.parse(value);}};
        req.end(JSON.stringify(input));await service.handle(req,res);return {statusCode,body};
    }
    assert.equal((await request({operation:'preferences',preferences:{developerMode:true}})).statusCode,200);authorizations=0;
    const result=await request({operation:'approve-manual'});assert.equal(result.statusCode,200);assert.equal(approvals,1);assert.equal(authorizations,3);
    assert.equal(result.body.result.preferences.autoInstall,false);
    assert.equal((await request({operation:'approve-manual',identity})).statusCode,409);assert.equal(approvals,1);
    await service.close();
});
