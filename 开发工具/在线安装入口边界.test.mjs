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
    await updates.configure({developerMode:true,autoInstall:false});
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
function render(status, { blockedPopup = false, progressError = false, installError = false } = {}){
    const calls=[],confirmations=[],module={exports:{}};
    const jsx=(type,props)=>({type,props});
    const fakeRequire=name=>name.includes('可见页面轮询')?{useVisiblePolling(){}}:name.includes('产品界面边界')?{useProductActive:()=>true}:name.includes('独立进度窗口')?{connectUpdateProgressWindow:async popup=>{if(!popup||progressError)throw Error('进度未连接');calls.push('progress-window');}}:name.includes('更新进度面板')?{UpdateProgressPanel:'progress'}:name==='react'?{useEffect(){},useState:()=>[false,()=>{}]}:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:
        name==='antd'?{App:{useApp:()=>({message:{error(){}},modal:{confirm:options=>confirmations.push(options)}})},Button:'button'}:
        {installationMessages:{},updateMessages:{},updateRequest:async operation=>{calls.push(operation);if(operation==='install'&&installError)throw Error('安装未开始');}};
    new Function('require','module','exports','window',compiled)(fakeRequire,module,module.exports,{open:()=>blockedPopup?null:{close(){}},dispatchEvent:()=>calls.push('wake')});
    const tree=module.exports.OnlineInstallActions({status,refresh:async()=>{calls.push('refresh');}});
    const buttons=tree.props.children[1].props.children.filter(child=>child?.type==='button');
    const button=buttons[0];
    return {tree,button,buttons,calls,confirmations};
}
const status=(extra={})=>({download:{state:'verified'},preferences:{autoInstall:false},install:{allowed:true,state:'idle'},...extra});
test('共享入口一次点击提交协调安装，不提前弹确认、不改变自动安装偏好',async()=>{
    const first=render(status());assert.equal(first.button.props.disabled,false);await first.button.props.onClick();
    await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(first.calls,['install','refresh','wake']);
    assert.equal(first.confirmations.length,0);assert.equal(first.calls.includes('approve-manual'),false);
    const staged=render(status({install:{allowed:true,state:'staged',canApprove:true}}));
    assert.equal(staged.button.props.disabled,false);assert.equal(staged.button.props.children,'安装更新');
    staged.button.props.onClick();await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(staged.calls,['install','refresh','wake']);assert.equal(staged.confirmations.length,0);
});
test('安装协调请求失败不弹确认，也不释放页面或打开进度页',async()=>{
    const f=render(status(),{installError:true});f.button.props.onClick();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(f.calls,['install']);assert.deepEqual(f.confirmations,[]);
});
test('查看进度弹窗失败不会提交任何安装操作',async()=>{
    for(const options of [{blockedPopup:true},{progressError:true}]){
        const f=render(status({install:{allowed:true,state:'staged',canApprove:true}}),options);
        f.buttons.at(-1).props.onClick();await new Promise(resolve=>setImmediate(resolve));
        assert.deepEqual(f.calls,[]);
    }
});
test('共享入口在源码、未验签、暂存中及切换中禁用，页面等待状态保留稍后安装',()=>{
    for(const input of [status({install:{allowed:false,state:'source-development'}}),status({download:{state:'downloading'}}),
        status({install:{allowed:true,state:'idle',staging:true}}),status({install:{allowed:true,state:'switching'}})])assert.equal(render(input).button.props.disabled,true);
    const waiting=render(status({install:{allowed:true,state:'awaiting-browser-exit'}}));
    assert.equal(waiting.button.props.disabled,true);assert.equal(waiting.buttons[1].props.children,'稍后安装');
    const queued=render(status({install:{allowed:true,state:'staged',coordination:{mode:'manual',state:'waiting',reason:'upgrade_waiting_tasks'}}}));
    assert.equal(queued.button.props.disabled,true);assert.equal(queued.buttons[1].props.children,'稍后安装');
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
    assert.equal((await request({operation:'preferences',preferences:{developerMode:true,autoInstall:false}})).statusCode,200);authorizations=0;
    const result=await request({operation:'approve-manual'});assert.equal(result.statusCode,200);assert.equal(approvals,1);assert.equal(authorizations,3);
    assert.equal(result.body.result.preferences.autoInstall,false);
    assert.equal((await request({operation:'approve-manual',identity})).statusCode,409);assert.equal(approvals,1);
    await service.close();
});

