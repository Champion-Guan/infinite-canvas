import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录 } from './公共.mjs';
import { 哈希, 检查运行副本 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 预审卡片布局类型 } from './预审卡片自动避让.mjs';
import { 读取Excel隔离记录 } from './接入Excel导入与工作簿隔离副本.mjs';

export const Excel勾选前置记录 = join(根目录, '.运行/Excel导入与工作簿-GFww02/Excel导入与工作簿接入记录.json');
export function 构建Excel勾选候选() {
  const integration = 读取Excel隔离记录(Excel勾选前置记录), path = 'web/src/guan/Excel导入面板.tsx';
  const 原文 = readFileSync(join(integration.副本, path), 'utf8');
  // 内联HTML中的checkbox没有独立React fiber，不能依赖ChangeEventPlugin识别。
  // input为真实冒泡事件，使用原处理器，不重建HTML或改变原选择/保存逻辑。
  const 产物 = 精确替换(原文, [['      onChange={event => {', '      onInput={event => {']]);
  return { integration, delta: new Map([[path, { 原文, 产物 }]]) };
}
export function 预审Excel勾选事件(generate = false) {
  检查运行副本();
  const preview = 构建Excel勾选候选(); 预审卡片布局类型(preview);
  const patch = 生成审查差异(preview.delta);
  const manifest = { 日期: '2026-10-19', 状态: '待单独批准，未接入任何工作台包',
    前置记录: Excel勾选前置记录, 前置差异SHA256: preview.integration.差异SHA256,
    上游提交: '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc', 差异SHA256: 哈希(patch), 文件数: 1,
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    完整虚拟类型检查通过: true, 已接入隔离副本: false, 已接入3100: false,
    范围: ['仅导入弹窗onChange改为onInput，保留原旧HTML、样式、勾选函数、数据合同及保存导航',
      '批准后新建完整16文件前置副本，事务接入并继续实际上传/SQLite验收；不改原批准源码或历史包'],
  };
  if (generate) for (const [ext, content] of [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']]) {
    const file = join(根目录, '上游适配/待审查/Excel勾选事件一文件修订.' + ext);
    if (existsSync(file)) throw Error('拒绝覆盖历史审查');
    writeFileSync(file, content, { flag: 'wx', mode: 0o600 });
  }
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('仅允许预审和生成差异');
  console.log(JSON.stringify(预审Excel勾选事件(process.argv.includes('--生成审查差异')), null, 2));
}
