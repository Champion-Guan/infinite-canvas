import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from '../.运行/3100源/画布副本/web/node_modules/vite/dist/node/index.js';
import { productDisplayName } from '../扩展功能/产品/旧版产品显示名.js';
import { createValueCodec } from '../扩展功能/本机存储/应用值编码.mjs';
import { buildFragmentPlan } from '../扩展功能/本机存储/分片值编码.mjs';
import { validateFallback } from '../扩展功能/故障切换/SQLite切换配置.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(resolve(root, '.运行/3100源/画布副本/web/package.json'));
const fflate = require('fflate');
async function load(path, dependencies) {
  const file = resolve(root, path);
  const { code } = await transformWithEsbuild(readFileSync(file,'utf8'), file, { loader:'ts', format:'cjs', target:'es2022', tsconfigRaw:'{}' });
  const module = { exports: {} };
  new Function('require','module','exports',code)(id => { assert.ok(Object.hasOwn(dependencies,id), '缺少依赖：'+id); return dependencies[id]; }, module, module.exports);
  return module.exports;
}
const reader = await load('扩展功能/整批迁移/旧版备份读取.ts', {});
const mediaReferences = await load('扩展功能/整批迁移/旧版媒体引用归一.ts', {});
let uploadedImages=0;
const imageHydration=await load('.运行/3100源/画布副本/web/src/lib/canvas/canvas-generation-helpers.ts',{
  '@/stores/use-config-store':{},'@/i18n':{},'@/lib/canvas/canvas-node-factory':{},
  '@/types/canvas':{CanvasNodeType:{Image:'image',Video:'video',Audio:'audio'}},
  '@/services/image-storage':{ensureImagePreview:async()=>{},resolveImageUrl:async(key,fallback='')=>key&&!key.includes('_missing_')?'blob:current/'+key:fallback,uploadImage:async()=>{uploadedImages++;throw Error('不得重传已保存图片');}},
  '@/services/file-storage':{resolveMediaUrl:async key=>'blob:current/'+key},
});
let serial = 0;
const canvas = await load('扩展功能/画布导入/画布导入数据.ts', { nanoid: { nanoid:()=>`media_${++serial}` } });
const books = await load('扩展功能/Excel/Excel产品归属.ts', { './旧版Excel合同.js':{}, '../产品/旧版产品显示名.js':{ productDisplayName } });
const products = await load('扩展功能/整批迁移/旧版产品转换.ts', {
  fflate, '../画布导入/画布导入数据':canvas, '../Excel/Excel产品归属':books,
  '../产品/旧版产品显示名.js':{ productDisplayName }, './旧版备份读取':reader,
  './旧版媒体引用归一':mediaReferences,
});
const stamp='2026-10-24T00:00:00.000Z';
const project=(id,title,nodes=[])=>({id,title,nodes,connections:[],createdAt:stamp,updatedAt:stamp,chatSessions:[],activeChatId:null,backgroundMode:'lines',showImageInfo:false,viewport:{x:0,y:0,k:1}});
const node={id:'node',type:'image',position:{x:10,y:20},width:300,height:400,metadata:{storageKey:'image:display',originalStorageKey:'image:original',deliveryStorageKey:'image:delivery',references:['image:ref']}};
function backup() {
  const product=(id,book,title)=>({id,productSetId:book,identity:{titleZh:title},attributes:{},order:1,sourceRowNumber:2,createdAt:stamp,updatedAt:stamp});
  const source=fileName=>({fileName,kind:'xlsx',promptTemplates:[{id:'template',route:'产品',prompts:{main:'真实提示词'},order:1,sourceRowNumber:2}],importedAt:stamp});
  const contract={schema:'guan-workbench.v1',workspace:{id:'workspace',activeProductSetId:'bookA',activeProductId:'prodA'},
    productSets:[{id:'bookA',source:source('文件甲.xlsx'),productIds:['prodA'],createdAt:stamp,updatedAt:stamp},{id:'bookB',source:source('文件乙.xlsx'),productIds:['prodB'],createdAt:stamp,updatedAt:stamp}],
    products:[product('prodA','bookA','产品甲'),product('prodB','bookB','产品乙')],slots:[],prompts:[],tasks:[],runs:[],assets:[],providerAttempts:[],importRecords:[]};
  return {app:'guan-ai-workbench',kind:'full-browser-backup',format:1,origin:'http://localhost:3000',sessionStorage:{},localStorage:{
    'guan-workbench:data-contract:v1':JSON.stringify(contract),'guan-native-canvas-route:prodA':'/canvas/nativeA',
    'guan-header-canvas-projects':JSON.stringify([{id:'extra',title:'独立产品',productSetId:null}]),
    'guan-canvas-parameter-values:prodA':JSON.stringify({'[长度]':'','[数量]':'2'}),
  }, databases:[{name:'infinite-canvas',stores:[{name:'app_state',records:[{key:'infinite-canvas:canvas_store',value:JSON.stringify({state:{projects:[project('nativeA','产品甲',[node]),project('extra','独立产品'),project('orphan','未登记画布')],deletedProjects:[]}})}]},
    {name:'image_files',records:['display','original','delivery','ref'].map(key=>({key:'image:'+key,value:{$type:'blob',id:1,mime:'image/png',bytes:3,base64:'YWJj'}}))}]}]};
}
const empty={projects:[],deletedProjects:[],guanWorkbooks:null};
test('临时媒体缓存不跨浏览器保存；持久引用、提示词和缺失标记保留，无编号则预检拒绝',()=>{
  const original={storageKey:'image:kept',content:'blob:http://localhost:3000/expired',prompt:'客户原始提示词',images:[{storageKey:'image:missing',content:'blob:http://localhost:3000/also-expired'}]};
  const normalized=mediaReferences.normalizeLegacyMediaReferences(original);
  assert.equal(normalized.storageKey,original.storageKey);assert.equal(normalized.prompt,original.prompt);assert.equal(normalized.content,undefined);assert.equal(normalized.images[0].content,undefined);
  assert.ok(original.content.startsWith('blob:'));assert.throws(()=>mediaReferences.normalizeLegacyMediaReferences({content:'blob:http://localhost:3000/no-file'}),/没有持久素材编号/);
});
test('真实画布恢复器从持久编号重建无缓存图片、多图及音视频；不重传或伪造缺素材',async()=>{
  const nodes=[
    {id:'primary',type:'image',metadata:{storageKey:'image:primary',images:[{storageKey:'image:child'}]}},
    {id:'children',type:'image',metadata:{images:[{storageKey:'image:only-child'}]}},
    {id:'empty',type:'image',metadata:{}},
    {id:'missing',type:'image',metadata:{storageKey:'image:source_missing_file'}},
    {id:'video',type:'video',metadata:{storageKey:'video:saved'}},
    {id:'audio',type:'audio',metadata:{storageKey:'audio:saved'}},
  ];
  const restored=await imageHydration.hydrateCanvasImages(nodes);
  assert.equal(restored[0].metadata.content,'blob:current/image:primary');assert.equal(restored[0].metadata.images[0].content,'blob:current/image:child');
  assert.equal(restored[1].metadata.images[0].content,'blob:current/image:only-child');
  assert.ok(!restored[2].metadata.content);assert.equal(restored[3].metadata.content,'');
  assert.equal(restored[4].metadata.content,'blob:current/video:saved');assert.equal(restored[5].metadata.content,'blob:current/audio:saved');
  assert.equal(uploadedImages,0);assert.equal(nodes[0].metadata.content,undefined);assert.equal(nodes[0].metadata.images[0].content,undefined);
});
test('整批读取只接受完整备份，拒绝重复数据库',()=>{
  assert.equal(reader.readLegacyBackup(backup()).format,1);
  assert.throws(()=>reader.readLegacyBackup({app:'infinite-canvas',version:3,projects:[]}));
  const b=backup();b.databases.push(b.databases[0]);assert.throws(()=>reader.readLegacyBackup(b));
});
test('恢复标记 value:N 不是JSON；最新本地副本优先；墓碑不复活',()=>{
  const b=backup(),key='infinite-canvas:canvas_store';b.localStorage['infinite-canvas:fallback:'+key]='value:7';
  b.localStorage[key]=JSON.stringify({state:{projects:[]}});assert.deepEqual(reader.legacyState(b,key),{projects:[]});
  b.localStorage['infinite-canvas:fallback:'+key]='deleted:8';assert.equal(reader.legacyState(b,key),null);
});
test('Blob校验真实字节，拒绝损坏或冒充对象',async()=>{
  const value=backup().databases[0].stores[1].records[0].value;
  assert.equal(await reader.decodeLegacyBlob(value).text(),'abc');
  assert.throws(()=>reader.decodeLegacyBlob({...value,bytes:5}));
  assert.throws(()=>reader.decodeLegacyBlob({...value,base64:'a==='}));
  assert.throws(()=>reader.decodeLegacyBlob({$type:'object',entries:[]}));
});
test('跨工作簿的所有产品、独立画布、未打开的空画布、四类图片引用一起转换',async()=>{
  const p=await products.prepareLegacyProducts(backup());
  assert.equal(p.snapshot.projects.length,4);assert.equal(p.media.length,4);
  const a=p.snapshot.projects.find(item=>item.id.endsWith('_prodA'));
  assert.equal(a.nodes.length,1);assert.ok(a.productSetId.endsWith('_bookA'));
  assert.equal(p.snapshot.projects.find(item=>item.id.endsWith('_prodB')).nodes.length,0);
  assert.equal(p.snapshot.guanWorkbooks.contract.productSets[1].source.fileName,'文件乙.xlsx');
  for (const key of ['storageKey','originalStorageKey','deliveryStorageKey']) assert.ok(a.nodes[0].metadata[key].startsWith('image:media_'));
  assert.ok(a.nodes[0].metadata.references[0].startsWith('image:media_'));
  assert.equal(JSON.parse(Object.values(p.preferences)[0])['[长度]'],'');
  books.assertWorkbookSnapshot(p.snapshot);
});
test('压缩合同可读取；源缺素材、画布映射缺失或同名歧义时不导空画布',async()=>{
  const b=backup();b.localStorage['guan-workbench:data-contract:v1']='guan-workbench-compressed-v1:'+Buffer.from(fflate.compressSync(fflate.strToU8(b.localStorage['guan-workbench:data-contract:v1']))).toString('base64');
  assert.equal((await products.prepareLegacyProducts(b)).snapshot.guanWorkbooks.contract.productSets.length,2);
  const missing=backup();missing.databases[0].stores[1].records.pop();assert.equal((await products.prepareLegacyProducts(missing)).missingMedia.length,1);
  const route=backup();route.localStorage['guan-native-canvas-route:prodA']='/canvas/missing';await assert.rejects(products.prepareLegacyProducts(route),/映射缺失/);
});
test('整批合并保留目标已有产品和工作簿；重导不会重复创建或复活回收产品',async()=>{
  const incoming=(await products.prepareLegacyProducts(backup())).snapshot;
  const target={...empty,projects:[project('existing','原有客户产品')]};
  const first=products.mergeLegacyProducts(target,incoming);assert.equal(first.added,4);assert.equal(first.snapshot.projects[0],target.projects[0]);
  const second=products.mergeLegacyProducts(first.snapshot,incoming);assert.equal(second.added,0);assert.equal(second.skipped,4);assert.equal(second.snapshot.guanWorkbooks.contract.productSets.length,2);
  const recycled={...first.snapshot,projects:first.snapshot.projects.filter(item=>item.id!==incoming.projects[0].id),deletedProjects:[{id:incoming.projects[0].id,project:incoming.projects[0],deletedAt:stamp}]};
  assert.equal(products.mergeLegacyProducts(recycled,incoming).added,0);
});
test('不改写产品原始属性或Excel表头中的id列；模型及渠道引用单独同步',async()=>{
  const b=backup(),raw=JSON.parse(b.localStorage['guan-workbench:data-contract:v1']);
  raw.products[0].attributes={id:'客户原始编号',productId:'客户自定义内容'};raw.productSets[0].source.headerMap={productId:'商品编号列'};
  b.localStorage['guan-workbench:data-contract:v1']=JSON.stringify(raw);
  b.localStorage['guan-workbook-active-canvas:bookA']='prodA';
  const p=await products.prepareLegacyProducts(b);assert.deepEqual(p.snapshot.guanWorkbooks.contract.products[0].attributes,raw.products[0].attributes);
  assert.equal(p.snapshot.guanWorkbooks.contract.productSets[0].source.headerMap.productId,'商品编号列');
  assert.ok(Object.values(p.snapshot.guanWorkbooks.activeByWorkbook)[0].endsWith('_prodA'));
  p.snapshot.projects[0].nodes[0].metadata={model:'default::image',channelId:'default',prompt:'原文default::image保持'};
  const next=products.remapLegacyProjectChannels(p.snapshot,new Map([['default','new_channel']]));
  assert.equal(next.projects[0].nodes[0].metadata.model,'new_channel::image');assert.equal(next.projects[0].nodes[0].metadata.channelId,'new_channel');assert.equal(next.projects[0].nodes[0].metadata.prompt,'原文default::image保持');
});
test('源媒体缺失逐项列出并保留缺失编号，不创建空文件；普通ZIP仍拒绝缺文件',async()=>{
  const b=backup();b.databases[0].stores[1].records=[];
  const p=await products.prepareLegacyProducts(b);assert.equal(p.missingMedia.length,4);assert.equal(p.media.length,0);
  assert.match(p.snapshot.projects[0].nodes[0].metadata.originalStorageKey,/_missing_/);
  assert.throws(()=>canvas.prepareCanvasExport({app:'infinite-canvas',version:3,projects:[{project:project('a','a',[node]),files:[]}]},new Map()),/未包含在 ZIP/);
});

