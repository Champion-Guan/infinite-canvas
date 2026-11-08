import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 读取顶栏批准, 顶栏差异SHA256 } from '../上游适配/首页顶栏批准.mjs';
import { 生成用户候选 } from './检查用户功能适配.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 哈希 } from './检查运行副本.mjs';
import { 匹配顶栏后继, 顶栏后继差异SHA256 } from '../上游适配/首页批次后继.mjs';

export function 生成首页顶栏候选() {
  const manifest = 读取顶栏批准();
  const path = 'web/src/layouts/user-layout.tsx';
  const before = 生成用户候选().get(path).产物;
  const after = 精确替换(before, [
    ['import type { ReactNode } from "react";', 'import type { ReactNode } from "react";\nimport { useLocation } from "react-router-dom";\nimport { LegacyHomeChrome } from "@/guan/旧版首页顶栏";'],
    ['export default function UserLayout({ children }: { children: ReactNode }) {', 'export default function UserLayout({ children }: { children: ReactNode }) {\n    const isHome = useLocation().pathname === "/";'],
    ['                <AppTopNav />', '                {isHome ? <LegacyHomeChrome /> : <AppTopNav />}'],
  ]);
  const files = new Map([[path, { 原文: before, 产物: after }]]);
  for (const name of ['旧版首页顶栏.tsx', '旧版顶栏.module.css']) files.set('web/src/guan/' + name, { 原文: null, 产物: readFileSync(join(根目录, '扩展功能/首页', name), 'utf8') });
  for (const item of manifest.文件) {
    const file = files.get(item.文件);
    if (!file || (file.原文 === null ? null : 哈希(file.原文)) !== item.原始SHA256 ||
      (哈希(file.产物) !== item.候选SHA256 && !匹配顶栏后继(item, 哈希(file.产物)))) throw Error('顶栏权威来源指纹不符：' + item.文件);
  }
  const diff = 哈希(生成审查差异(files));
  if (diff !== 顶栏差异SHA256 && diff !== 顶栏后继差异SHA256) throw Error('顶栏差异偏离已批准版本链');
  return files;
}
