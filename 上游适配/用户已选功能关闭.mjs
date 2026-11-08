// 用户已确认功能范围；以下具体实现差异仍待独立批准，不提供应用命令。
export const 状态 = '待单独批准';
export const 上游提交 = '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc';
export const 自有模块 = [
  { 来源: '扩展功能/产品配置/用户已选功能.ts', 产物: 'web/src/guan/功能开关.ts' },
  { 来源: '扩展功能/产品配置/画布入口.tsx', 产物: 'web/src/guan/画布入口.tsx' },
];

// 在此前三项候选上增加门禁。旧候选及其审查指纹保留，不覆盖。
export const 接入差异 = [
  {
    文件: 'web/src/router.tsx',
    替换: [
      ['import { createBrowserRouter, Outlet }', 'import { createBrowserRouter, Navigate, Outlet }'],
      ['import UserLayout from "@/layouts/user-layout";', 'import { CanvasEntry } from "@/guan/画布入口";\nimport UserLayout from "@/layouts/user-layout";'],
      ...[
        ['AssetsPage', 'assets'], ['CanvasPage', 'canvas'], ['ConfigPage', 'config'],
        ['HomePage', 'home'], ['ImagePage', 'image'], ['PromptsPage', 'prompts'], ['VideoPage', 'video'],
      ].map(([name, path]) => [`import ${name} from "@/pages/${path}";\n`, '']),
      [
        `            { path: "/", element: <HomePage /> },
            { path: "/image", element: <ImagePage /> },
            { path: "/video", element: <VideoPage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/config", element: <ConfigPage /> },`,
        `            { path: "/", element: <CanvasEntry /> },
            ...["/image", "/video", "/assets", "/prompts", "/canvas", "/config"].map((path) => ({ path, element: <Navigate to="/" replace /> })),
            { path: "/canvas/:id", element: <CanvasProjectPage /> },`,
      ],
    ],
  },
  {
    文件: 'web/src/constant/navigation-tools.ts',
    替换: [
      ['import { FileText,', 'import { isPageEnabled } from "@/guan/功能开关";\nimport { FileText,'],
      ['export const navigationTools = [', 'export const navigationTools = (['],
      ['] as const;', '] as const).filter((tool) => isPageEnabled(tool.slug));'],
    ],
  },
  {
    文件: 'web/src/components/layout/app-top-nav.tsx',
    替换: [
      ['                            <button\n', '                            {navigationTools.length ? <button\n'],
      ['                                <Menu className="size-5" />\n                            </button>', '                                <Menu className="size-5" />\n                            </button> : null}'],
      ['            <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} />', '            {navigationTools.length ? <MobileNavDrawer open={mobileNavOpen} activeToolSlug={activeToolSlug} onClose={() => setMobileNavOpen(false)} /> : null}'],
    ],
  },
  {
    文件: 'web/src/components/layout/user-status-actions.tsx',
    替换: [
      ['import type { CSSProperties }', 'import { productFeatures } from "@/guan/功能开关";\nimport type { CSSProperties }'],
      ['{onOpenPlugins ? (', '{productFeatures.nodePlugins && onOpenPlugins ? ('],
      ['            <a href={DOCS_URL}', '            {productFeatures.docsLink ? <a href={DOCS_URL}'],
      ['                <BookOpen className="size-4" />\n            </a>', '                <BookOpen className="size-4" />\n            </a> : null}'],
      ['            <Tooltip title={languageLabel}', '            {productFeatures.languageSwitch ? <Tooltip title={languageLabel}'],
      ['            </Tooltip>', '            </Tooltip> : null}'],
      ['            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={naturalIconClass} style={iconStyle} aria-label={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")} title={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")} />', '            {productFeatures.themeSwitch ? <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={naturalIconClass} style={iconStyle} aria-label={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")} title={t(theme === "dark" ? "topNav.lightTheme" : "topNav.darkTheme")} /> : null}'],
      ['            <VersionReleaseModal style={versionStyle} />', '            {productFeatures.authorVersion ? <VersionReleaseModal style={versionStyle} /> : null}'],
    ],
  },
  {
    文件: 'web/src/components/canvas/canvas-top-bar.tsx',
    替换: [
      ['import { productFeatures }', 'import { isCanvasMenuEnabled, productFeatures }'],
      ['import { Button, Dropdown, Modal, Tooltip }', 'import { Button, Dropdown, Modal, Tooltip, type MenuProps }'],
      ['                            items: [', '                            items: (['],
      ['                            ],\n                        }}', '                            ] satisfies NonNullable<MenuProps["items"]>).filter((item) => !("key" in item) || isCanvasMenuEnabled(String(item.key))).filter((item, index, all) => item.type !== "divider" || (index > 0 && index < all.length - 1 && all[index - 1].type !== "divider")),\n                        }}'],
    ],
  },
  {
    文件: 'web/src/components/canvas/canvas-toolbar.tsx',
    替换: [
      ['import { Button,', 'import { productFeatures } from "@/guan/功能开关";\nimport { Button,'],
      ['const extensionDefs = listNodeDefinitions().filter((def) => def.showInCreateMenu !== false && getNodePluginId(def.type) !== "builtin");', 'const extensionDefs = productFeatures.nodePlugins ? listNodeDefinitions().filter((def) => def.showInCreateMenu !== false && getNodePluginId(def.type) !== "builtin") : [];'],
      ['                    <div className="px-1 pb-1.5 text-[11px] font-medium opacity-50">{t("canvas.toolbar.themeMode")}</div>', '                    {productFeatures.themeSwitch ? <>\n                    <div className="px-1 pb-1.5 text-[11px] font-medium opacity-50">{t("canvas.toolbar.themeMode")}</div>'],
      ['                    <div className="mt-3 px-1 pb-1.5 text-[11px] font-medium opacity-50">{t("canvas.toolbar.gridStyle")}</div>', '                    </> : null}\n                    <div className="mt-3 px-1 pb-1.5 text-[11px] font-medium opacity-50">{t("canvas.toolbar.gridStyle")}</div>'],
    ],
  },
  {
    文件: 'web/src/pages/canvas/project.tsx',
    替换: [
      ['import { useAgentStore }', 'import { productFeatures } from "@/guan/功能开关";\nimport { useAgentStore }'],
      ['                <CanvasPluginManagerModal open={pluginManagerOpen} onClose={() => setPluginManagerOpen(false)} />', '                {productFeatures.nodePlugins ? <CanvasPluginManagerModal open={pluginManagerOpen} onClose={() => setPluginManagerOpen(false)} /> : null}'],
    ],
  },
  {
    文件: 'web/src/components/layout/app-config-modal.tsx',
    替换: [
      ['].filter((item) => item.key !== "webdav" || productFeatures.webdav)', '].filter((item) => (item.key !== "webdav" || productFeatures.webdav) && (item.key !== "local-proxy" || productFeatures.localProxy))'],
    ],
  },
  {
    文件: 'web/src/hooks/use-version-check.ts',
    替换: [
      ['import { useCallback,', 'import { productFeatures } from "@/guan/功能开关";\nimport { useCallback,'],
      ['    const checkLatestVersion = useCallback(async () => {', '    const checkLatestVersion = useCallback(async () => {\n        if (!productFeatures.authorVersion) return false;'],
      ['        async (showMessage = false) => {', '        async (showMessage = false) => {\n            if (!productFeatures.authorVersion) return false;'],
      ['    const openReleaseModal = useCallback(() => {', '    const openReleaseModal = useCallback(() => {\n        if (!productFeatures.authorVersion) return;'],
    ],
  },
  {
    文件: 'web/src/stores/use-theme-store.ts',
    替换: [
      ['import { create }', 'import { productFeatures } from "@/guan/功能开关";\nimport { create }'],
      ['setTheme: (theme) => set({ theme }),', 'setTheme: (theme) => { if (productFeatures.themeSwitch) set({ theme }); },'],
    ],
  },
  {
    文件: 'web/src/i18n/index.ts',
    替换: [
      ['import i18n from "i18next";', 'import { productFeatures } from "@/guan/功能开关";\nimport i18n from "i18next";'],
      ['export function changeAppLocale(locale: AppLocale) {', 'export function changeAppLocale(locale: AppLocale) {\n    if (!productFeatures.languageSwitch) return Promise.resolve();'],
    ],
  },
  {
    文件: 'web/src/services/api/local-proxy.ts',
    替换: [
      ['import i18n from "@/i18n";', 'import { requireProductFeature } from "@/guan/功能开关";\nimport i18n from "@/i18n";'],
      ['export async function testLocalProxy(proxyUrl: string) {', 'export async function testLocalProxy(proxyUrl: string) {\n    requireProductFeature("localProxy");'],
    ],
  },
  {
    文件: 'web/src/stores/use-config-store.ts',
    替换: [
      ['import { useMemo }', 'import { productFeatures, requireProductFeature } from "@/guan/功能开关";\nimport { useMemo }'],
      ['    if (!proxyEnabled || !/^https?:\\/\\//i.test(url)) return url;', '    if (!proxyEnabled || !/^https?:\\/\\//i.test(url)) return url;\n    if (!productFeatures.localProxy) requireProductFeature("localProxy");'],
    ],
  },
  {
    文件: 'web/src/lib/canvas/plugin-loader.ts',
    替换: [
      ['import { registerNodeDefinitions,', 'import { productFeatures, requireProductFeature } from "@/guan/功能开关";\nimport { registerNodeDefinitions,'],
      ['async function evaluatePluginSource(source: string): Promise<CanvasPlugin> {', 'async function evaluatePluginSource(source: string): Promise<CanvasPlugin> {\n    requireProductFeature("nodePlugins");'],
      ['export function activatePlugin(plugin: CanvasPlugin) {', 'export function activatePlugin(plugin: CanvasPlugin) {\n    requireProductFeature("nodePlugins");'],
      ['async function fetchPluginSource(url: string) {', 'async function fetchPluginSource(url: string) {\n    requireProductFeature("nodePlugins");'],
      ['export async function installPluginFromUrl(url: string, opts?: { official?: boolean; bustCache?: boolean }) {', 'export async function installPluginFromUrl(url: string, opts?: { official?: boolean; bustCache?: boolean }) {\n    requireProductFeature("nodePlugins");'],
      ['export async function setPluginEnabled(record: InstalledPlugin, enabled: boolean) {', 'export async function setPluginEnabled(record: InstalledPlugin, enabled: boolean) {\n    requireProductFeature("nodePlugins");'],
      ['export function uninstallPlugin(id: string) {', 'export function uninstallPlugin(id: string) {\n    requireProductFeature("nodePlugins");'],
      ['export async function ensurePluginsLoaded() {', 'export async function ensurePluginsLoaded() {\n    if (!productFeatures.nodePlugins) return;'],
      ['async function loadLocalPlugins() {', 'async function loadLocalPlugins() {\n    if (!productFeatures.nodePlugins) return;'],
      ['async function loadDevPlugins() {', 'async function loadDevPlugins() {\n    if (!productFeatures.nodePlugins) return;'],
    ],
  },
  {
    文件: 'web/src/lib/canvas/plugin-registry.ts',
    替换: [
      ['import { PLUGIN_REGISTRY_URL }', 'import { requireProductFeature } from "@/guan/功能开关";\nimport { PLUGIN_REGISTRY_URL }'],
      ['export async function fetchOfficialPlugins(registryUrl: string = PLUGIN_REGISTRY_URL): Promise<OfficialPluginEntry[]> {', 'export async function fetchOfficialPlugins(registryUrl: string = PLUGIN_REGISTRY_URL): Promise<OfficialPluginEntry[]> {\n    requireProductFeature("nodePlugins");'],
    ],
  },
];
