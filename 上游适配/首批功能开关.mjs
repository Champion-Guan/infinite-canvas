// 待用户审查的精确接入声明。没有应用命令，不能据此修改运行副本。
export const 状态 = '待单独批准';
export const 上游提交 = '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc';
export const 自有模块 = {
  来源: '扩展功能/产品配置/功能开关.ts',
  产物: 'web/src/guan/功能开关.ts',
};

// 每个锚点必须恰好出现一次；上游变化或未知差异都不能模糊应用。
export const 接入差异 = [
  {
    文件: 'web/src/router.tsx',
    替换: [
      ['import { AnalyticsTracker }', 'import { productFeatures } from "@/guan/功能开关";\nimport { AnalyticsTracker }'],
      ['                <AnalyticsTracker />', '                {productFeatures.analytics ? <AnalyticsTracker /> : null}'],
    ],
  },
  {
    文件: 'web/src/lib/analytics.ts',
    替换: [
      ['import { ANALYTICS_BAIDU_ID', 'import { productFeatures } from "@/guan/功能开关";\nimport { ANALYTICS_BAIDU_ID'],
      ['    if (initialized || typeof window === "undefined") return;', '    if (!productFeatures.analytics || initialized || typeof window === "undefined") return;'],
      ['export function trackPageview(path: string) {', 'export function trackPageview(path: string) {\n    if (!productFeatures.analytics) return;'],
    ],
  },
  {
    文件: 'web/src/layouts/user-layout.tsx',
    替换: [
      ['import { AgentPanel }', 'import { productFeatures } from "@/guan/功能开关";\nimport { AgentPanel }'],
      ['            <AgentPanel />', '            {productFeatures.externalAgent ? <AgentPanel /> : null}'],
    ],
  },
  {
    文件: 'web/src/components/layout/app-top-nav.tsx',
    替换: [
      ['import { Bot, Menu }', 'import { productFeatures } from "@/guan/功能开关";\nimport { Bot, Menu }'],
      ['        if (autoConnectRef.current || agentEnabled', '        if (!productFeatures.externalAgent || autoConnectRef.current || agentEnabled'],
      [
        `                            <Tooltip title={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")}>
                                <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" icon={<Bot className="size-4" />} onClick={togglePanel} aria-label={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")} />
                            </Tooltip>`,
        `                            {productFeatures.externalAgent ? (
                                <Tooltip title={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")}>
                                    <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" icon={<Bot className="size-4" />} onClick={togglePanel} aria-label={t(panelOpen ? "topNav.closeAgent" : "topNav.openAgent")} />
                                </Tooltip>
                            ) : null}`,
      ],
    ],
  },
  {
    文件: 'web/src/components/canvas/canvas-top-bar.tsx',
    替换: [
      ['import { useEffect, useRef, useState }', 'import { productFeatures } from "@/guan/功能开关";\nimport { useEffect, useRef, useState }'],
      ['                    <CompactAgentStatus status={compactAgentStatus} onClick={onToggleAgent} />', '                    {productFeatures.externalAgent ? <CompactAgentStatus status={compactAgentStatus} onClick={onToggleAgent} /> : null}'],
      [
        `                    <span className="h-6 w-px" style={{ background: theme.toolbar.border }} />
                    <Button
                        type="text"
                        className="!h-10 !rounded-xl !px-3 !font-medium"
                        style={{ background: agentOpen ? theme.toolbar.activeBg : theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
                        icon={<Bot className="size-4" />}
                        onClick={onToggleAgent}
                    >
                        Agent
                    </Button>`,
        `                    {productFeatures.externalAgent ? (
                        <>
                            <span className="h-6 w-px" style={{ background: theme.toolbar.border }} />
                            <Button
                                type="text"
                                className="!h-10 !rounded-xl !px-3 !font-medium"
                                style={{ background: agentOpen ? theme.toolbar.activeBg : theme.toolbar.panel, color: theme.node.text, boxShadow: "0 10px 30px rgba(28,25,23,.10)" }}
                                icon={<Bot className="size-4" />}
                                onClick={onToggleAgent}
                            >
                                Agent
                            </Button>
                        </>
                    ) : null}`,
      ],
    ],
  },
  {
    文件: 'web/src/stores/use-agent-store.ts',
    替换: [
      ['import { create }', 'import { productFeatures } from "@/guan/功能开关";\nimport { create }'],
      ['    panelMounted: true,', '    panelMounted: productFeatures.externalAgent,'],
      ['    openPanel: () => set({ panelOpen: true, panelMounted: true, panelClosing: false }),', '    openPanel: () => {\n        if (!productFeatures.externalAgent) return;\n        set({ panelOpen: true, panelMounted: true, panelClosing: false });\n    },'],
      ['    connectAgent: (options) => {', '    connectAgent: (options) => {\n        if (!productFeatures.externalAgent) return;'],
    ],
  },
  {
    文件: 'web/src/pages/canvas/hooks/use-agent-bridge.ts',
    替换: [
      ['import i18n from "@/i18n";', 'import { productFeatures } from "@/guan/功能开关";\nimport i18n from "@/i18n";'],
      ['    useEffect(() => {\n        setAgentCanvasContext(', '    useEffect(() => {\n        if (!productFeatures.externalAgent) return;\n        setAgentCanvasContext('],
    ],
  },
  {
    文件: 'web/src/services/api/canvas-agent.ts',
    替换: [
      ['import i18n from "@/i18n";', 'import { productFeatures, requireProductFeature } from "@/guan/功能开关";\nimport i18n from "@/i18n";'],
      ['export async function postState(endpoint: string, token: string, clientId: string, snapshot: CanvasAgentSnapshot | null) {', 'export async function postState(endpoint: string, token: string, clientId: string, snapshot: CanvasAgentSnapshot | null) {\n    requireProductFeature("externalAgent");'],
      ['export async function activateAgentClient(endpoint: string, token: string, clientId: string) {', 'export async function activateAgentClient(endpoint: string, token: string, clientId: string) {\n    requireProductFeature("externalAgent");'],
      ['export function resolveAgentMessageAssetUrl(endpoint: string, token: string, value: string) {', 'export function resolveAgentMessageAssetUrl(endpoint: string, token: string, value: string) {\n    if (!productFeatures.externalAgent) return "";'],
      ['export async function fetchAgentJson<T>(endpoint: string, token: string, path: string, init?: RequestInit) {', 'export async function fetchAgentJson<T>(endpoint: string, token: string, path: string, init?: RequestInit) {\n    requireProductFeature("externalAgent");'],
      ['export async function discoverAgentConfig(endpoint: string) {', 'export async function discoverAgentConfig(endpoint: string) {\n    requireProductFeature("externalAgent");'],
    ],
  },
  {
    文件: 'web/src/components/layout/app-config-modal.tsx',
    替换: [
      ['import { App, Button,', 'import { productFeatures, resolveConfigTab } from "@/guan/功能开关";\nimport { App, Button,'],
      ['useState<ConfigTabKey>(initialTab)', 'useState<ConfigTabKey>(() => resolveConfigTab(initialTab))'],
      ['useEffect(() => setActiveTab(initialTab), [initialTab]);', 'useEffect(() => setActiveTab(resolveConfigTab(initialTab)), [initialTab]);'],
      ['onChange={(key) => setActiveTab(key as ConfigTabKey)}', 'onChange={(key) => setActiveTab(resolveConfigTab(key as ConfigTabKey))}'],
      ['                ]}\n            />', '                ].filter((item) => item.key !== "webdav" || productFeatures.webdav)}\n            />'],
    ],
  },
  {
    文件: 'web/src/services/app-sync.ts',
    替换: [
      ['import localforage from "localforage";', 'import { requireProductFeature } from "@/guan/功能开关";\nimport localforage from "localforage";'],
      ['export async function syncAppDataToWebdav(config: WebdavSyncConfig, onProgress?: AppSyncProgress): Promise<AppSyncResult> {', 'export async function syncAppDataToWebdav(config: WebdavSyncConfig, onProgress?: AppSyncProgress): Promise<AppSyncResult> {\n    requireProductFeature("webdav");'],
    ],
  },
  {
    文件: 'web/src/services/webdav-sync.ts',
    替换: [
      ['import i18n from "@/i18n";', 'import { requireProductFeature } from "@/guan/功能开关";\nimport i18n from "@/i18n";'],
      ['async function ensureWebdavDirectory(config: WebdavSyncConfig) {', 'async function ensureWebdavDirectory(config: WebdavSyncConfig) {\n    requireProductFeature("webdav");'],
      ['export async function uploadWebdavFile(config: WebdavSyncConfig, path: string, file: Blob, contentType = "application/octet-stream") {', 'export async function uploadWebdavFile(config: WebdavSyncConfig, path: string, file: Blob, contentType = "application/octet-stream") {\n    requireProductFeature("webdav");'],
      ['async function webdavFetch(config: WebdavSyncConfig, path: string, init: RequestInit) {', 'async function webdavFetch(config: WebdavSyncConfig, path: string, init: RequestInit) {\n    requireProductFeature("webdav");'],
    ],
  },
];
