import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,linkSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareDailyDataRoot} from '../扩展功能/本机服务/日常数据根.mjs';
function fixture(){const applicationSupport=mkdtempSync(join(realpathSync(tmpdir()),'工作台目录-')),container=join(applicationSupport,'AI-Workbench-重建版'),dataRoot=join(container,'工作区');mkdirSync(container,{mode:0o700});mkdirSync(dataRoot,{mode:0o700});return {applicationSupport,container,dataRoot};}
test('Finder普通目录元数据不阻止重开，已有工作区与元数据逐字保留',()=>{const f=fixture();writeFileSync(join(f.dataRoot,'原数据'),'keep');writeFileSync(join(f.container,'.DS_Store'),'Finder metadata');assert.equal(prepareDailyDataRoot({applicationSupport:f.applicationSupport}),f.dataRoot);assert.equal(readFileSync(join(f.container,'.DS_Store'),'utf8'),'Finder metadata');assert.equal(readFileSync(join(f.dataRoot,'原数据'),'utf8'),'keep');});
test('未知文件、同名目录、链接及超限Finder文件仍拒绝，现场不清理',()=>{for(const kind of ['unknown','directory','symbolic','hard','oversize']){const f=fixture(),file=join(f.container,'.DS_Store'),outside=join(f.applicationSupport,'外部');writeFileSync(outside,'keep');if(kind==='unknown')writeFileSync(join(f.container,'未知文件'),'keep');if(kind==='directory')mkdirSync(file);if(kind==='symbolic')symlinkSync(outside,file);if(kind==='hard')linkSync(outside,file);if(kind==='oversize')writeFileSync(file,Buffer.alloc(1024*1024+1));assert.throws(()=>prepareDailyDataRoot({applicationSupport:f.applicationSupport}),e=>e.code==='unknown_daily_root');assert.equal(readFileSync(outside,'utf8'),'keep');}});
