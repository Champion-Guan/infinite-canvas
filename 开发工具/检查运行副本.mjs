import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 上游目录, 基线, 检查, git } from './公共.mjs';
import { 读取批准清单, 批准差异SHA256 } from '../上游适配/用户已选功能批准.mjs';
import { 读取首页批准, 首页差异SHA256 } from '../上游适配/首页接入批准.mjs';
import { 检查首页批次 } from './检查首页批次.mjs';
import { 读取原样首页批准, 原样差异SHA256, 读取轮播兼容批准, 轮播兼容差异SHA256 } from '../上游适配/首页原样迁移批准.mjs';
import { 读取顶栏批准, 检查顶栏批次, 顶栏差异SHA256 } from '../上游适配/首页顶栏批准.mjs';
import { 读取双入口批准, 检查双入口批次, 双入口差异SHA256 } from '../上游适配/右上双入口批准.mjs';
import { 读取脚本来源批准, 检查脚本来源批次, 脚本来源差异SHA256 } from '../上游适配/脚本与提示词来源批准.mjs';
import { 读取全局恢复批准, 检查全局恢复批次, 全局恢复差异SHA256 } from '../上游适配/全局界面恢复批准.mjs';
import { 精简主题历史映射, 精简主题差异SHA256 } from '../上游适配/精简离线与三态主题批准.mjs';
import { 检查合并恢复批次, 合并恢复差异SHA256 } from '../上游适配/音视频提示词与节点信息恢复批准.mjs';
import { 顶栏单来源历史映射, 顶栏单来源差异SHA256 } from '../上游适配/顶栏单来源批准.mjs';
import { 检查请求转发批次, 请求转发差异SHA256 } from '../上游适配/请求转发恢复批准.mjs';

export const 哈希 = value => createHash('sha256').update(value).digest('hex');
const 适配 = JSON.parse(readFileSync(join(根目录, '上游适配/模型编辑器语义.json')));
export const 运行目录 = join(根目录, '.运行', 基线.提交);

export function 检查副本路径(副本根, 实际路径) {
  if (!实际路径.startsWith(副本根 + sep)) throw Error('运行文件指向副本之外，拒绝适配。');
}

export function 检查适配内容(原文, 副本, 声明) {
  if (哈希(原文) !== 声明.原始SHA256) throw Error('原版文件指纹与批准内容不一致。');
  const 内容 = 原文.toString('utf8');
  if (!声明.替换前 || 内容.split(声明.替换前).length !== 2) throw Error('批准内容不唯一。');
  const 新文 = Buffer.from(内容.replace(声明.替换前, 声明.替换后));
  if (哈希(新文) !== 声明.适配SHA256) throw Error('适配产物指纹不符。');
  if (副本.equals(新文)) return { 已适配: true, 新文 };
  if (!原文.equals(副本)) throw Error('目标文件存在未知改动，拒绝覆盖。');
  return { 已适配: false, 新文 };
}

export function 检查批次状态(原版数, 适配数, 总数) {
  if (原版数 + 适配数 !== 总数 || (原版数 && 适配数)) throw Error('功能适配批次不完整，拒绝启动；请使用事务快照恢复。');
  return 适配数 === 总数;
}