const channel={id:'default',name:'默认',apiFormat:'openai',baseUrl:'https://example.invalid',apiKey:'',models:[{name:'image',capability:'image'}]};
const defaults={channelMode:'local',baseUrl:channel.baseUrl,apiKey:'',apiFormat:'openai',channels:[channel],model:'default::image',imageModel:'default::image',videoModel:'',textModel:'',audioModel:'',models:['default::image'],size:'1:1',quality:'auto',reasoningEffort:'auto',nodeRegenerateBehavior:'new-node',autoFocusOnSelect:false,proxyEnabled:false,proxyUrl:'http://127.0.0.1:23210'};
const webdav={url:'',username:'',password:'',directory:'canvas',lastSyncedAt:''};
const configStore={defaultConfig:defaults,defaultWebdavSyncConfig:webdav,defaultBaseUrlForApiFormat:format=>format==='gemini'?'https://generativelanguage.googleapis.com':'https://api.openai.com'};
const safety=await load('扩展功能/配置文件/配置文件安全.ts',{
  'file-saver':{},'@/i18n/index':{default:{t:key=>key}},'@/stores/use-config-store':configStore,'@/stores/use-prompt-source-store':{},
  '@/services/api/prompt-source-presets':{filterWorkbenchPromptSources:value=>value},'../本机存储/上游浏览器存储桥':{},
});
const settings=await load('扩展功能/整批迁移/旧版配置转换.ts',{'@/stores/use-config-store':configStore,'../配置文件/配置文件安全':safety,'./旧版备份读取':reader});
const fallbackPolicy=await import('../扩展功能/故障切换/原版策略.mjs');
const fallbackOrder=await import('../扩展功能/故障切换/模型默认排序.mjs');
const fallback=await load('扩展功能/整批迁移/旧版故障切换转换.ts',{'../故障切换/原版策略.mjs':fallbackPolicy,'../故障切换/模型默认排序.mjs':fallbackOrder,'./旧版备份读取':reader});
const configDoc=()=>({app:'infinite-canvas',version:1,exportedAt:stamp,config:structuredClone(defaults),webdav:structuredClone(webdav),promptSources:{sources:[],schedule:{intervalMinutes:30,lastFetchedAt:''}}});
test('备份内配置和补充配置文件均脱敏，原工作区绑定不复用',()=>{
  const b=backup(),cfg=configDoc();cfg.config.channels[0].apiKey='guan-vault:old-account';cfg.config.apiKey='secret:'+'1'.repeat(64);
  cfg.config.channels[0].models[0].script='synthetic secret';cfg.config.size='1152x1536';
  b.localStorage['infinite-canvas:ai_config_store']=JSON.stringify({state:{config:cfg.config,webdav:cfg.webdav}});
  const result=settings.prepareLegacySettings(b,'source');assert.equal(result.data.config.apiKey,'');assert.equal(result.data.config.channels[0].apiKey,'');assert.equal(result.data.config.channels[0].models[0].script,'');assert.equal(result.data.config.size,'1152x1536');
  const portable=safety.createPortableAppConfig(cfg.config,cfg.webdav,[],cfg.promptSources.schedule);
  assert.equal(settings.prepareLegacySettings(b,'source',portable).data.config.size,'1152x1536');
});
test('渠道同ID不同端点迁入独立渠道；模型引用同步；已有凭据保留',()=>{
  const current=configDoc(),old=configDoc();current.config.channels[0].apiKey='synthetic-target';current.config.apiKey='synthetic-root';current.config.size='custom';
  old.config.channels[0].baseUrl='https://old.invalid';old.config.size='1152x1536';
  const keep=settings.mergeLegacySettings(current,old,'source',false);assert.equal(keep.data.config.size,'custom');assert.equal(keep.data.config.channels[0].apiKey,'synthetic-target');assert.equal(keep.data.config.apiKey,'synthetic-root');assert.equal(keep.addedChannels,1);
  const chosen=settings.mergeLegacySettings(current,old,'source',true);assert.equal(chosen.data.config.size,'1152x1536');assert.equal(chosen.data.config.imageModel,'source_default::image');assert.equal(chosen.data.config.channels[1].apiKey,'');assert.ok(chosen.conflicts.length);
  assert.equal(settings.mergeLegacySettings(chosen.data,old,'source',false).addedChannels,0);
});
test('WebDAV换账号不挪用目标密码，来源冲突按明确策略处理',()=>{
  const current=configDoc(),old=configDoc();current.webdav={...webdav,url:'https://target.invalid',username:'a',password:'synthetic'};old.webdav={...webdav,url:'https://old.invalid',username:'b'};
  current.promptSources.sources=[{id:'custom',name:'本地源',url:'https://target.invalid',homepage:'',enabled:true,builtIn:false}];old.promptSources.sources=[{...current.promptSources.sources[0],name:'旧来源'}];
  const keep=settings.mergeLegacySettings(current,old,'source',false);assert.equal(keep.data.webdav.password,'synthetic');assert.equal(keep.data.promptSources.sources[0].name,'本地源');
  const replace=settings.mergeLegacySettings(current,old,'source',true);assert.equal(replace.data.webdav.password,'');assert.equal(replace.data.promptSources.sources[0].name,'旧来源');
});
test('旧受保护端点明确提示重新配置；空地址刷新归一后重导不重复渠道',()=>{
  const b=backup(),cfg=configDoc();cfg.config.channels[0].baseUrl='/local-secure-api/old-channel';
  b.localStorage['infinite-canvas:ai_config_store']=JSON.stringify({state:{config:cfg.config,webdav:cfg.webdav}});
  const prepared=settings.prepareLegacySettings(b,'source');
  assert.equal(prepared.data.config.channels[0].baseUrl,'');assert.ok(prepared.warnings.some(w=>w.includes('1 个渠道的原接口地址')));
  const current=configDoc();current.config.channels=[];
  const first=settings.mergeLegacySettings(current,prepared.data,'source',false);assert.equal(first.addedChannels,1);
  const reloaded=structuredClone(first.data);reloaded.config.channels[0].baseUrl='https://api.openai.com';
  const again=settings.mergeLegacySettings(reloaded,prepared.data,'source',false);
  assert.equal(again.addedChannels,0);assert.equal(again.data.config.channels.length,1);
  assert.equal(again.channelIds.get('default'),'default');
});

