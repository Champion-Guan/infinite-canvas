// 与预审SQLite容量与性能.mjs相同字段/长度；仅合成产品，不读取客户数据。
export const capacityCases = [
  { name: '单产品50节点', products: 1, nodes: 50, textLength: 500 },
  { name: '单产品200节点', products: 1, nodes: 200, textLength: 1000 },
  { name: '5产品各200节点', products: 5, nodes: 200, textLength: 1000 },
  { name: '10产品各200节点', products: 10, nodes: 200, textLength: 1000 },
  { name: '20产品各250节点', products: 20, nodes: 250, textLength: 1000 },
  { name: '5产品各200中文节点', products: 5, nodes: 200, textLength: 500, chinese: true },
];
export function syntheticCanvas(config, titleSuffix = '') {
  const time = '2026-10-18T00:00:00.000Z';
  const text = (config.chinese ? '尺寸材质展示' : 'synthetic product dimensions ').repeat(config.textLength).slice(0, config.textLength);
  const projects = Array.from({ length: config.products }, (_, p) => ({
    id: `p-${p}`, title: `合成产品${p}${p === 0 ? titleSuffix : ''}`, createdAt: time, updatedAt: time,
    nodes: Array.from({ length: config.nodes }, (_, n) => ({ id: `n-${p}-${n}`, type: 'text', title: `合成提示词${n}`, position: { x: (n % 20) * 350, y: Math.floor(n / 20) * 300 }, width: 320, height: 240, metadata: { text } })),
    connections: Array.from({ length: Math.max(0, config.nodes - 1) }, (_, n) => ({ id: `e-${p}-${n}`, fromNodeId: `n-${p}-${n}`, toNodeId: `n-${p}-${n + 1}` })),
    chatSessions: [], activeChatId: null, backgroundMode: 'lines', showImageInfo: false, viewport: { x: 0, y: 0, k: 1 },
  }));
  return JSON.stringify({ state: { projects, deletedProjects: [] }, version: 0 });
}
