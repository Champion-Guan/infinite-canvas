export function 代理配置来源显示({ sourceKind, source, configName }) {
  return sourceKind === 'url' ? '已保存的远端订阅' : configName;
}
