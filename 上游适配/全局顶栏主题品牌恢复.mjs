// 本批仅供审查，不含运行副本接入授权。旧批准批次与权威源码保持不变。
export const 状态 = '待单独批准';
export const 上游提交 = '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc';
export const 恢复编号 = ['U02', 'R02', 'R03'];
export const 保持关闭 = ['S03'];

const sun = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>';
// 与旧 server/index.mjs 的 localThemeToggleScript 相同的月亮路径，不重画图标。
const moon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.9 13.2A8.5 8.5 0 0 1 10.8 3.1 8.5 8.5 0 1 0 20.9 13.2Z" /></svg>';

export const 接入差异 = [
  {
    文件: 'web/src/layouts/user-layout.tsx',
    替换: [
      ['import { useLocation } from "react-router-dom";\n', ''],
      ['import { AppTopNav } from "@/components/layout/app-top-nav";\n', ''],
      ['    const isHome = useLocation().pathname === "/";\n', ''],
      ['{isHome ? <LegacyHomeChrome /> : <AppTopNav />}', '<LegacyHomeChrome />'],
    ],
  },
  {
    文件: 'web/src/guan/旧版首页顶栏.tsx',
    替换: [
      ['import { AppConfigModal } from "@/components/layout/app-config-modal";', 'import { AppConfigModal } from "@/components/layout/app-config-modal";\nimport { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";'],
      ['  const theme = useThemeStore((s) => s.theme);', '  const theme = useThemeStore((s) => s.theme);\n  const setTheme = useThemeStore((s) => s.setTheme);'],
      [`<button type="button" className={styles.themeButton} disabled aria-label="主题切换已关闭" title="按当前功能取舍，主题切换保持关闭">${sun}</button>`, `<AnimatedThemeToggler className={styles.themeButton} theme={theme} onThemeChange={setTheme} duration={400} variant="circle" aria-pressed={theme === "dark"} aria-label={theme === "dark" ? "切换浅色主题" : "切换深色主题"} title={theme === "dark" ? "切换浅色主题" : "切换深色主题"}>{theme === "dark" ? ${sun} : ${moon}}</AnimatedThemeToggler>`],
    ],
  },
  {
    文件: 'web/src/guan/功能开关.ts',
    替换: [
      ['    themeSwitch: false,', '    themeSwitch: true,'],
      ['"U01", "U02", "U03", "U04"', '"U01", "U03", "U04"'],
    ],
  },
  {
    文件: 'web/src/guan/脚本与提示词来源.ts',
    替换: [
      ['// S03、R02、R03的待审查产品策略；仅在具体差异获批后接入3100。', '// 全局界面恢复批次：恢复R02/R03；S03仍关闭，不清空来源、间隔或缓存。'],
      ['    promptSources: false,', '    promptSources: true,'],
      ['    promptRefresh: false,', '    promptRefresh: true,'],
    ],
  },
  {
    文件: 'web/src/components/layout/app-providers.tsx',
    替换: [['document.title = t("meta.title");', 'document.title = "AI生图工作台";']],
  },
  {
    文件: 'web/index.html',
    替换: [
      ['<link rel="icon" href="/logo.svg" />', '<link rel="icon" type="image/png" href="/guan/brand/favicon.png" />'],
      ['<title>无限画布</title>', '<title>AI生图工作台</title>'],
    ],
  },
  {
    文件: 'web/src/router.tsx',
    替换: [['    { path: "*", element: <NotFound /> },', '    { path: "*", element: <UserLayout><NotFound /></UserLayout> },']],
  },
  {
    文件: 'web/src/pages/not-found/index.tsx',
    替换: [['className="flex h-dvh flex-col overflow-hidden bg-background text-foreground"', 'className="flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground"']],
  },
];

export const 品牌资源 = {
  旧来源: '/Users/guanchengbin/CodexProjects/guan-ai-workbench-projects/guan-ai-workbench/public/assets/local-brand/favicon.png',
  自有来源: '界面资源/品牌原样资源/紫色G图标.png',
  产物: 'web/public/guan/brand/favicon.png',
  SHA256: 'ddd8aa5c975adde30e628b8a3c12cab92f5e0ae108785bad96bda8d48baab432',
};
