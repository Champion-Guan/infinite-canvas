import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异, ts } from './检查首批功能适配.mjs';
import { 读取产品隔离记录 } from './接入产品核心隔离副本.mjs';

export const 产品竞态前置记录 = join(根目录, '.运行/产品核心迁入-TkJCTN/产品接入记录.json');
export function 构建产品入口竞态候选() {
  const integration = 读取产品隔离记录(产品竞态前置记录), path = 'web/src/guan/画布入口.tsx';
  const before = readFileSync(join(integration.副本, path), 'utf8');
  const after = 精确替换(before, [
    ['  const { createProduct } = useProductNavigation();', '  const { createProduct, busy } = useProductNavigation();'],
    ['  if (id) return <Navigate', '  // 创建事务完成前不能因新产品已入内存而抢先挂载画布；持久化成功后由统一出口导航。\n  if (id && !busy) return <Navigate'],
  ]);
  return { integration, delta: new Map([[path, { 原文: before, 产物: after }]]) };
}
export function 预审产品入口竞态类型(preview) {
  const web = join(preview.integration.副本, 'web');
  const config = ts.readConfigFile(join(web, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) throw Error('无法读取产品类型配置');
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, web);
  const host = ts.createCompilerHost(parsed.options), originalRead = host.readFile.bind(host);
  const overrides = new Map([...preview.delta].map(([path, item]) => [resolve(preview.integration.副本, path), item.产物]));
  host.readFile = path => overrides.get(resolve(path)) ?? originalRead(path);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true, incremental: false }, host);
  const errors = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (errors.length) throw Error(ts.formatDiagnosticsWithColorAndContext(errors, { getCurrentDirectory: () => web, getCanonicalFileName: path => path, getNewLine: () => '\n' }));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || process.argv[2] !== '--生成一文件审查') throw Error('仅生成审查，不接入或启动');
  const preview = 构建产品入口竞态候选(); 预审产品入口竞态类型(preview);
  const patch = 生成审查差异(preview.delta);
  const report = { 日期: '2026-10-18', 状态: '待单独批准，未接入', 上游提交: 基线.提交,
    前置记录: 产品竞态前置记录, 前置差异SHA256: preview.integration.差异SHA256, 差异SHA256: 哈希(patch),
    文件: [...preview.delta].map(([path, item]) => ({ 文件: path, 原始SHA256: 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    完整虚拟候选类型检查通过: true, 已应用运行副本: false, 已重启3100: false,
    范围: '仅在创建事务busy期间暂缓首页自动跳转；统一创建出口确认保存后才导航。不放宽SQLite保存门禁。' };
  writeFileSync(join(根目录, '上游适配/待审查/产品入口创建竞态.patch'), patch, { flag: 'wx' });
  writeFileSync(join(根目录, '上游适配/待审查/产品入口创建竞态.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report, null, 2));
}
