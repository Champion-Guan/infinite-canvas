// 对上一份未批准候选的修订，不覆盖旧审查快照，也不授权接入运行副本。
export const 状态 = '待单独批准';
export const 上游提交 = '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc';
export const 前置恢复SHA256 = 'd7a30ab2fee42b88be4d531caf014febc876106725c87d14159a41818bbbf4df';
export const 测试来源ID = 'banana-prompt-quicker';
export const 移除内置来源ID = [
  'davidwu-gpt-image2-prompts',
  'freestylefly-gpt-image-2',
  'awesome-gpt-image',
  'awesome-gpt4o-image-prompts',
  'youmind-gpt-image-2',
  'youmind-nano-banana-pro',
];
export const 关闭内容 = ['画布内手动主题入口', '偏好设置界面主题区块', '新增来源', '定时拉取及同块全部拉取', '其余6个内置来源'];
export const 保留内容 = ['顶栏主题按钮及原有手动偏好', '系统主题同步', 'Banana Prompt Quicker测试来源', '自定义来源与缓存', '单源手动刷新', '四类生成与节点信息'];
