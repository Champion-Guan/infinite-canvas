import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { 根目录, 基线 } from './公共.mjs';
import { 检查运行副本, 运行目录, 哈希 } from './检查运行副本.mjs';
import { 精确替换, 预审类型, 生成审查差异 } from './检查首批功能适配.mjs';

const bridge = '@/guan/上游浏览器存储桥';
const forageFiles = ['services/image-storage.ts', 'services/file-storage.ts', 'services/app-sync.ts', 'services/api/prompts.ts', 'pages/image/index.tsx', 'pages/video/index.tsx', 'lib/canvas/canvas-event-bus.ts'];
const preferenceFiles = ['i18n/index.ts', 'stores/use-canvas-side-panel-store.ts', 'components/canvas/canvas-side-panel.tsx', 'components/canvas/canvas-node-hover-toolbar.tsx', 'stores/use-agent-store.ts', 'components/agent/agent-panel.tsx', 'components/agent/local-agent-panel.tsx'];
export function 生成SQLite全面候选() {
  检查运行副本();
  const files = new Map();
  const modify = (path, transform) => {
    const original = readFileSync(join(运行目录, path), 'utf8');
    const result = transform(original);
    if (result === original) throw Error('适配未改变预期文件：' + path);
    files.set(path, { 原文: original, 产物: result });
  };
  for (const suffix of forageFiles) modify('web/src/' + suffix, text => {
    let result = 精确替换(text, [['import localforage from "localforage";', `import { sqliteForage as localforage${suffix.endsWith('canvas-event-bus.ts') ? ', type SQLiteInstance' : ''} } from "${bridge}";`]]);
    if (suffix.endsWith('canvas-event-bus.ts')) result = 精确替换(result, [['new Map<string, LocalForage>()', 'new Map<string, SQLiteInstance>()']]);
    return result;
  });
  modify('web/src/lib/localforage-storage.ts', () => `// 保留上游导入名，底层唯一持久化通道改为SQLite；无浏览器回退。\nexport { sqliteStateStorage as localForageStorage } from "${bridge}";\n`);
  for (const suffix of preferenceFiles) modify('web/src/' + suffix, text => {
    const result = text.replaceAll('window.localStorage.', 'sqlitePreferences.').replaceAll('localStorage.', 'sqlitePreferences.');
    if (result === text) throw Error('预期偏好入口缺失：' + suffix);
    if (suffix === 'components/agent/local-agent-panel.tsx') return `import { sqlitePreferences, sessionMemory } from "${bridge}";\n` + result.replaceAll('sessionStorage.', 'sessionMemory.');
    return `import { sqlitePreferences } from "${bridge}";\n` + result;
  });
  for (const [suffix, anchor] of [['stores/use-config-store.ts', '            name: CONFIG_STORE_KEY,'], ['stores/use-prompt-source-store.ts', '            name: PROMPT_SOURCE_STORE_KEY,'], ['guan/三态主题状态.ts', '            name: "infinite-canvas:theme_store",']]) {
    modify('web/src/' + suffix, text => `import { sqliteStateStorage } from "${bridge}";\n` + 精确替换(text, [
      ['import { persist } from "zustand/middleware";', 'import { createJSONStorage, persist } from "zustand/middleware";'],
      [anchor, anchor + '\n            storage: createJSONStorage(() => sqliteStateStorage),'],
    ]));
  }
  // 当前原入口是自有三态主题的re-export，无旧默认persist残留。
  modify('web/src/stores/canvas/use-canvas-store.ts', text => {
    const start = text.indexOf('let saveTimer:'), end = text.indexOf('\nconst canvasStorage:', start);
    if (start < 0 || end < 0) throw Error('画布保存前态不符');
    let result = `import { scheduleStateSave } from "${bridge}";\n` + text.slice(0, start) + 'let queuedPersistState: PersistedCanvasState | null = null;\n' + text.slice(end);
    result = 精确替换(result, [[`        if (saveTimer) clearTimeout(saveTimer);\n        saveTimer = setTimeout(() => {\n            saveTimer = null;\n            void localForageStorage.setItem(name, JSON.stringify(value));\n        }, 400);`, '        return scheduleStateSave(name, JSON.stringify(value));']]);
    return result;
  });
  modify('web/src/services/local-storage-usage.ts', () => `// 原UI类型名保留兼容，但容量现在来自受限本机API，不打开浏览器数据库。\nexport { readSQLiteUsage as readLocalStorageUsage } from "${bridge}";\nexport type { SQLiteUsage as LocalStorageUsage } from "${bridge}";\n`);
  for (const locale of ['zh-CN', 'en-US']) {
    // 精确翻译锚点在下面按localStorage对象范围修改，不全局替换相同文案。
    modify(`web/src/i18n/locales/${locale}.ts`, text => {
      const start = text.indexOf('        localStorage: {'), end = text.indexOf('\n        },', start);
      if (start < 0 || end < 0) throw Error('本地存储说明锚点缺失');
      const values = locale === 'zh-CN' ? {
        description: '数据保存在本机SQLite及媒体文件中，不依赖浏览器缓存。', indexedDbUsage: '数据内容', siteUsage: '当前库与媒体占用', siteUsageHint: '包含SQLite日志，不含备份及未索引文件', contentEstimate: '结构化记录与已索引媒体', quota: '浏览器配额', quotaUnavailable: '本机存储不使用浏览器配额', mainDatabase: '本机工作区',
      } : {
        description: 'Data is stored in local SQLite and media files, not browser storage.', indexedDbUsage: 'Data content', siteUsage: 'Database and media usage', siteUsageHint: 'Includes SQLite journals; excludes backups and unindexed files', contentEstimate: 'Structured records and indexed media', quota: 'Browser quota', quotaUnavailable: 'Local storage does not use a browser quota', mainDatabase: 'Local workspace',
      };
      let section = text.slice(start, end);
      for (const [key, value] of Object.entries(values)) {
        const pattern = new RegExp(`(\\n\\s+${key}: )"[^"\\n]*"`);
        if (!pattern.test(section)) throw Error('存储说明缺少：' + key);
        section = section.replace(pattern, '$1' + JSON.stringify(value));
      }
      return text.slice(0, start) + section + text.slice(end);
    });
  }
  const main = 'web/src/main.tsx';
  const originalEntry = readFileSync(join(运行目录, main), 'utf8');
  files.set('web/src/guan/SQLite应用入口.tsx', { 原文: null, 产物: originalEntry.replace('"./styles/globals.css"', '"@/styles/globals.css"') });
  files.set('web/src/guan/上游浏览器存储桥.ts', { 原文: null, 产物: readFileSync(join(根目录, '扩展功能/本机存储/上游浏览器存储桥.ts'), 'utf8') });
  files.set(main, { 原文: originalEntry, 产物: `import { initializeSQLiteApplication } from "${bridge}";\n\nasync function start() {\n    try {\n        await initializeSQLiteApplication();\n        await import("@/guan/SQLite应用入口");\n    } catch {\n        const root = document.getElementById("root");\n        if (root) {\n            root.setAttribute("role", "alert");\n            root.textContent = "本机SQLite存储未就绪。为保护数据，工作台没有加载空画布。请检查本机服务和授权后刷新；浏览器旧数据保持不变。";\n        }\n    }\n}\nvoid start();\n` });
  // 完整性门禁针对可执行入口，不把翻译键名localStorage误当存储调用。
  for (const [path, item] of files) if (/\b(?:localStorage|sessionStorage)\s*\.|indexedDB\s*\.|from ["']localforage["']/.test(item.产物)) throw Error('候选仍有浏览器存储入口：' + path);
  return files;
}

export function 预审SQLite全面替换({ 完整类型 = false, 生成差异 = false } = {}) {
  const files = 生成SQLite全面候选();
  if (完整类型) 预审类型(files);
  const patch = 生成审查差异(files);
  const check = spawnSync('git', ['-C', 运行目录, 'apply', '--check', '--whitespace=error', '-'], { input: patch, encoding: 'utf8' });
  if (check.status !== 0) throw Error('SQLite候选差异不适用：' + check.stderr);
  const manifest = {
    状态: '待具体差异批准，禁止应用或重启', 上游提交: 基线.提交, 已应用到运行副本: false, 完整类型预审通过: 完整类型,
    差异SHA256: 哈希(patch),
    前置缺口: ['正式启动器授权交付与续期尚未接入', '安全凭据端口尚未实现生产接入；含凭据配置会明确拒绝保存', '单命名空间2MiB上限和全量JSON写入尚需大项目验证', '真实数据迁移属于阶段11，不在本补丁中'],
    文件: [...files].map(([文件, item]) => ({ 文件, 原始SHA256: item.原文 === null ? null : 哈希(item.原文), 候选SHA256: 哈希(item.产物) })),
    自有依赖: ['扩展功能/本机存储/应用值编码.mjs', '扩展功能/本机存储/应用存储适配.mjs', '扩展功能/本机存储/浏览器适配.mjs', '扩展功能/本机服务/数据服务.mjs', '扩展功能/本机存储/SQLite工作区.mjs'].map(文件 => ({ 文件, SHA256: 哈希(readFileSync(join(根目录, 文件))) })),
  };
  if (生成差异) {
    if (!完整类型) throw Error('输出审批快照前必须通过完整类型预审');
    const dir = join(根目录, '上游适配/待审查'); mkdirSync(dir, { recursive: true });
    for (const [name, content] of [['SQLite全面替换.patch', patch], ['SQLite全面替换.json', JSON.stringify(manifest, null, 2) + '\n']]) {
      const path = join(dir, name);
      if (existsSync(path) && readFileSync(path, 'utf8') !== content) throw Error('不覆盖不同的历史审查快照');
      if (!existsSync(path)) writeFileSync(path, content);
    }
  }
  检查运行副本();
  console.log(JSON.stringify(manifest, null, 2)); return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.slice(2).some(arg => !['--完整类型预审', '--生成审查差异'].includes(arg))) throw Error('只预审，不能应用');
  预审SQLite全面替换({ 完整类型: process.argv.includes('--完整类型预审'), 生成差异: process.argv.includes('--生成审查差异') });
}
