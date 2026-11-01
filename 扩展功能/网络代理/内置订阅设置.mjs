// 用户指定的公开默认订阅；自定义订阅可能带凭据，不能跟随状态查询读回。
export const 内置网络代理订阅 = 'https://gist.githubusercontent.com/Champion-Guan/303b62a808f08b9c709df6fa9f0fe6d4/raw/AWS';
export function 代理配置来源显示({ sourceKind, source, configName }) {
  return sourceKind === 'url' ? source === 内置网络代理订阅 ? 内置网络代理订阅 : '已保存的远端订阅' : configName;
}
