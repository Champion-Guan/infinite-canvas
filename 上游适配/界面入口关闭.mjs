// 只关闭截图中的展示入口；不修改配置能力、作者源码、许可证和历史。
export const 状态 = '待单独批准';
export const 上游提交 = '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc';
export const 自有模块 = {
  来源: '扩展功能/产品配置/界面入口.ts',
  产物: 'web/src/guan/界面入口.ts',
};

// 以已经批准接入的32项功能关闭产物为前置，不叠加未批准的格式候选。
export const 接入差异 = [
  {
    文件: 'web/src/components/layout/user-status-actions.tsx',
    替换: [
      ['import { productFeatures }', 'import { interfaceEntries } from "@/guan/界面入口";\nimport { productFeatures }'],
      ['{showConfig ? (', '{interfaceEntries.configButton && showConfig ? ('],
      ['            <GitHubLink className={cn("bg-transparent hover:bg-transparent dark:hover:bg-transparent", gitHubClassName)} style={gitHubStyle} />', '            {interfaceEntries.authorGitHub ? <GitHubLink className={cn("bg-transparent hover:bg-transparent dark:hover:bg-transparent", gitHubClassName)} style={gitHubStyle} /> : null}'],
    ],
  },
  {
    文件: 'web/src/components/layout/app-top-nav.tsx',
    替换: [
      ['import { Bot, Menu }', 'import { interfaceEntries } from "@/guan/界面入口";\nimport { Bot, Menu }'],
      ['                            <Link to="/"', '                            {interfaceEntries.authorHeaderBrand ? <Link to="/"'],
      ['                            </Link>\n\n                            {navigationTools.length', '                            </Link> : null}\n\n                            {navigationTools.length'],
    ],
  },
  {
    文件: 'web/src/components/layout/app-providers.tsx',
    替换: [
      ['import type { ReactNode }', 'import { interfaceEntries } from "@/guan/界面入口";\nimport type { ReactNode }'],
      ['document.title = t("meta.title");', 'document.title = interfaceEntries.tabTitle;'],
    ],
  },
  {
    文件: 'web/index.html',
    替换: [
      ['<link rel="icon" href="/logo.svg" />', '<link rel="icon" href="data:," />'],
      ['<title>无限画布</title>', '<title></title>'],
    ],
  },
];
