// 只转换本次运行配置，不改订阅原文、节点凭据、规则目标或已保存开关。
// 原组名保留为可手动选择的入口，默认首项为同范围的Smart智能组。
export function 启用Smart智能分组(config) {
  const groups = config['proxy-groups'] || [], names = new Set([...config.proxies, ...groups].map(item => item.name));
  const result = [];
  const builtIn = /^(?:DIRECT|REJECT(?:-DROP)?|PASS(?:-RULE)?|COMPATIBLE)$/i;
  for (const group of groups) {
    if (group.type === 'smart') { result.push({ ...group, uselightgbm: true, collectdata: false }); continue; }
    if (!['select', 'url-test', 'fallback', 'load-balance'].includes(group.type)) { result.push(group); continue; }
    const candidates = (group.proxies || []).filter(name => typeof name === 'string' && !builtIn.test(name));
    if (!candidates.length && !group['include-all-proxies']) { result.push(group); continue; }
    let name = String(group.name).slice(0, 220) + ' · Smart', suffix = 1;
    while (names.has(name)) name = String(group.name).slice(0, 220) + ' · Smart ' + suffix++;
    names.add(name);
    const smart = { ...group, name, type: 'smart', proxies: candidates, uselightgbm: true, collectdata: false,
      url: group.url || 'https://www.gstatic.com/generate_204', interval: group.interval || 300, lazy: false };
    delete smart.strategy;
    result.push(smart, { ...group, type: 'select', proxies: [name, ...(group.proxies || [])] });
  }
  return { ...config, 'proxy-groups': result, 'lgbm-auto-update': false };
}
