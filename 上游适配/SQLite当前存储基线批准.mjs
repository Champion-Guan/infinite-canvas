import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const 当前存储基线SHA256 = '287936a983334e61de1a201947ca4d6d89e519387281b50b5517f47af0dcd321';
const sha = value => createHash('sha256').update(value).digest('hex');
const 文件 = [
  '扩展功能/本机存储/SQLite工作区.mjs',
  '扩展功能/本机存储/应用值编码.mjs',
  '扩展功能/本机存储/应用存储适配.mjs',
  '扩展功能/本机存储/浏览器适配.mjs',
  '扩展功能/本机服务/数据服务.mjs',
  '扩展功能/本机存储/路由临时状态.ts',
  '扩展功能/本机存储/协议.mjs',
  '扩展功能/本机存储/续期数据客户端.mjs',
  '扩展功能/本机存储/本机授权客户端.mjs',
  '扩展功能/本机存储/启动工作台.mjs',
  '扩展功能/本机服务/受限工作台启动器.mjs',
  '扩展功能/本机服务/本机授权网关.mjs',
  '扩展功能/本机服务/受控会话.mjs',
  '扩展功能/本机服务/自动备份.mjs',
  '扩展功能/本机存储/工作台自动入口.mjs',
  '扩展功能/本机存储/保存恢复存储桥.ts',
  '扩展功能/本机存储/可恢复应用存储.mjs',
  '扩展功能/存储界面/保存状态条.tsx',
  '扩展功能/本机服务/写入协调.mjs',
];

export function 读取当前存储基线批准() {
  const bytes = readFileSync(new URL('./待审查/SQLite当前存储基线.json', import.meta.url));
  if (sha(bytes) !== 当前存储基线SHA256) throw Error('当前存储基线清单指纹不符');
  const manifest = JSON.parse(bytes);
  if (manifest.依据提交 !== 'b1a8dccb' || manifest.文件.length !== 文件.length ||
      manifest.文件.some((item, index) => item.文件 !== 文件[index] || !/^[a-f0-9]{64}$/.test(item.SHA256))) {
    throw Error('当前存储基线批准范围不符');
  }
  return manifest;
}

export function 当前存储基线完整匹配(root, fingerprint) {
  const manifest = 读取当前存储基线批准();
  return manifest.文件.every(item => fingerprint(root, item.文件) === item.SHA256);
}

export function 当前存储基线包含(root, path, fingerprint) {
  const manifest = 读取当前存储基线批准();
  return manifest.文件.some(item => item.文件 === path) &&
    当前存储基线完整匹配(root, fingerprint);
}
