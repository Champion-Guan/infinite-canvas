import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 读取授权入口批准, 核验授权入口自有依赖, 授权入口差异SHA256 } from '../上游适配/SQLite工作台授权入口批准.mjs';

export const 启动器路径 = '扩展功能/本机服务/受限工作台启动器.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
// 只增加临时媒体读取，不改变外网/脚本/授权/Origin约束。
const before = "connect-src 'self' ${service?.url ?? ''};";
const after = "connect-src 'self' blob: ${service?.url ?? ''};";

export function 临时媒体策略候选(source) {
  return 精确替换(source, [[before, after]]);
}
export function 构建临时媒体策略候选() {
  核验授权入口自有依赖(根目录);
  const expected = 读取授权入口批准().启动器来源.find(item => item.文件 === 启动器路径)?.SHA256;
  const source = readFileSync(join(根目录, 启动器路径), 'utf8');
  if (!expected || sha(source) !== expected) throw Error('启动器偏离已批准快照，停止媒体策略预审。');
  return new Map([[启动器路径, { 原文: source, 产物: 临时媒体策略候选(source) }]]);
}
// 仅供内存HTTP头预审；没有应用、写运行副本或接管服务的入口。
export async function 加载临时媒体策略预审启动器() {
  const source = 构建临时媒体策略候选().get(启动器路径).产物.replace(/from '(\.[^']+)'/g,
    (_, path) => `from '${new URL(path, pathToFileURL(join(根目录, 启动器路径))).href}'`);
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
}
export function 预审SQLite临时媒体策略({ 生成差异 = false } = {}) {
  const delta = 构建临时媒体策略候选(), patch = 生成审查差异(delta);
  const manifest = {
    状态: '待单独批准；仅内存HTTP头预审，未修改启动器或任何工作台运行副本', 日期: '2026-10-17',
    前置授权入口差异SHA256: 授权入口差异SHA256, 差异SHA256: sha(patch),
    文件: [...delta].map(([文件, item]) => ({ 文件, 原始SHA256: sha(item.原文), 候选SHA256: sha(item.产物) })),
    原因: '实际原画布上传后，fetch(blob:)被connect-src阻止；图片不能写入SQLite。',
    保持约束: ['只有connect-src增加blob:，不开放data:、任意http/https或外网',
      '脚本策略、Host/Origin/会话/CSRF、首份备份和静态包检查不变',
      '现有媒体读取仍要求blob协议及当前工作台origin；不修改授权入口8模块',
      '不覆盖历史审批快照或放宽历史检查器；获批后才做独立后继装配',
      '不接管或重启3100，不迁旧数据、不读取真实凭据、不推送发布'],
    验证边界: 'HTTP头预审不等于浏览器执行或媒体保存通过；批准接入后必须复验真实原画布。',
  };
  if (生成差异) for (const [name, content] of [['SQLite临时媒体策略.patch', patch], ['SQLite临时媒体策略.json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const path = join(根目录, '上游适配/待审查', name);
    if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('不覆盖已有临时媒体策略审查产物。');
    if (!existsSync(path)) writeFileSync(path, content);
  }
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('只提供预审，不提供应用功能。');
  console.log(JSON.stringify(预审SQLite临时媒体策略({ 生成差异: process.argv.includes('--生成审查差异') }), null, 2));
}
