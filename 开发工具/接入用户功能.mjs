import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本, 检查副本路径, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 生成用户候选 } from './检查用户功能适配.mjs';
import { 预审类型, 生成审查差异 } from './检查首批功能适配.mjs';
import { 读取批准清单, 批准差异SHA256 } from '../上游适配/用户已选功能批准.mjs';

// 只用于可重建运行副本。写入前留快照，异常时恢复；断电中止时保留日志且保护器拒绝半批状态。
export function 事务写入(根, 文件, 事务目录, { 写后检查 = () => {}, 写入前 = () => {}, 差异指纹 = 批准差异SHA256 } = {}) {
  const 实根 = realpathSync(根);
  const 快照 = [...文件].map(([路径, 项]) => {
    const 目标 = join(实根, 路径);
    检查副本路径(实根, resolve(目标));
    let parent = dirname(目标);
    while (!existsSync(parent)) parent = dirname(parent);
    if (realpathSync(parent) !== 实根) 检查副本路径(实根, realpathSync(parent));
    if (existsSync(目标)) 检查副本路径(实根, realpathSync(目标));
    const 原文 = existsSync(目标) ? readFileSync(目标) : null;
    return { 路径, 目标, 原文, 产物: Buffer.from(项.产物) };
  });
  mkdirSync(事务目录, { recursive: true, mode: 0o700 });
  const 日志 = { 上游提交: 基线.提交, 差异SHA256: 差异指纹, 状态: '准备', 文件: 快照.map(item => ({ 路径: item.路径, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 产物SHA256: 哈希(item.产物) })) };
  const 记状态 = 状态 => { 日志.状态 = 状态; writeFileSync(join(事务目录, '事务.json'), JSON.stringify(日志, null, 2) + '\n', { mode: 0o600 }); };
  for (const item of 快照) {
    for (const [区, 内容] of [['接入前', item.原文], ['接入后', item.产物]]) {
      if (内容 === null) continue;
      const target = join(事务目录, 区, item.路径);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, 内容, { mode: 0o600 });
    }
  }
  记状态('开始写入');
  const 已写 = [];
  try {
    for (const item of 快照) {
      写入前(item.路径, 已写.length);
      const 当前 = existsSync(item.目标) ? readFileSync(item.目标) : null;
      if (当前 === null ? item.原文 !== null : item.原文 === null || !当前.equals(item.原文)) throw Error('目标在预检后发生改变，拒绝覆盖。');
      mkdirSync(dirname(item.目标), { recursive: true });
      renameSync(join(事务目录, '接入后', item.路径), item.目标);
      已写.push(item);
    }
    写后检查();
    记状态('完成');
  } catch (error) {
    for (const item of 已写.reverse()) {
      if (哈希(readFileSync(item.目标)) !== 哈希(item.产物)) throw Error('回退目标出现并发改动；保留事务快照，请人工审查。', { cause: error });
      if (item.原文 === null) unlinkSync(item.目标);
      else {
        const 恢复文件 = join(事务目录, '恢复临时文件');
        writeFileSync(恢复文件, item.原文);
        renameSync(恢复文件, item.目标);
      }
    }
    记状态('已回退');
    throw error;
  }
  return 日志;
}

async function 检查端口空闲() {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(Error('3100仍有服务，先核实并停止本项目隔离服务，不能杀未知进程。')));
    server.listen(3100, 'localhost', () => server.close(resolve));
  });
}

export async function 接入用户功能() {
  const 状态 = 检查运行副本();
  if (状态.用户功能关闭已应用) { console.log('已接入同一批准差异，无需重复写入。'); return; }
  const 清单 = 读取批准清单();
  const 文件 = 生成用户候选();
  if (文件.size !== 清单.文件.length || 哈希(生成审查差异(文件)) !== 批准差异SHA256) throw Error('自有源码与批准差异不符，停止。');
  for (const 项 of 清单.文件) {
    const content = 文件.get(项.文件);
    if (!content || 哈希(content.产物) !== 项.候选SHA256) throw Error('批准产物指纹不一致。');
  }
  预审类型(文件);
  await 检查端口空闲();
  检查运行副本();
  const 事务目录 = mkdtempSync(join(根目录, '.运行/功能接入-'));
  const 结果 = 事务写入(运行目录, 文件, 事务目录, { 写后检查: () => {
    if (!检查运行副本().用户功能关闭已应用) throw Error('接入后校验失败。');
  } });
  console.log(JSON.stringify({ ...结果, 事务目录 }, null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 3 || process.argv[2] !== '--应用已批准差异') throw Error('只允许显式接入用户已批准差异。');
  await 接入用户功能();
}
