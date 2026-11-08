// 独立类型检查，摘自 开发工具/预审迁移扩大整批.mjs SHA256 82c2e8f1179e0d0f31439e6e8bdc4ca302ca8b377ac54a56785d854d8d22baa6；候选在内存提供，完整类型不跳过。
import { join, resolve, sep } from 'node:path';
import { ts } from './检查首批功能适配.mjs';
import { 创建类型依赖只读镜像 } from './模型价格类型依赖只读镜像.mjs';
export function 检查扩大整批类型(preview) {
  const root = preview.integration.副本, web = join(root, 'web');
  const dependencies = 创建类型依赖只读镜像(ts.sys.readFile, join(web, 'node_modules/.pnpm/lock.yaml'));
  const overrides = new Map([...preview.delta].filter(([path]) => path.startsWith('画布副本/web/')).map(([path, item]) => [resolve(preview.integration.组合包, path), item.产物]));
  const read = path => overrides.get(resolve(path)) ?? dependencies.read(path);
  const config = ts.readConfigFile(join(web, 'tsconfig.json'), read);
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web), host = ts.createCompilerHost(parsed.options);
  host.readFile = read;
  host.fileExists = path => overrides.has(resolve(path)) || ts.sys.fileExists(path);
  host.directoryExists = path => [...overrides.keys()].some(file => file.startsWith(resolve(path) + sep)) || ts.sys.directoryExists(path);
  host.getCurrentDirectory = () => web;
  host.getSourceFile = (path, version) => { const content = read(path); return content === undefined ? undefined : ts.createSourceFile(path, content, version); };
  const codeOverrides = [...overrides.keys()].filter(path => /\.(?:tsx?|mjs|js)$/.test(path));
  const program = ts.createProgram([...new Set([...parsed.fileNames, ...codeOverrides].map(path => resolve(path)))], { ...parsed.options, incremental: false, noEmit: true }, host);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => web, getCanonicalFileName: path => path, getNewLine: () => '\n' }));
  return dependencies.report();
}
