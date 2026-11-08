export const 状态 = '待单独批准';
export const 上游提交 = '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc';
export const 原始SHA256 = 'e68e79e33b86329d59545d35d74f8c90dd17786a3a26f8e348c022319efc75fe';
export const 自有模块 = {
  来源: '扩展功能/产品配置/右上双入口.ts',
  产物: 'web/src/guan/右上双入口.ts',
};
export const 接入差异 = {
  文件: 'web/src/components/layout/user-status-actions.tsx',
  替换: [
    ['import { productFeatures }', 'import { topRightEntries } from "@/guan/右上双入口";\nimport { productFeatures }'],
    ['{showConfig ? (', '{topRightEntries.configButton && showConfig ? ('],
    ['            <GitHubLink className={cn("bg-transparent hover:bg-transparent dark:hover:bg-transparent", gitHubClassName)} style={gitHubStyle} />', '            {topRightEntries.authorGitHub ? <GitHubLink className={cn("bg-transparent hover:bg-transparent dark:hover:bg-transparent", gitHubClassName)} style={gitHubStyle} /> : null}'],
  ],
};
