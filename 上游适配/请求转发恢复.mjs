// 仅恢复已有的本地请求转发能力；具体差异须另行批准后才能接入3100。
export const 状态 = '待单独批准';
export const 上游提交 = '3a6b64b602ad062b29fac66902ed18a7ef5fd9dc';
export const 前置差异SHA256 = 'c20d9c494d9b08818138126cc72e9fcde55f683be95949738a385eae4ce070d8';
export const 策略路径 = 'web/src/guan/功能开关.ts';
export const 替换 = [
  ['    localProxy: false,', '    localProxy: true,'],
  ['    "U01", "U03", "U04", "S07", "S08",', '    "U01", "U03", "U04", "S08",'],
];
export const 恢复内容 = ['S07本地请求代理页签', '已有连接测试', '用户启用后的原有请求转发'];
export const 不包含 = ['自动开启proxyEnabled', '启动或安装转发进程', 'Mihomo及网络代理', '密钥服务端保管', '旧数据或真实凭据', '作者仓库修改', '服务重启', 'GitHub发布'];