test('源码模式可保存及冷读自动安装偏好，但不会因此取得暂存、批准或执行安装能力', async () => {
    const { assembleSoftwareUpdates } = await import('../扩展功能/软件更新/更新服务装配.mjs');
    const { PassThrough } = await import('node:stream');
    const dataRoot = await temporary('源码安装偏好-');
    const create = () => assembleSoftwareUpdates({ dataRoot, origin: 'http://localhost:3001', currentVersion: '2.0.0-beta.27',
        authorize: async () => 'page', updatePages: () => ['page'], networkProxy: { getStatus: () => ({ enabled: false }) } });
    let service = create();
    async function request(input) {
        const req = new PassThrough();
        req.url = '/__guan-local/software-updates'; req.method = 'POST';
        req.headers = { host: 'localhost:3001', origin: 'http://localhost:3001', 'content-type': 'application/json',
            'x-guan-local-protocol': 'guan-local-authorization.v1' };
        let statusCode, body;
        const res = { destroyed: false, writableEnded: false, writeHead(code) { statusCode = code; }, end(value) { body = JSON.parse(value); } };
        req.end(JSON.stringify(input)); await service.handle(req, res); return { statusCode, body };
    }
    try {
        assert.equal((await request({ operation: 'status' })).body.result.preferences.autoInstall, true);
        assert.equal((await request({ operation: 'preferences', preferences: { autoInstall: false } })).body.result.preferences.autoInstall, false);
        const enabled = await request({ operation: 'preferences', preferences: { autoInstall: true } });
        assert.equal(enabled.statusCode, 200);
        assert.equal(enabled.body.result.preferences.autoInstall, true);
        assert.equal(enabled.body.result.install.allowed, false);
        await service.close();
        service = create();
        const restored = await request({ operation: 'status' });
        assert.equal(restored.body.result.preferences.autoInstall, true);
        assert.equal(restored.body.result.install.state, 'source-development');
        const idle = await request({ operation: 'activity', activity: { ready: true, idle: true, prepared: false, error: false, version: null } });
        assert.equal(idle.body.result.install.coordination.state, 'idle');
        for (const operation of ['stage', 'install', 'approve', 'approve-manual']) {
            const blocked = await request({ operation });
            assert.equal(blocked.statusCode, 409, operation);
            assert.ok(['web_release_required', 'update_stage_unavailable'].includes(blocked.body.error.code), operation);
        }
        const disabled = await request({ operation: 'preferences', preferences: { autoInstall: false } });
        assert.equal(disabled.statusCode, 200);
        assert.equal(disabled.body.result.preferences.autoInstall, false);
        await service.close();
        service = create();
        assert.equal((await request({ operation: 'status' })).body.result.preferences.autoInstall, false, '已保存关闭的选择不能被新默认值覆盖');
    } finally { await service.close(); }
});

test('客户安装版首次读取默认开启空闲自动安装，用户手动关闭后重启仍关闭', async () => {
    const directory = await temporary('客户自动安装默认-');
    const options = { directory, currentVersion: '2.0.0', auth: {},
        manager: { status: async () => ({ allowed: true, state: 'idle' }) } };
    const updates = new SoftwareUpdates(options);
    assert.equal((await updates.preferences()).autoInstall, true);
    assert.equal((await updates.status()).install.allowed, true);
    await updates.configure({ network: 'direct' });
    assert.equal((await updates.preferences()).autoInstall, true);
    await updates.configure({ autoInstall: false });
    const restarted = new SoftwareUpdates(options);
    assert.equal((await restarted.preferences()).autoInstall, false);
    await restarted.configure({ autoInstall: true });
    assert.equal((await new SoftwareUpdates(options).preferences()).autoInstall, true);
});

test('旧客户偏好缺少自动安装字段时沿用新默认开启，不丢失其他设置', async () => {
    const directory = await temporary('客户旧偏好默认-');
    const options = { directory, currentVersion: '2.0.0', auth: {},
        manager: { status: async () => ({ allowed: true, state: 'idle' }) } };
    const updates = new SoftwareUpdates(options);
    await updates.configure({ autoCheck: false, autoDownload: false, network: 'direct' });
    const old = JSON.parse(await readFile(updates.file));
    delete old.autoInstall;
    await (await import('node:fs/promises')).writeFile(updates.file, JSON.stringify(old));
    const restored = new SoftwareUpdates(options);
    const preferences = await restored.preferences();
    assert.equal(preferences.autoInstall, true);
    assert.equal(preferences.autoCheck, false);
    assert.equal(preferences.autoDownload, false);
    assert.equal(preferences.network, 'direct');
});