test('待确认批次只重试保存，不重复新增；全部ACK后才解挂载门禁',async()=>{
  let state={...empty},config=configDoc(),sources={...config.promptSources,excelSources:{}},fail=true;let writes=0,roots=0;const gates=new Set();
  const store=(read,write)=>({getState:read,setState:write});
  const canvasStore=store(()=>state,next=>{state={...state,...next};roots++;});
  const api=await load('扩展功能/整批迁移/整批迁移操作.ts',{
    '@/stores/canvas/use-canvas-store':{useCanvasStore:canvasStore},'@/stores/use-config-store':{useConfigStore:store(()=>config,next=>{config={...config,...next};})},
    '@/stores/use-prompt-source-store':{usePromptSourceStore:store(()=>sources,next=>{sources={...sources,...next};})},
    '@/services/file-storage':{setMediaBlob:async()=>{writes++;}},'@/services/image-storage':{setImageBlob:async()=>{writes++;}},
    '../本机存储/上游浏览器存储桥':{flushSQLiteStorage:async()=>{if(fail)throw Error('synthetic');},retrySQLiteStorage:async()=>{},sqlitePreferences:{getItem:()=>null,setItem:()=>{}}},
    '../产品/产品恢复挂载门禁':{productRestoreMountGate:{block:id=>gates.add(id),release:id=>gates.delete(id)}},
    './旧版备份读取':reader,'./旧版产品转换':products,'./旧版配置转换':settings,'./旧版故障切换转换':fallback,'../故障切换/浏览器状态':{},
  });
  const p=await products.prepareLegacyProducts(backup()),plan={products:p,settings:{data:null,excelSources:{}},name:'fixture'};
  await assert.rejects(api.commitLegacyTransfer(plan,false,async()=>{},()=>{}),/保存尚未确认/);
  assert.equal(state.projects.length,4);assert.equal(roots,1);assert.equal(gates.size,4);assert.equal(writes,4);
  await assert.rejects(api.commitLegacyTransfer(plan,false,async()=>{},()=>{}),/上次整批迁移/);
  fail=false;const done=await api.finishLegacyTransfer();assert.equal(done.added,4);assert.equal(roots,1);assert.equal(writes,4);assert.equal(gates.size,0);
});
test('Fallback四类能力与模型排序校验，渠道改名后引用同步，保留目标开关',()=>{
  const b=backup(); b.localStorage['infinite-canvas:channel-fallback-v2']=JSON.stringify({capabilities:{image:{enabled:true,modelOrder:['image'],entries:[{profileId:'default',modelName:'image',enabled:true}]}}});
  const old=fallback.prepareLegacyFallback(b);assert.equal(old.capabilities.image.entries.length,1);
  const cfg=structuredClone(defaults);cfg.channels[0].id='source_default';
  const result=fallback.mergeLegacyFallback(fallbackPolicy.emptyFallback(),old,new Map([['default','source_default']]),cfg,true);
  assert.equal(result.capabilities.image.entries[0].profileId,'source_default');assert.equal(result.enabled,true);assert.deepEqual(result.capabilities.image.modelOrder,['image']);
  const keep=fallback.mergeLegacyFallback(fallbackPolicy.emptyFallback(),old,new Map([['default','source_default']]),cfg,false);assert.equal(keep.enabled,false);
  for (const value of [result,keep]) {
    assert.equal(validateFallback(value),value);
    for (const group of Object.values(value.capabilities)) for (const entry of group.entries) {
      assert.deepEqual(Object.keys(entry).sort(),['enabled','modelName','profileId']);
    }
  }
  b.localStorage['infinite-canvas:channel-fallback-v2']='{"capabilities":{"image":{"enabled":true,"entries":[{}]}}}';assert.throws(()=>fallback.prepareLegacyFallback(b));
});
if (process.env.GUAN_LEGACY_BACKUP_FILE) test('真实旧浏览器整批备份只读解析，不访问凭据或写入数据库',async()=>{
  const b=reader.readLegacyBackup(JSON.parse(readFileSync(process.env.GUAN_LEGACY_BACKUP_FILE,'utf8')));
  const p=await products.prepareLegacyProducts(b);
  const s=settings.prepareLegacySettings(b,p.sourceId);
  const f=fallback.prepareLegacyFallback(b);
  const mergedSettings=settings.mergeLegacySettings(configDoc(),s.data,p.sourceId,false);
  for (const preferLegacy of [false,true]) {
    const merged=fallback.mergeLegacyFallback(fallbackPolicy.emptyFallback(),f,mergedSettings.channelIds,mergedSettings.data.config,preferLegacy);
    if (merged) validateFallback(merged);
  }
  const codec=createValueCodec({client:{},secretPort:{store:async()=> 'secret:dryrun',read:async()=>''},readBlobUrl:async()=>{throw Error('不得读取旧页面临时地址');}});
  const encoded=await codec.encode({state:p.snapshot,version:0});
  const plan=await buildFragmentPlan([['infinite-canvas:canvas_store',encoded]]);
  assert.ok(plan.fragments.size>0);console.log(JSON.stringify({storagePreflight:{fragments:plan.fragments.size,logicalBytes:plan.logicalBytes},readOnly:true}));
  console.log(JSON.stringify({realBackup:{products:p.snapshot.projects.length,recycled:p.snapshot.deletedProjects.length,workbooks:p.snapshot.guanWorkbooks?.contract.productSets.length,media:p.media.length,channels:s.data?.config.channels.length,hasFallback:!!f},readOnly:true}));
});
