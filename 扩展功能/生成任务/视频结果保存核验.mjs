import { createHash } from 'node:crypto';
import { readFragmentGraph } from '../本机存储/分片值编码.mjs';
import { requireValue } from '../本机存储/协议.mjs';

const rootId = 'app-' + createHash('sha256').update('app_state').digest('hex');
const field = (tree, name) => tree?.[0] === 'object' && Array.isArray(tree[1]) ? tree[1].find(pair => pair?.[0] === name)?.[1] : null;
const string = tree => tree?.[0] === 'string' ? tree[1] : null;
const array = tree => tree?.[0] === 'array' && Array.isArray(tree[1]) ? tree[1] : [];
// 与原画布保存核验一致，只查已落盘分片，不接受页面saved:true或临时Blob地址。
export function createSavedVideoVerifier({ workspace }) {
  return async job => {
    const root = workspace.readDocument('extension', rootId);
    if (!root) return false;
    requireValue(root.value.namespace === 'app_state', 'video_canvas_invalid', '画布命名空间不符。', 409);
    const entries = root.value.format === 'guan-app-storage.v1' ? root.value.entries : root.value.format === 'guan-app-storage.v2'
      ? await readFragmentGraph({ head: root.value.head, readDocument: async (collection, id) => workspace.readDocument(collection, id) }) : null;
    requireValue(Array.isArray(entries) && (root.value.format !== 'guan-app-storage.v2' || entries.length === root.value.entryCount), 'video_canvas_invalid', '画布保存目录不完整。', 409);
    const store = entries.filter(item => item?.[0] === 'infinite-canvas:canvas_store');
    if (store.length !== 1) return false;
    const products = array(field(field(store[0][1]?.tree, 'state'), 'projects')).filter(tree => string(field(tree, 'id')) === job.productId);
    if (products.length !== 1) return false;
    const nodes = array(field(products[0], 'nodes')).filter(tree => string(field(tree, 'id')) === job.nodeId);
    if (nodes.length !== 1 || string(field(nodes[0], 'type')) !== 'video') return false;
    const metadata = field(nodes[0], 'metadata'), key = string(field(metadata, 'storageKey'));
    if (string(field(metadata, 'status')) !== 'success' || string(field(metadata, 'videoTaskId')) !== job.remoteId ||
      string(field(metadata, 'videoTaskProvider')) !== job.provider || !/^media:[0-9a-f]{64}$/.test(key || '')) return false;
    const media = workspace.readMedia(key.slice(6));
    const after = workspace.readDocument('extension', rootId);
    return media?.bytes?.length > 0 && after?.revision === root.revision && after.hash === root.hash;
  };
}
