import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { 安全目录, 安全文件 } from './日常运行包.mjs';

function present(path) { try { lstatSync(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
export function 稳定助手路径(sourceSHA256, applicationSupport = join(homedir(), 'Library/Application Support')) {
  if (!/^[0-9a-f]{64}$/.test(sourceSHA256) || resolve(applicationSupport) !== applicationSupport) throw Error('助手路径配置无效');
  const container = join(applicationSupport, 'AI-Workbench-重建版-系统助手'), directory = join(container, sourceSHA256);
  return { applicationSupport, container, directory, helperPath: join(directory, '系统钥匙串'), receiptPath: join(directory, '安装登记.json') };
}
function receiptFor(prepared) {
  const { helper } = prepared.manifest;
  return { protocol: 'guan-stable-helper.v1', platform: 'darwin', arch: 'arm64', sourceSHA256: helper.sourceSHA256, sha256: helper.sha256, size: helper.size };
}
export function 核验稳定助手(prepared, applicationSupport) {
  const paths = 稳定助手路径(prepared.manifest.helper.sourceSHA256, applicationSupport);
  安全目录(paths.applicationSupport); 安全目录(paths.container, true); 安全目录(paths.directory, true);
  if (readdirSync(paths.directory).sort().join(',') !== '安装登记.json,系统钥匙串') throw Error('助手版本目录不完整或含未知文件；未清理');
  安全文件(paths.receiptPath); const receipt = JSON.parse(readFileSync(paths.receiptPath));
  if (JSON.stringify(receipt) !== JSON.stringify(receiptFor(prepared))) throw Error('已有助手身份不同；请保留原安装包和登记，不自动覆盖');
  const actual = 安全文件(paths.helperPath, { executable: true });
  if (actual.sha256 !== receipt.sha256 || actual.size !== receipt.size) throw Error('稳定助手内容已变，拒绝执行');
  return paths;
}
// 纯安装函数供可信Node装配与临时目录测试；正式CLI不开放目录参数。
// 本轮不在正式Application Support执行。只复制已核验的二进制，从不执行助手。
export function 安装稳定助手(prepared, { approved = false, applicationSupport } = {}) {
  if (approved !== true) throw Error('安装系统助手需要明确批准');
  const paths = 稳定助手路径(prepared.manifest.helper.sourceSHA256, applicationSupport);
  安全目录(paths.applicationSupport);
  const source = 安全文件(prepared.helperPath, { executable: true });
  if (source.sha256 !== prepared.manifest.helper.sha256 || source.size !== prepared.manifest.helper.size) throw Error('待安装助手指纹变化');
  if (!present(paths.container)) mkdirSync(paths.container, { mode: 0o700 });
  安全目录(paths.container, true);
  if (present(paths.directory)) return { ...核验稳定助手(prepared, applicationSupport), reused: true };
  mkdirSync(paths.directory, { mode: 0o700 });
  // 失败保留部分安装供审查，不覆盖/删除或自动修权限。只有登记完整且指纹匹配才允许使用。
  writeFileSync(paths.helperPath, readFileSync(prepared.helperPath), { flag: 'wx', mode: 0o700 });
  writeFileSync(paths.receiptPath, JSON.stringify(receiptFor(prepared)), { flag: 'wx', mode: 0o600 });
  return { ...核验稳定助手(prepared, applicationSupport), reused: false };
}
