import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 哈希, 检查运行副本 } from './检查运行副本.mjs';
import { 生成审查差异 } from './检查首批功能适配.mjs';
import { 预审卡片布局类型 } from './预审卡片自动避让.mjs';
import { 读取凭据网关任务隔离记录, 核验凭据网关任务完整包 } from './接入凭据网关任务隔离副本.mjs';

export const 配置安全前置 = join(根目录, '.运行/凭据网关任务-qD9PwY/凭据网关任务接入记录.json');
export const 配置安全来源 = '扩展功能/配置文件/配置文件安全.ts';
export const 配置安全旧目录 = '/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench';
export const 配置安全旧指纹 = Object.freeze({
  'src/canvas/services/config-file.ts': 'b778666823951ebe597a0a443b3ca6b58097f43d3ad6318bdb2dcd639bdff1bf',
  'src/canvas/lib/config-portability.ts': 'c30486f832bfd5018c928a85ca66a492dd4ff440f01e102055bf212b78d64c47',
});
function source(root, path) {
  const file = join(root, path), stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(file) !== resolve(file)) throw Error('配置迁入来源必须是独立普通文件');
  return readFileSync(file, 'utf8');
}
export function 构建配置文件安全候选() {
  for (const [path, hash] of Object.entries(配置安全旧指纹)) {
    if (哈希(source(配置安全旧目录, path)) !== hash) throw Error('旧配置来源变化，请审查，不能自动更新锁定指纹');
  }
  const integration = 读取凭据网关任务隔离记录(配置安全前置);
  const path = 'web/src/guan/config/配置文件安全.ts';
  if (existsSync(join(integration.副本, path))) throw Error('配置安全新增路径已存在');
  const service = 'web/src/services/config-file.ts';
  const delta = new Map([
    [path, { 原文: null, 产物: source(根目录, 配置安全来源) }],
    [service, { 原文: source(integration.副本, service), 产物: 'export { exportAppConfig, importAppConfig } from "@/guan/config/配置文件安全";\n' }],
  ]);
  return { integration, delta };
}
export function 预审配置文件安全(generate = false) {
  检查运行副本();
  const preview = 构建配置文件安全候选();
  预审卡片布局类型(preview);
  const patch = 生成审查差异(preview.delta);
  const tools = ['开发工具/预审配置文件安全.mjs', '开发工具/配置文件安全.test.mjs', '开发工具/检查配置文件安全代码.mjs'];
  const manifest = {
    日期: '2026-10-20', 状态: '两文件候选，待具体差异批准；未隔离接入或切换3100', 上游提交: 基线.提交,
    前置记录: 配置安全前置, 前置差异SHA256: preview.integration.差异SHA256,
    文件数: preview.delta.size, 差异SHA256: 哈希(patch), 完整虚拟类型检查通过: true,
    旧来源目录: 配置安全旧目录, 旧来源指纹: 配置安全旧指纹,
    自有来源: [{ 文件: 配置安全来源, SHA256: 哈希(source(根目录, 配置安全来源)) }],
    工具来源: tools.map(文件 => ({ 文件, SHA256: 哈希(source(根目录, 文件)) })),
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    范围: ['恢复旧脱敏导出与文件名；另清除代理/来源URL的认证、查询与片段', '4MiB文件和UTF8正文双限制、已知字段结构校验、拒绝本机凭据引用',
      '只对相同渠道ID/协议/端点或相同WebDAV账号/端点保留当前凭据', '不展开未知JSON到store，不覆盖操作方法；导入期间编辑/重复导入保护',
      '成功提示等待现有SQLite保存ACK；失败保留保存队列并明确要求重试'],
    边界: ['沿用兼容页内凭据和现有加密SQLite，不宣称密钥不进页面内存', '不提供跨两份store的断电原子事务；保存失败不宣称原库未改变或自动回滚',
      '不处理任意正文/提示词中的嵌入秘密', '未做真实React界面、磁盘隔离包构建或日常接入验收', '候选基于17文件网关前置，未与代理/Fallback候选组合'],
    已改作者仓库或历史批准: false, 已访问正式数据或真实凭据: false, 已切换3100: false,
  };
  核验凭据网关任务完整包(preview.integration.组合包, true);
  检查运行副本();
  if (generate) {
    const targets = [['patch', patch], ['json', JSON.stringify(manifest, null, 2) + '\n']].map(([suffix, text]) => [join(根目录, '上游适配/待审查/配置文件安全.' + suffix), text]);
    if (targets.some(([path]) => existsSync(path))) throw Error('拒绝覆盖配置安全审查原件，请另建后继批次');
    for (const [path, text] of targets) writeFileSync(path, text, { flag: 'wx', mode: 0o600 });
  }
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('本工具只预审，不提供接入、发布或服务启停选项');
  console.log(JSON.stringify(预审配置文件安全(process.argv.includes('--生成审查差异')), null, 2));
}