export function 检查运行副本({ 应用批准适配 = false } = {}) {
  检查();
  if (适配.上游提交 !== 基线.提交) throw Error('适配未针对新上游审查，停止。');
  const 副本根 = realpathSync(运行目录);
  if (副本根 === realpathSync(上游目录) || 副本根.startsWith(realpathSync(上游目录) + sep)) throw Error('运行目录指向作者仓库，拒绝适配。');
  const 文件 = git('ls-files', '-z').split('\0').filter(Boolean);
  const 批准 = 读取批准清单();
  if (批准.上游提交 !== 基线.提交) throw Error('用户功能适配未针对此上游批准。');
  const 功能文件 = new Map(批准.文件.map(item => [item.文件, item]));
  const 顶栏单来源文件 = 顶栏单来源历史映射(运行目录);
  const 精简主题文件 = 精简主题历史映射(运行目录);
  const 精简离线与三态主题已应用 = 精简主题文件.size === 21;
  const 音视频提示词与节点信息恢复已应用 = 检查合并恢复批次(运行目录);
  const 全局恢复批准 = 读取全局恢复批准();
  const 全局界面恢复已应用 = 检查全局恢复批次(运行目录, 全局恢复批准);
  const 全局恢复文件 = new Map(全局恢复批准.文件.map(item => [item.文件, item]));
  // 只接受每个版本的完整精确批次，绝不按单文件混搭。
  const 首页版本 = [读取轮播兼容批准(), 读取原样首页批准(), 读取首页批准()];
  let 首页批准;
  for (const candidate of 首页版本) {
    try { if (检查首页批次(运行目录,candidate)) { 首页批准 = candidate; break; } }
    catch { /* 下一个完整历史批次仍须逐文件核验。 */ }
  }
  if (!首页批准) {
    首页批准 = 首页版本.at(-1);
    if (检查首页批次(运行目录,首页批准)) throw Error('首页状态不一致');
  }
  const 首页轮播兼容已应用 = 首页批准 === 首页版本[0];
  const 首页原样迁移已应用 = 首页批准 !== 首页版本.at(-1);
  if (首页批准.上游提交 !== 基线.提交 || 首页批准.前置批准差异SHA256 !== 批准差异SHA256) throw Error('首页前置批准不符。');
  const 首页替换已应用 = 检查首页批次(运行目录, 首页批准);
  const 首页文件 = new Map(首页批准.文件.map(item => [item.文件, item]));
  const 顶栏批准 = 读取顶栏批准();
  if (顶栏批准.上游提交 !== 基线.提交) throw Error('顶栏未针对此上游批准');
  const 首页顶栏已应用 = 检查顶栏批次(运行目录, 顶栏批准);
  if (首页顶栏已应用 && !首页轮播兼容已应用) throw Error('首页顶栏缺少原样首页前置');
  const 顶栏文件 = new Map(顶栏批准.文件.map(item => [item.文件, item]));
  const 双入口批准 = 读取双入口批准();
  if (双入口批准.上游提交 !== 基线.提交) throw Error('双入口未针对此上游批准');
  const 右上双入口关闭已应用 = 检查双入口批次(运行目录, 双入口批准);
  if (右上双入口关闭已应用 && !首页顶栏已应用) throw Error('双入口缺少已批准的当前首页基线');
  const 双入口文件 = new Map(双入口批准.文件.map(item => [item.文件, item]));
  const 脚本来源批准 = 读取脚本来源批准();
  const 脚本与提示词来源关闭已应用 = 检查脚本来源批次(运行目录, 脚本来源批准);
  if (脚本与提示词来源关闭已应用 && !右上双入口关闭已应用) throw Error('脚本来源缺少双入口前置');
  const 脚本来源文件 = new Map(脚本来源批准.文件.map(item => [item.文件, item]));
  let 原版数 = 0;
  let 适配数 = 0;
  let 已适配 = false;
  let 待写入;
  for (const 相对 of 文件) {
    const 原文 = readFileSync(join(上游目录, 相对));
    const 目标 = join(运行目录, 相对);
    检查副本路径(副本根, realpathSync(目标));
    const 副本 = readFileSync(目标);
    // 完整21文件后继通过后，逐层校验其精确前态，而非豁免路径。
    const 副本指纹 = 精简主题文件.get(相对)?.原始SHA256 ?? 顶栏单来源文件.get(相对)?.原始SHA256 ?? 哈希(副本);
    const 项 = 功能文件.get(相对);
    if (项) {
      if (哈希(原文) !== 项.原始SHA256) throw Error(`功能适配原版指纹不符：${相对}`);
      if (副本指纹 === 哈希(原文)) 原版数++;
      else if (全局界面恢复已应用 && 全局恢复文件.has(相对)) {
        const item = 全局恢复文件.get(相对);
        const before = 顶栏文件.get(相对)?.候选SHA256 ?? 项.候选SHA256;
        if (item.原始SHA256 !== before || 副本指纹 !== item.候选SHA256) throw Error('全局恢复核心前置或产物指纹不符');
        适配数++;
      }
      else if (脚本与提示词来源关闭已应用 && 脚本来源文件.has(相对)) {
        const item = 脚本来源文件.get(相对);
        if (item.原始SHA256 !== 项.候选SHA256 || 副本指纹 !== item.候选SHA256) throw Error('脚本来源接入前置或产物指纹不符');
        适配数++;
      }
      else if (右上双入口关闭已应用 && 双入口文件.has(相对)) {
        const item = 双入口文件.get(相对);
        if (item.原始SHA256 !== 项.候选SHA256 || 副本指纹 !== item.候选SHA256) throw Error('双入口接入前置或产物指纹不符');
        适配数++;
      }
      else if (首页顶栏已应用 && 顶栏文件.has(相对)) {
        const top = 顶栏文件.get(相对);
        if (top.原始SHA256 !== 项.候选SHA256 || 副本指纹 !== top.候选SHA256) throw Error('顶栏核心接入前置或产物指纹不符');
        适配数++;
      }
      else if (副本指纹 === 项.候选SHA256) 适配数++;
      else throw Error(`运行副本存在未批准改动：${相对}`);
      continue;
    }
    if (相对 !== 适配.文件) {
      if (全局界面恢复已应用 && 全局恢复文件.has(相对)) {
        const item = 全局恢复文件.get(相对);
        if (哈希(原文) !== item.原始SHA256 || 副本指纹 !== item.候选SHA256) throw Error('全局恢复独立产物指纹不符');
        continue;
      }
      if (脚本与提示词来源关闭已应用 && 脚本来源文件.has(相对)) {
        const item = 脚本来源文件.get(相对);
        if (哈希(原文) !== item.原始SHA256 || 副本指纹 !== item.候选SHA256) throw Error('脚本来源独立产物指纹不符');
        continue;
      }
      if (哈希(原文) !== 副本指纹) throw Error(`运行副本存在未声明改动：${相对}`);
      continue;
    }
    const 结果 = 检查适配内容(原文, 副本, 适配);
    已适配 = 结果.已适配;
    if (!已适配 && 应用批准适配) 待写入 = { 目标, 新文: 结果.新文 };
  }
  for (const 项 of 批准.文件.filter(item => item.原始SHA256 === null)) {
    const 目标 = join(运行目录, 项.文件);
    if (!existsSync(目标)) { 原版数++; continue; }
    检查副本路径(副本根, realpathSync(目标));
    const 预期指纹 = 全局界面恢复已应用 && 全局恢复文件.has(项.文件) ? 全局恢复文件.get(项.文件).候选SHA256 : 首页替换已应用 && 首页文件.has(项.文件) ? 首页文件.get(项.文件).候选SHA256 : 项.候选SHA256;
    if (全局界面恢复已应用 && 全局恢复文件.has(项.文件) && 全局恢复文件.get(项.文件).原始SHA256 !== 项.候选SHA256) throw Error('全局恢复自有策略前置指纹不符');
    if ((顶栏单来源文件.get(项.文件)?.原始SHA256 ?? 哈希(readFileSync(目标))) !== 预期指纹) throw Error(`自有模块存在未知改动：${项.文件}`);
    适配数++;
  }
  const 允许路径 = new Set([...文件, ...功能文件.keys(), ...(首页替换已应用 ? 首页文件.keys() : []), ...(首页顶栏已应用 ? 顶栏文件.keys() : []), ...(右上双入口关闭已应用 ? 双入口文件.keys() : []), ...(脚本与提示词来源关闭已应用 ? 脚本来源文件.keys() : [])]);
  if (精简离线与三态主题已应用) for (const path of 精简主题文件.keys()) 允许路径.add(path);
  const 检查新增源码 = 相对 => {
    const 路径 = join(运行目录, 相对);
    检查副本路径(副本根, realpathSync(路径));
    for (const entry of readdirSync(路径, { withFileTypes: true })) {
      const child = `${相对}/${entry.name}`;
      if (entry.isDirectory()) 检查新增源码(child);
      else if (!允许路径.has(child)) throw Error(`未声明的新增源码：${child}`);
    }
  };
  检查新增源码('web/src');
  const 用户功能关闭已应用 = 检查批次状态(原版数, 适配数, 批准.文件.length);
  if (首页替换已应用 && !用户功能关闭已应用) throw Error('首页缺少完整功能关闭前置。');
  if (脚本与提示词来源关闭已应用 && !用户功能关闭已应用) throw Error('脚本来源缺少完整功能关闭前置');
  if (全局界面恢复已应用 && (!首页顶栏已应用 || !脚本与提示词来源关闭已应用)) throw Error('全局恢复缺少完整历史前置');
  if (精简离线与三态主题已应用 && !全局界面恢复已应用) throw Error('精简主题缺少完整全局恢复前置');
  检查();
  // 全部源文件和目标文件验证通过后才写入唯一批准文件。
  if (待写入) { writeFileSync(待写入.目标, 待写入.新文); 已适配 = true; }
  const result = { 上游提交: 基线.提交, 检查文件数: 文件.length, 批准适配已应用: 已适配, 用户功能关闭已应用, 功能差异SHA256: 批准差异SHA256, 首页替换已应用, 首页原样迁移已应用, 首页轮播兼容已应用, 首页顶栏已应用, 顶栏差异SHA256: 首页顶栏已应用 ? 顶栏差异SHA256 : null, 首页差异SHA256: 首页轮播兼容已应用 ? 轮播兼容差异SHA256 : 首页原样迁移已应用 ? 原样差异SHA256 : 首页差异SHA256, 右上双入口关闭已应用, 双入口差异SHA256: 右上双入口关闭已应用 ? 双入口差异SHA256 : null };
  Object.assign(result, { 脚本与提示词来源关闭已应用, 脚本来源差异SHA256: 脚本与提示词来源关闭已应用 ? 脚本来源差异SHA256 : null });
  Object.assign(result, { 全局界面恢复已应用, 全局恢复差异SHA256: 全局界面恢复已应用 ? 全局恢复差异SHA256 : null, 当前恢复编号: 全局界面恢复已应用 ? 全局恢复批准.恢复编号 : [] });
  Object.assign(result, { 精简离线与三态主题已应用, 精简主题差异SHA256: 精简离线与三态主题已应用 ? 精简主题差异SHA256 : null });
  Object.assign(result, { 音视频提示词与节点信息恢复已应用, 合并恢复差异SHA256: 音视频提示词与节点信息恢复已应用 ? 合并恢复差异SHA256 : null });
  Object.assign(result, { 顶栏单来源已应用: 顶栏单来源文件.size === 10, 顶栏单来源差异SHA256: 顶栏单来源文件.size === 10 ? 顶栏单来源差异SHA256 : null });
  const 请求转发已恢复 = 检查请求转发批次(运行目录);
  Object.assign(result, { 请求转发已恢复, 请求转发差异SHA256: 请求转发已恢复 ? 请求转发差异SHA256 : null });
  console.log(JSON.stringify(result));
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  检查运行副本({ 应用批准适配: process.argv.includes('--应用批准适配') });
}
