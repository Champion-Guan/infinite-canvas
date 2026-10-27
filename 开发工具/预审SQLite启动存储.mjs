import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异, 预审类型 } from './检查首批功能适配.mjs';
import { 节点存储批准产物 } from './接入SQLite节点存储隔离副本.mjs';
import { 节点存储差异SHA256 } from '../上游适配/SQLite节点存储批准.mjs';

export const 路由临时状态来源 = '扩展功能/本机存储/路由临时状态.ts';
export const 路由临时状态产物 = 'web/src/guan/路由临时状态.ts';
export function 启动主题候选(text) {
  return 精确替换(text, [[
    '                var s = JSON.parse(localStorage.getItem("infinite-canvas:theme_store") || "{}");\n                var t = s.state && s.state.theme === "light" ? "light" : "dark";',
    '                // 首屏只跟随系统；正式主题由SQLite预读后恢复，不读取旧浏览器数据。\n                var t = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";',
  ]]);
}
export function 路由窗口候选(text) {
  return 精确替换(text, [
    ['import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";', 'import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";\nimport { createRouterWindow } from "@/guan/路由临时状态";'],
    ['\n]);\n', '\n], { window: createRouterWindow(window) });\n'],
  ]);
}
export function 生成SQLite启动候选() {
  检查运行副本();
  const { combined } = 节点存储批准产物();
  const delta = new Map();
  for (const [path, transform] of [['web/index.html', 启动主题候选], ['web/src/router.tsx', 路由窗口候选]]) {
    if (combined.has(path)) throw Error('启动适配前态已改变，必须重新审查');
    const before = readFileSync(join(运行目录, path), 'utf8');
    delta.set(path, { 原文: before, 产物: transform(before) });
  }
  delta.set(路由临时状态产物, { 原文: null, 产物: readFileSync(join(根目录, 路由临时状态来源), 'utf8') });
  return { delta, combined: new Map([...combined, ...delta]) };
}

export function 预审SQLite启动存储({ 生成差异 = false } = {}) {
  const { delta, combined } = 生成SQLite启动候选();
  // HTML不交给TS编译器；两份TS/TSX候选与全部获批后继只在内存中组合。
  预审类型(new Map([...combined].filter(([path]) => /\.(ts|tsx)$/.test(path))));
  const patch = 生成审查差异(delta);
  const manifest = {
    状态: '待具体3文件差异批准，未应用任何运行副本', 日期: '2026-10-17', 上游提交: 基线.提交,
    前置节点存储差异SHA256: 节点存储差异SHA256, 差异SHA256: 哈希(patch), 完整类型预审通过: true,
    原因: '实际启动堆栈确认index.html读取localStorage主题，React Router读取sessionStorage切换缓存。',
    保持约束: ['主题偏好仍由SQLite恢复，首屏仅临时跟随系统', '路由记录仅本页内存，业务数据不回退浏览器', '通过React Router官方window参数接入，不修改全局Storage或依赖包', '未接管或重启3100，未迁旧数据、访问真实凭据或发布'],
    文件: [...delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
  };
  if (生成差异) for (const [name, content] of [['SQLite启动存储隔离.patch', patch], ['SQLite启动存储隔离.json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const path = join(根目录, '上游适配/待审查', name);
    if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('不覆盖历史启动存储审查');
    if (!existsSync(path)) writeFileSync(path, content);
  }
  检查运行副本();
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('只预审，不提供应用功能');
  console.log(JSON.stringify(预审SQLite启动存储({ 生成差异: process.argv.includes('--生成审查差异') }), null, 2));
}
