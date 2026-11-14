// 只预载启动链的静态依赖，不执行模块、不读取数据，也不递归预载按需面板。
export function startupPreloadTags(bundle, base = '/') {
  const chunks = Object.values(bundle).filter(item => item.type === 'chunk');
  const roots = chunks.filter(chunk => Object.keys(chunk.modules).some(id =>
    id.endsWith('/src/main.tsx') || id.endsWith('/存储界面/SQLite应用入口.tsx')));
  const visited = new Set(), styles = new Set();
  const visit = chunk => {
    if (!chunk || visited.has(chunk.fileName)) return;
    visited.add(chunk.fileName);
    for (const name of chunk.imports) visit(bundle[name]);
    for (const name of chunk.viteMetadata?.importedCss ?? []) styles.add(name);
  };
  roots.forEach(visit);
  const href = name => `${base.endsWith('/') ? base : base + '/'}${name}`;
  return [
    ...[...visited].filter(name => !bundle[name].isEntry).map(name => ({
      tag: 'link', attrs: { rel: 'modulepreload', crossorigin: '', href: href(name) }, injectTo: 'head',
    })),
    ...[...styles].map(name => ({
      tag: 'link', attrs: { rel: 'preload', as: 'style', crossorigin: '', href: href(name) }, injectTo: 'head',
    })),
  ];
}

export function startupPreloadPlugin() {
  let base = '/';
  return {
    name: 'workbench-startup-preload',
    apply: 'build',
    configResolved(config) { base = config.base; },
    transformIndexHtml: { order: 'post', handler(_html, context) {
      return context.bundle ? startupPreloadTags(context.bundle, base) : [];
    } },
  };
}
