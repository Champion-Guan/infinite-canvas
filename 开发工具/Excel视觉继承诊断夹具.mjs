// 只提供合成弹窗的样式诊断页，不装配工作台、不连接数据库或外网。
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, sep, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline';
import vm from 'node:vm';
import { 根目录 } from './公共.mjs';
import { 读取Excel来源, Excel旧目录 } from './预审Excel迁入.mjs';
import { 读取SQLite会话恢复隔离记录 } from './接入SQLite会话恢复隔离副本.mjs';
import { 构建Excel行高候选 } from './预审Excel弹窗行高.mjs';

const integration = 读取SQLite会话恢复隔离记录(join(根目录, '.运行/SQLite会话恢复-gAYlzm/SQLite会话恢复接入记录.json'));
const sources = 读取Excel来源();
const web = join(integration.副本, 'web'), require = createRequire(join(web, 'package.json'));
const { excelImportMarkup } = await import(pathToFileURL(join(web, 'src/guan/旧版Excel弹窗.js')).href);
const { parsePromptWorkbook } = await import(pathToFileURL(join(web, 'src/guan/旧版Excel解析.js')).href);
const vendor = vm.createContext({});
vm.runInContext(sources.get('public/assets/local-vendor/xlsx.full.min.js'), vendor);
const XLSX = vendor.XLSX;
const workbook = XLSX.read(readFileSync(join(根目录, '.运行/output/playwright/Excel导入与工作簿-20261019/合成夹具/A.xlsx')), { type: 'buffer' });
const parsed = parsePromptWorkbook(XLSX, workbook);
const pending = { fileName: 'A.xlsx', sheetName: parsed.sheetName, promptTemplates: parsed.promptTemplates, selectedPromptIndexes: parsed.promptTemplates.map((_, index) => index) };
const { build } = await import(pathToFileURL(require.resolve('vite')).href);
const entry = join(web, 'excel-visual-diagnostic.js');
const result = await build({ root: web, configFile: false, logLevel: 'warn',
  css: { postcss: { plugins: [require('@tailwindcss/postcss')({ base: join(web, 'src') })] } },
  plugins: [{ name: 'explicit-css-only-diagnostic', resolveId(id) { if (id === entry) return id; },
    load(id) { if (id === entry) return 'import "antd/dist/reset.css"; import "streamdown/styles.css"; import "./src/styles/globals.css"; import "./src/guan/旧版Excel样式.css";'; } }],
  build: { write: false, lib: { entry, formats: ['es'], name: 'ExcelVisualDiagnostic' } } });
const outputs = (Array.isArray(result) ? result[0] : result).output;
const newCSS = outputs.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => item.source).join('\n');
if (!newCSS.includes('guan-dc-excel-import-card')) throw Error('未生成真实新宿主CSS');
const candidateCSS = newCSS + '\n' + 构建Excel行高候选().boundary;
const oldHTML = readFileSync(join(Excel旧目录, 'public/index.html'), 'utf8');
const links = [...oldHTML.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(match => match[0]).join('\n');
const htmlClass = oldHTML.match(/<html[^>]*class="([^"]*)"/)[1];
const ts = require('typescript'), source = ts.createSourceFile('server.mjs', readFileSync(join(Excel旧目录, 'src/server/index.mjs'), 'utf8'), ts.ScriptTarget.Latest, true);
const names = new Set(['workbenchLogoStyle', 'mvpNavigationStyle', 'localThemeAndUiStyle', 'localDocumentTitleScript', 'localRootNavigationScript', 'canvasSettingsEntryBridgeScript', 'localThemeToggleScript', 'localFixedFieldsScript', 'localResolutionButtonsScript', 'localAspectRatioButtonsScript', 'localOfflineGuardsScript', 'localGenerationButtonScript', 'localResponsivePreviewScript', 'localProxySetupScript']);
const inlineStyles = [];
for (const statement of source.statements) if (ts.isVariableStatement(statement)) for (const item of statement.declarationList.declarations) if (names.has(item.name.getText(source))) {
  if (!item.initializer || !ts.isNoSubstitutionTemplateLiteral(item.initializer)) throw Error('旧模板包含动态依赖');
  inlineStyles.push(...item.initializer.text.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g));
  names.delete(item.name.getText(source));
}
if (names.size) throw Error('旧模板不完整');
const oldStyles = inlineStyles.map(match => match[0]).join('\n') + '<style>' + readFileSync(join(Excel旧目录, 'src/shared/data-contract/index.css'), 'utf8') + '</style>';
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  const assets = resolve(Excel旧目录, 'public/assets');
  if (url.pathname.startsWith('/_pixpix-assets/')) {
    const file = resolve(assets, decodeURIComponent(url.pathname.slice('/_pixpix-assets/'.length)));
    if (!file.startsWith(assets + sep) || !statSync(file, { throwIfNoEntry: false })?.isFile() || !realpathSync(file).startsWith(realpathSync(assets) + sep)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': extname(file) === '.css' ? 'text/css' : 'application/octet-stream' }); res.end(readFileSync(file)); return;
  }
  const match = /^\/(old|new|candidate)\/(light|dark)$/.exec(url.pathname);
  if (!match) { res.writeHead(404); res.end(); return; }
  const [, mode, theme] = match, old = mode === 'old';
  const state = url.searchParams.get('state');
  const value = state === 'error' ? { fileName: 'A.xlsx', error: '合成校验错误，不包含客户数据。' } : state === 'busy' ? { fileName: 'A.xlsx', busy: true, progress: 45 } : pending;
  const markup = '<div class="guan-dc-excel-import-modal" role="dialog" aria-modal="true">' + excelImportMarkup(value) + '</div>';
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; font-src 'self'; object-src 'none'" });
  res.end('<!doctype html><html lang="zh-CN" class="' + (old ? htmlClass : '') + (theme === 'dark' ? ' dark' : '') + '" data-workbench-theme="' + theme + '"><head><meta charset="utf-8"><title>Excel样式独立诊断</title>'
    + (old ? links + oldStyles : '<style>' + (mode === 'candidate' ? candidateCSS : newCSS) + '</style>') + '</head><body>'
    + (old ? markup : '<div class="guan-excel-scope" data-theme="' + theme + '">' + markup + '</div>') + '</body></html>');
});
server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
console.log('EXCEL_VISUAL_DIAGNOSTIC http://localhost:' + server.address().port);
const input = createInterface({ input: process.stdin });
for await (const line of input) if (line === 'exit') break;
input.close(); process.stdin.pause(); await new Promise(resolve => server.close(resolve));
