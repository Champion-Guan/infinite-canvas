export const 状态 = '待单独批准';
export const 上游提交 = '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc';
export const 关闭编号 = ['S03', 'R02', 'R03'];
export const 自有模块 = {
  来源: '扩展功能/产品配置/脚本与提示词来源.ts',
  产物: 'web/src/guan/脚本与提示词来源.ts',
};
const policy = 'import { businessFeatures, requireBusinessFeature, resolveBusinessConfigTab } from "@/guan/脚本与提示词来源";\n';
// 每份文件只引入实际使用的绑定，不批量格式化、不改数据schema。
const use = (...names) => policy.replace('businessFeatures, requireBusinessFeature, resolveBusinessConfigTab', names.join(', '));

export const 接入差异 = [
  {
    文件: 'web/src/components/layout/channel-editor-drawer.tsx',
    替换: [
      ['import { Button, Drawer', use('businessFeatures') + 'import { Button, Drawer'],
      ['                                <Button size="small" type={model.script ?', '                                {businessFeatures.modelScripts ? <Button size="small" type={model.script ?'],
      ['                                    {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}\n                                </Button>', '                                    {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}\n                                </Button> : model.script ? <span className="text-xs text-amber-600 dark:text-amber-400" title="原有脚本已保留，生成时会停止，不会改用其他调用方式">自定义脚本已停用</span> : null}'],
      ['            <ModelScriptEditor\n', '            {businessFeatures.modelScripts ? <ModelScriptEditor\n'],
      ['                onClose={() => setScriptTarget(null)}\n            />', '                onClose={() => setScriptTarget(null)}\n            /> : null}'],
    ],
  },
  {
    文件: 'web/src/stores/use-config-store.ts',
    替换: [
      ['import { productFeatures', use('requireBusinessFeature') + 'import { productFeatures'],
      ['    return findChannelModel(config, value)?.model.script?.trim() || "";', '    const script = findChannelModel(config, value)?.model.script?.trim() || "";\n    if (script) requireBusinessFeature("modelScripts");\n    return script;'],
    ],
  },
  {
    文件: 'web/src/services/api/model-plugin.ts',
    替换: [
      ['import axios,', use('requireBusinessFeature') + 'import axios,'],
      ['export async function runModelPlugin<T = unknown>(args: RunPluginArgs): Promise<T> {\n', 'export async function runModelPlugin<T = unknown>(args: RunPluginArgs): Promise<T> {\n    requireBusinessFeature("modelScripts");\n'],
    ],
  },
  {
    文件: 'web/src/components/layout/app-config-modal.tsx',
    替换: [
      ['import { productFeatures', use('businessFeatures', 'resolveBusinessConfigTab') + 'import { productFeatures'],
      ['const [activeTab, setActiveTab] = useState<ConfigTabKey>(() => resolveConfigTab(initialTab));', 'const [activeTab, setActiveTab] = useState<ConfigTabKey>(() => resolveBusinessConfigTab(resolveConfigTab(initialTab)));'],
      ['useEffect(() => setActiveTab(resolveConfigTab(initialTab)), [initialTab]);', 'useEffect(() => setActiveTab(resolveBusinessConfigTab(resolveConfigTab(initialTab))), [initialTab]);'],
      ['setActiveTab(resolveConfigTab(key as ConfigTabKey))', 'setActiveTab(resolveBusinessConfigTab(resolveConfigTab(key as ConfigTabKey)))'],
      ['(item.key !== "local-proxy" || productFeatures.localProxy))}', '(item.key !== "local-proxy" || productFeatures.localProxy) && (item.key !== "prompt-sources" || businessFeatures.promptSources))}'],
    ],
  },
  {
    文件: 'web/src/hooks/use-prompt-source-scheduler.ts',
    替换: [
      ['import { useEffect }', use('businessFeatures') + 'import { useEffect }'],
      ['        if (!intervalMinutes) return;', '        if (!businessFeatures.promptRefresh || !intervalMinutes) return;'],
    ],
  },
  {
    文件: 'web/src/services/api/prompts.ts',
    替换: [
      ['import localforage', use('businessFeatures', 'requireBusinessFeature') + 'import localforage'],
      ['function getOrStartRefresh(source: PromptSource) {\n', 'function getOrStartRefresh(source: PromptSource) {\n    requireBusinessFeature("promptSources");\n'],
      ['    const cached = await readSourceCache(source.id);\n    if (cached) {', '    const cached = await readSourceCache(source.id);\n    // 保留R01离线读取：不因缺缓存、过期或来源变化触发网络和缓存写入。\n    if (!businessFeatures.promptRefresh) return withSourceMeta(source, cached?.items || []);\n    if (cached) {'],
      ['export async function refreshSource(sourceId: string): Promise<PromptSourceRefreshResult> {\n', 'export async function refreshSource(sourceId: string): Promise<PromptSourceRefreshResult> {\n    requireBusinessFeature("promptSources");\n'],
      ['export async function refreshAllSources(): Promise<PromptSourceRefreshSummary> {\n', 'export async function refreshAllSources(): Promise<PromptSourceRefreshSummary> {\n    requireBusinessFeature("promptSources");\n'],
      ['export async function refreshDueSources(maxAgeMs: number): Promise<PromptSourceRefreshSummary> {\n', 'export async function refreshDueSources(maxAgeMs: number): Promise<PromptSourceRefreshSummary> {\n    requireBusinessFeature("promptRefresh");\n'],
    ],
  },
  {
    文件: 'web/src/services/api/prompt-source-runtime.ts',
    替换: [
      ['import i18n', use('requireBusinessFeature') + 'import i18n'],
      ['export async function runPromptSource(source: PromptSource, options?: RunOptions): Promise<RawPrompt[]> {\n', 'export async function runPromptSource(source: PromptSource, options?: RunOptions): Promise<RawPrompt[]> {\n    requireBusinessFeature("promptSources");\n'],
    ],
  },
  {
    文件: 'web/src/stores/use-prompt-source-store.ts',
    替换: [
      ['import { create }', use('requireBusinessFeature') + 'import { create }'],
      ['            addSource: () => createPromptSource(),', '            addSource: () => { requireBusinessFeature("promptSources"); return createPromptSource(); },'],
      ['            saveSource: (source) =>\n                set((state) => ({', '            saveSource: (source) => {\n                requireBusinessFeature("promptSources");\n                return set((state) => ({'],
      ['                        : [...state.sources, createPromptSource(source)],\n                })),', '                        : [...state.sources, createPromptSource(source)],\n                }));\n            },'],
      ['            removeSource: (id) => set((state) => ({ sources: state.sources.filter((item) => item.id !== id || item.builtIn) })),', '            removeSource: (id) => { requireBusinessFeature("promptSources"); return set((state) => ({ sources: state.sources.filter((item) => item.id !== id || item.builtIn) })); },'],
      ['            toggleSource: (id, enabled) => set((state) => ({ sources: state.sources.map((item) => (item.id === id ? { ...item, enabled } : item)) })),', '            toggleSource: (id, enabled) => { requireBusinessFeature("promptSources"); return set((state) => ({ sources: state.sources.map((item) => (item.id === id ? { ...item, enabled } : item)) })); },'],
      ['            updateSchedule: (key, value) => set((state) => ({ schedule: { ...state.schedule, [key]: value } })),', '            updateSchedule: (key, value) => { requireBusinessFeature("promptRefresh"); return set((state) => ({ schedule: { ...state.schedule, [key]: value } })); },'],
    ],
  },
];
