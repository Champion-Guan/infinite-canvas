import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希, 检查运行副本 } from './检查运行副本.mjs';
import { 生成审查差异 } from './检查首批功能适配.mjs';
import { 读取Excel来源 } from './预审Excel迁入.mjs';
import { 读取SQLite会话恢复隔离记录, 核验SQLite会话恢复完整包 } from './接入SQLite会话恢复隔离副本.mjs';

export const Excel行高前置记录 = join(根目录, '.运行/SQLite会话恢复-gAYlzm/SQLite会话恢复接入记录.json');
export const Excel行高自有来源 = '扩展功能/Excel/Excel弹窗行高边界.css';
export const Excel行高目标 = 'web/src/guan/旧版Excel样式.css';

// 只在内存追加自有弹窗的宿主边界；不覆写任何历史源文件、生成器或工作台包。
export function 构建Excel行高候选() {
  const integration = 读取SQLite会话恢复隔离记录(Excel行高前置记录);
  读取Excel来源();
  const file = join(根目录, Excel行高自有来源), stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('行高来源必须为独立普通文件');
  const boundary = readFileSync(file, 'utf8');
  if (!/^\/\*[^]*?\*\/\n\.guan-excel-scope \.guan-dc-excel-import-modal \{\n {2}line-height: 1\.5;\n {2}-webkit-font-smoothing: antialiased;\n\}\n$/.test(boundary)) throw Error('候选必须只有Excel自有作用域的行高和字体平滑声明');
  const 原文 = readFileSync(join(integration.副本, Excel行高目标), 'utf8');
  if (原文.includes(boundary)) throw Error('不能重复追加候选');
  return { integration, boundary, delta: new Map([[Excel行高目标, { 原文, 产物: 原文 + '\n' + boundary }]]) };
}
export function 预审Excel行高(generate = false) {
  检查运行副本();
  const preview = 构建Excel行高候选(), patch = 生成审查差异(preview.delta);
  const manifest = { 日期: '2026-10-19', 状态: '待具体一文件差异批准；仅内存预审，未接入工作台包',
    上游提交: 基线.提交, 前置记录: Excel行高前置记录, 前置差异SHA256: preview.integration.差异SHA256,
    差异SHA256: 哈希(patch), 文件数: 1,
    自有来源: Excel行高自有来源, 来源SHA256: 哈希(preview.boundary),
    生成器: '开发工具/预审Excel弹窗行高.mjs', 生成器SHA256: 哈希(readFileSync(new URL(import.meta.url))),
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    已接入隔离副本: false, 已接入3100: false,
    根因: 'Ant Design unlayered html line-height:1.15覆盖旧版1.5继承；新宿主未继承旧html.antialiased字体平滑',
    范围: ['仅给自有Excel弹窗恢复旧版行高1.5及antialiased字体平滑；全部原CSS字节保留，不改全局reset',
      '不改HTML、React、字体、尺寸、动画、解析、工作簿归属、保存导航或SQLite协议',
      '批准后新保护器、原态事务和全新完整前置组合包接入；旧批准对象及作者仓库保持不变',
      '不授权3100启停/切换、真实数据/Keychain、提交推送或发布'],
  };
  if (generate) {
    const files = [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']].map(([ext, value]) => [join(根目录, '上游适配/待审查/Excel弹窗视觉继承一文件.' + ext), value]);
    if (files.some(([file]) => existsSync(file))) throw Error('拒绝覆盖已有审查产物');
    for (const [file, value] of files) writeFileSync(file, value, { flag: 'wx', mode: 0o600 });
  }
  核验SQLite会话恢复完整包(preview.integration.组合包, true);
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('仅支持内存预审与新审查产物，不允许装配或启动');
  console.log(JSON.stringify(预审Excel行高(process.argv.includes('--生成审查差异')), null, 2));
}
