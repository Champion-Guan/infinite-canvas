// 仅提供旧前端文件：不导入旧后端，不接私人目录、Keychain或代理。
// 用户明确要求以3000复用原浏览器Origin；是否打开原资料及编辑数据由用户操作。
import { createServer } from 'node:http';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { 根目录, 基线 } from './公共.mjs';

const old = '/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench';
const args = process.argv.slice(2);
if (args.length && !(args.length === 1 && args[0] === '--port=3000')) throw Error('仅允许默认3197或用户授权的--port=3000，不自动换端口。');
const port = args.length ? 3000 : 3197;
const ts = createRequire(resolve(根目录, '.运行', 基线.提交, 'web/package.json'))('typescript');
const source = ts.createSourceFile('server.mjs', readFileSync(resolve(old, 'src/server/index.mjs'), 'utf8'), ts.ScriptTarget.Latest, true);
const names = new Set(['workbenchLogoStyle', 'mvpNavigationStyle', 'localThemeAndUiStyle', 'localDocumentTitleScript', 'localRootNavigationScript', 'canvasSettingsEntryBridgeScript', 'localThemeToggleScript', 'localFixedFieldsScript', 'localResolutionButtonsScript', 'localAspectRatioButtonsScript', 'localOfflineGuardsScript', 'localGenerationButtonScript', 'localResponsivePreviewScript', 'localProxySetupScript']);
const parts = [];
for (const statement of source.statements) if (ts.isVariableStatement(statement)) {
  for (const item of statement.declarationList.declarations) if (names.has(item.name.getText(source))) {
    if (!item.initializer || !ts.isNoSubstitutionTemplateLiteral(item.initializer)) throw Error('参照模板含动态依赖，停止。');
    parts.push(item.initializer.text);
    names.delete(item.name.getText(source));
  }
}
if (names.size) throw Error('旧模板缺失：' + [...names]);
// 必须与旧首页一致，先提供Excel/压缩依赖，再读取已有数据；缺fflate会误报压缩数据损坏。
const injection = parts.join('\n') + '<script src="/_pixpix-assets/local-vendor/xlsx.full.min.js"></script><script src="/_pixpix-assets/local-vendor/fflate.umd.js"></script><script type="module" src="/data-contract/index.js"></script><link rel="stylesheet" href="/_pixpix-assets/local-canvas/canvas.css"><script src="/_pixpix-assets/local-canvas/canvas.js"></script>';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.woff2': 'font/woff2', '.json': 'application/json', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm' };
const server = createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end(); return; }
  if (['/api', '/local-app', '/local-proxy', '/local-image-api'].some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'))) { res.writeHead(503, {'content-type':'application/json', 'cache-control':'no-store'}); res.end('{"ok":false,"error":"仅前端对比，后台服务保持关闭"}'); return; }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return; }
  let root = resolve(old, 'public');
  let relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (pathname.startsWith('/_pixpix-assets/')) { root = resolve(old, 'public/assets'); relative = pathname.slice('/_pixpix-assets/'.length); }
  if (pathname.startsWith('/_pixpix-media/images/')) { root = resolve(old, 'public/assets/media'); relative = pathname.slice('/_pixpix-media/images/'.length); }
  if (pathname.startsWith('/data-contract/')) { root = resolve(old, 'src/shared/data-contract'); relative = pathname.slice('/data-contract/'.length); }
  if (pathname === '/canvas') { res.writeHead(302, { location: '/' }); res.end(); return; }
  if (pathname.startsWith('/canvas/')) {
    root = resolve(old, 'public/infinite-canvas');
    relative = /^\/canvas\/(assets|icons|plugins)\//.test(pathname) || pathname === '/canvas/excel-prompts-bridge.js' ? pathname.slice('/canvas/'.length) : 'index.html';
  }
  if (/^\/(assets|icons|plugins)\//.test(pathname) || pathname === '/logo.svg') { root = resolve(old, 'public/infinite-canvas'); relative = pathname.slice(1); }
  if (pathname === '/favicon.ico') { root = resolve(old, 'public/assets/local-brand'); relative = 'favicon.png'; }
  // 离线归档保留了Next动态目录的字面编码名（%5Blocale%5D）；只为公开静态chunk兼容。
  let file = resolve(root, relative);
  if (!statSync(file, {throwIfNoEntry:false})?.isFile() && pathname.startsWith('/_pixpix-assets/_next/static/')) {
    file = resolve(root, relative.replaceAll('[', '%5B').replaceAll(']', '%5D'));
  }
  if (!file.startsWith(root + sep) || !statSync(file, {throwIfNoEntry:false})?.isFile() || !realpathSync(file).startsWith(realpathSync(root) + sep)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control':'no-store', 'x-workbench-mode':'frontend-comparison', 'content-security-policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; frame-src 'self'; form-action 'none'; object-src 'none'; base-uri 'self';"});
  if (req.method === 'HEAD') { res.end(); return; }
  let bytes = readFileSync(file);
  if (relative === 'index.html' && root === resolve(old,'public')) bytes = bytes.toString().replace(/<script id="root-locale-redirect">[\s\S]*?<\/script>/, '').replace('</head>', injection + '</head>');
  res.end(bytes);
});
server.listen(port, '127.0.0.1', () => console.log(`旧版前端对比：http://localhost:${port}；不启动旧后台，保留浏览器原数据。`));
