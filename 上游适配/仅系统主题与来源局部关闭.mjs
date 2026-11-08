// 本批只生成具体审查差异；用户批准范围后仍需单独批准该差异才能接入3100。
export const 状态 = '待单独批准';
export const 上游提交 = '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc';
export const 前置恢复SHA256 = 'd7a30ab2fee42b88be4d531caf014febc876106725c87d14159a41818bbbf4df';
export const 关闭内容 = ['画布与顶栏手动主题入口', '偏好设置界面主题控件', '提示词新增来源', '提示词定时拉取及同块全部拉取'];
export const 保留内容 = ['系统浅深色同步', '已有来源编辑启停删除', '缓存查看及单源手动刷新', '四类生成与节点信息', '旧配置和缓存'];
export const 自有模块 = [
  ['扩展功能/主题/仅跟随系统状态.ts', 'web/src/guan/三态主题状态.ts'],
  ['扩展功能/主题/仅跟随系统同步.tsx', 'web/src/guan/三态主题设置.tsx'],
];
