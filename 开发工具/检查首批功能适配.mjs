import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { 根目录, 上游目录, 基线, 检查 } from './公共.mjs';
import { 检查运行副本, 运行目录 } from './检查运行副本.mjs';
import { 状态, 上游提交, 自有模块, 接入差异 } from '../上游适配/首批功能开关.mjs';

const 哈希 = value => createHash('sha256').update(value).digest('hex');
export const ts = createRequire(join(运行目录, 'web/package.json'))('typescript');

export function 精确替换(原文, 替换) {
  let 产物 = 原文;
  for (const [前, 后] of 替换) {
    if (!前 || 产物.split(前).length !== 2) throw Error('适配锚点缺失或不唯一，停止预审。');
    产物 = 产物.replace(前, 后);
  }
  return 产物;
}

export function 生成候选() {
  检查();
  if (状态 !== '待单独批准' || 上游提交 !== 基线.提交) throw Error('预审声明状态或上游版本不符。');
  const 文件 = new Map();
  for (const 项 of 接入差异) {
    if (!/^web\/src\/(?:[\w-]+\/)*[\w-]+\.(?:ts|tsx)$/.test(项.文件) || 文件.has(项.文件)) throw Error('适配文件路径非法或重复。');
    const 原文 = readFileSync(join(上游目录, 项.文件), 'utf8');
    文件.set(项.文件, { 原文, 产物: 精确替换(原文, 项.替换) });
  }
  文件.set(自有模块.产物, { 原文: null, 产物: readFileSync(join(根目录, 自有模块.来源), 'utf8') });
  return 文件;
}

// 使用虚拟编译器文件读取器。候选代码只存在内存，不写进正在运行的 3100 副本。
export function 预审类型(文件) {
  const web = join(运行目录, 'web');
  const 覆盖 = new Map([...文件].map(([路径, 项]) => [resolve(运行目录, 路径), 项.产物]));
  const 配置 = ts.readConfigFile(join(web, 'tsconfig.json'), ts.sys.readFile);
  if (配置.error) throw Error(ts.flattenDiagnosticMessageText(配置.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(配置.config, ts.sys, web);
  const host = ts.createCompilerHost(parsed.options);
  const read = path => 覆盖.get(resolve(path)) ?? ts.sys.readFile(path);
  host.readFile = read;
  host.fileExists = path => 覆盖.has(resolve(path)) || ts.sys.fileExists(path);
  host.directoryExists = path => [...覆盖.keys()].some(file => file.startsWith(resolve(path) + sep)) || ts.sys.directoryExists(path);
  host.getCurrentDirectory = () => web;
  host.getSourceFile = (path, languageVersion) => {
    const 内容 = read(path);
    return 内容 === undefined ? undefined : ts.createSourceFile(path, 内容, languageVersion);
  };
  const program = ts.createProgram([...parsed.fileNames, ...覆盖.keys()], { ...parsed.options, incremental: false, noEmit: true }, host);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  if (diagnostics.length) {
    throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => web, getCanonicalFileName: path => path, getNewLine: () => '\n' }));
  }
}

// diff 的临时文件只是生成的审查产物，不属于作者仓库或运行副本。
export function 生成审查差异(文件) {
  const 临时 = mkdtempSync(join(tmpdir(), 'guan-stage5-review-'));
  try {
    let patch = '';
    for (const [路径, 项] of 文件) {
      const before = join(临时, 'before');
      const after = join(临时, 'after');
      writeFileSync(before, 项.原文 ?? '');
      writeFileSync(after, 项.产物);
      const result = spawnSync('diff', ['-u', '--label', 项.原文 === null ? '/dev/null' : `a/${路径}`, '--label', `b/${路径}`, before, after], { encoding: 'utf8' });
      if (![0, 1].includes(result.status)) throw Error('无法生成标准差异。');
      patch += result.stdout;
    }
    return patch;
  } finally {
    rmSync(临时, { recursive: true, force: true });
  }
}

function 保存审查产物(path, 内容) {
  if (existsSync(path) && readFileSync(path, 'utf8') !== 内容) throw Error('现有审查产物与候选不符，拒绝覆盖；请重新审查。');
  if (!existsSync(path)) writeFileSync(path, 内容);
}

export function 检查首批功能适配({ 生成差异 = false } = {}) {
  检查运行副本();
  const 文件 = 生成候选();
  预审类型(文件);
  const patch = 生成审查差异(文件);
  const check = spawnSync('git', ['-C', 上游目录, 'apply', '--check', '-'], { input: patch, encoding: 'utf8' });
  if (check.status !== 0) throw Error(`标准差异预检查失败：${check.stderr}`);
  const 清单 = {
    状态,
    上游提交,
    已应用到运行副本: false,
    预审类型通过: true,
    差异SHA256: 哈希(patch),
    文件: [...文件].map(([路径, 项]) => ({ 文件: 路径, 原始SHA256: 项.原文 === null ? null : 哈希(项.原文), 候选SHA256: 哈希(项.产物) })),
  };
  if (生成差异) {
    const 目录 = join(根目录, '上游适配/待审查');
    mkdirSync(目录, { recursive: true });
    保存审查产物(join(目录, '首批功能开关.patch'), patch);
    保存审查产物(join(目录, '首批功能开关.json'), JSON.stringify(清单, null, 2) + '\n');
  }
  检查运行副本();
  console.log(JSON.stringify(清单, null, 2));
  return 清单;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.some(arg => /应用|apply|启用/.test(arg))) throw Error('本工具仅供预审，不提供应用功能；需要单独批准具体 diff。');
  检查首批功能适配({ 生成差异: process.argv.includes('--生成审查差异') });
}
