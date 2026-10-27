import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本, 哈希 } from './检查运行副本.mjs';
import { 精确替换, 生成审查差异 } from './检查首批功能适配.mjs';
import { 卡片布局旧目录, 卡片布局来源指纹, 预审卡片布局类型 } from './预审卡片自动避让.mjs';
import { 读取分类容量隔离记录, 核验分类容量完整包 } from './接入SQLite分类容量隔离副本.mjs';

export const 视区跟随前置记录 = join(根目录, '.运行/SQLite分类容量-YzaI8L/分类容量接入记录.json');
export const 视区跟随项目路径 = 'web/src/pages/canvas/project.tsx';
const 旧项目路径 = 'src/canvas/pages/canvas/project.tsx';

function 唯一行(source, marker) {
  const lines = source.split('\n').filter(line => line.includes(marker));
  if (lines.length !== 1) throw Error('视区跟随来源行缺失或不唯一');
  return lines[0] + '\n';
}

export function 读取旧视区跟随来源() {
  const path = join(卡片布局旧目录, 旧项目路径), stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('旧项目来源不是独立普通文件');
  const source = readFileSync(path, 'utf8');
  if (哈希(source) !== 卡片布局来源指纹[旧项目路径]) throw Error('旧项目来源指纹改变，拒绝迁入');
  const ref = 唯一行(source, 'const revealCreatedNodeRef = useRef');
  const mark = 唯一行(source, 'revealCreatedNodeRef.current = newNode.id;');
  const start = '    useLayoutEffect(() => {\n        const id = revealCreatedNodeRef.current;';
  const end = '    }, [nodes, size.width, size.height]);\n';
  if (source.split(start).length !== 2) throw Error('旧视区跟随effect不唯一');
  const a = source.indexOf(start), b = source.indexOf(end, a);
  if (b < a) throw Error('旧视区跟随effect边界缺失');
  return { source, ref, mark, effect: source.slice(a, b + end.length) };
}

// 候选仅保存在内存。此工具不提供接入、数据操作或3100生命周期入口。
export function 构建视区跟随候选() {
  const integration = 读取分类容量隔离记录(视区跟随前置记录);
  const legacy = 读取旧视区跟随来源();
  const original = readFileSync(join(integration.副本, 视区跟随项目路径), 'utf8');
  if (original.includes('revealCreatedNodeRef')) throw Error('前置已含视区跟随或未知改动');
  const start = '    const createNode = useCallback(\n', end = '    const deleteNodes = useCallback(\n';
  if (original.split(start).length !== 2 || original.split(end).length !== 2) throw Error('手动创建边界不唯一');
  const a = original.indexOf(start), b = original.indexOf(end);
  if (b <= a) throw Error('手动创建边界顺序错误');
  const create = original.slice(a, b);
  const marked = 精确替换(create, [
    ['\n            setNodes((prev) => [...prev, newNode]);\n', '\n' + legacy.mark + '\n            setNodes((prev) => [...prev, newNode]);\n'],
  ]);
  const candidate = 精确替换(original, [
    ['    const connectionsRef = useRef(connections);\n', legacy.ref + '    const connectionsRef = useRef(connections);\n'],
    [create, marked + legacy.effect + '\n'],
  ]);
  核验分类容量完整包(integration.组合包, true);
  return { integration, legacy, delta: new Map([[视区跟随项目路径, { 原文: original, 产物: candidate }]]) };
}

function 保存新审查(path, content) {
  if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('拒绝覆盖既有审查产物；请另建修订批次');
  if (!existsSync(path)) writeFileSync(path, content, { flag: 'wx', mode: 0o600 });
}

export function 预审视区跟随(generate = false) {
  检查运行副本();
  const preview = 构建视区跟随候选();
  预审卡片布局类型(preview);
  const patch = 生成审查差异(preview.delta);
  const manifest = {
    日期: '2026-10-18', 状态: '待具体差异批准；未接入隔离副本或3100',
    上游提交: 基线.提交, 前置记录: 视区跟随前置记录,
    前置差异SHA256: preview.integration.差异SHA256,
    旧来源目录: 卡片布局旧目录, 旧来源文件: 旧项目路径,
    旧来源SHA256: 卡片布局来源指纹[旧项目路径],
    旧片段SHA256: Object.fromEntries(['ref', 'mark', 'effect'].map(key => [key, 哈希(preview.legacy[key])])),
    差异SHA256: 哈希(patch), 完整候选类型检查通过: true,
    真实浏览器验收: false, 已修改作者仓库: false, 已接管或重启3100: false,
    文件: [...preview.delta].map(([文件, item]) => ({ 文件, 原始SHA256: 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    范围: [
      '仅补回旧版ref、手动createNode标记及useLayoutEffect，三个来源片段逐字节保留',
      '新增节点超出旧版24/64/32/100视区边界时居中；使用避让事务后的最终位置，不改变缩放',
      '已有卡片、面板开关、避让间距、生成结果及后台任务保持；不迁入提示词变量业务',
      '批准后新独立后继保护及快照事务接入全新隔离包，真实浏览器验收；3100切换另需当前维护确认',
    ],
  };
  if (generate) {
    保存新审查(join(根目录, '上游适配/待审查/新建卡片视区跟随.patch'), patch);
    保存新审查(join(根目录, '上游适配/待审查/新建卡片视区跟随.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  核验分类容量完整包(preview.integration.组合包, true);
  检查运行副本();
  return manifest;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => arg !== '--生成审查差异')) throw Error('本工具仅支持内存预审及生成审查差异');
  console.log(JSON.stringify(预审视区跟随(process.argv.includes('--生成审查差异')), null, 2));
}
