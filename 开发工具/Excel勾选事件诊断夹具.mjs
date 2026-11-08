// 独立事件回归，不接工作台服务/SQLite。真实Panel+旧HTML，读文件/导航宿主为明确测试替身。
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 构建Excel勾选候选 } from './预审Excel勾选事件.mjs';

const preview = 构建Excel勾选候选(), web = join(preview.integration.副本, 'web');
const require = createRequire(join(web, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('vite')).href), ts = require('typescript');
const item = [...preview.delta.values()][0], bundles = new Map();
const templates = [{id:'1',order:1,route:'铝合金支架 | 尺寸展示',sourceRowNumber:3,prompts:{'Main Prompt':'Main [NAME]'}},
  {id:'2',order:2,route:'塑料支架 | 核心卖点',sourceRowNumber:4,prompts:{'Main Prompt':'Main benefit [NAME]'}}];
for (const [name, source] of [['original', item.原文], ['input', item.产物]]) {
  const entry = join(web,'event-diagnostic-entry.js'), panel=join(web,'src/guan/event-diagnostic-panel.js');
  const result = await build({root:web,configFile:false,logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},build:{write:false,minify:false,
    lib:{entry,formats:['iife'],name:'ExcelEventDiagnostic'},rollupOptions:{output:{inlineDynamicImports:true}}},
    plugins: [{ name: 'explicit-test-host', enforce:'pre',
      resolveId(id) {
        if(id===entry||id===panel)return id;
        if(id==='diagnostic-panel')return panel;
        if (/^(\.\/产品操作|\.\/Excel文件读取|@\/stores\/use-theme-store)$/.test(id))return '\0test:'+id;
        if(id.endsWith('.css'))return '\0test:empty-style';
      },
      load(id) {
        if(id===entry)return `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ExcelImportPanel} from 'diagnostic-panel';
          window.__submitted=null;createRoot(document.getElementById('root')).render(React.createElement(ExcelImportPanel,{file:new File([],'A.xlsx'),onClose:()=>{window.__closed=true;}}));`;
        if(id===panel)return ts.transpileModule("import React from 'react';\n"+source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText;
        if(!id.startsWith('\0test:'))return;
        const path=id.slice('\0test:'.length);
        let contents;
        if(path==='./产品操作') contents='export const useProductNavigation=()=>({importWorkbook:async v=>{window.__submitted=v.promptTemplates.map(t=>t.route);}});';
        else if(path==='@/stores/use-theme-store') contents='export const useThemeStore=fn=>fn({theme:"light"});';
        else if(path==='./Excel文件读取') contents=`export const readExcelFile=async()=>({fileName:'A.xlsx',sheetName:'Prompts',kind:'xlsx',fileSha256:'synthetic',promptTemplates:${JSON.stringify(templates)},selectedPromptIndexes:[0,1]});`;
        else contents='export {};';
        return contents;
      },
    }],
  });
  const output=Array.isArray(result)?result[0].output:result.output;
  bundles.set('/' + name + '.js', output.find(item=>item.type==='chunk').code);
}
const server=createServer((req,res)=>{
  if(bundles.has(req.url)){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});res.end(bundles.get(req.url));return;}
  if(!['/original','/input'].includes(req.url)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'self'; script-src 'self'; connect-src 'none'"});
  res.end(`<html><head><meta charset="utf-8"><title>Excel勾选事件隔离诊断</title></head><body><div id="root"></div><script src="${req.url}.js"></script></body></html>`);
});
server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
console.log('EXCEL_EVENT_DIAGNOSTIC http://localhost:'+server.address().port);
const input=createInterface({input:process.stdin});for await(const line of input) if(line==='exit') break;
input.close();process.stdin.pause();await new Promise(resolve=>server.close(resolve));
