import { createHash } from 'node:crypto';
import { requireValue } from '../本机存储/协议.mjs';
import { readFragmentGraph } from '../本机存储/分片值编码.mjs';
import { exactKeys } from '../生成网关/生成协议.mjs';

const rootId = 'app-' + createHash('sha256').update('app_state').digest('hex');
function field(tree, name) {
  if (!Array.isArray(tree) || tree[0] !== 'object' || !Array.isArray(tree[1])) return null;
  const matches = tree[1].filter(pair => Array.isArray(pair) && pair[0] === name);
  return matches.length === 1 ? matches[0][1] : null;
}
const string = tree => Array.isArray(tree) && tree[0] === 'string' ? tree[1] : null;
const array = tree => Array.isArray(tree) && tree[0] === 'array' && Array.isArray(tree[1]) ? tree[1] : [];

// 仅读取已落盘的app_state及其哈希校验分片，不解码媒体、不读取配置凭据。
// 真实画布后续接入时，必须在原节点保存成功后附带任务+响应摘要，不能只发saved:true。
export function createSavedCanvasVerifier({ workspace } = {}) {
  requireValue(typeof workspace?.readDocument === 'function', 'invalid_canvas_verifier', '缺少真实工作区读端口。');
  return async function verify(job, checkpoint) {
    if (!exactKeys(checkpoint, ['rootRevision', 'rootHash'])) return false;
    const root = workspace.readDocument('extension', rootId);
    if (!root || root.revision !== checkpoint.rootRevision || root.hash !== checkpoint.rootHash) return false;
    requireValue(root.value.namespace === 'app_state', 'generation_canvas_invalid', '画布保存命名空间不匹配。', 409);
    let entries;
    if (root.value.format === 'guan-app-storage.v1') entries = root.value.entries;
    else {
      requireValue(root.value.format === 'guan-app-storage.v2' && Number.isSafeInteger(root.value.entryCount), 'generation_canvas_invalid', '画布保存格式不匹配。', 409);
      entries = await readFragmentGraph({ head: root.value.head, readDocument: async (collection, id) => workspace.readDocument(collection, id) });
      requireValue(Array.isArray(entries) && entries.length === root.value.entryCount, 'generation_canvas_invalid', '画布分片目录不完整。', 409);
    }
    requireValue(Array.isArray(entries) && entries.every(item => Array.isArray(item) && item.length === 2 && typeof item[0] === 'string') && new Set(entries.map(item => item[0])).size === entries.length, 'generation_canvas_invalid', '画布记录目录无效。', 409);
    const tree = entries.find(item => item[0] === 'infinite-canvas:canvas_store')?.[1]?.tree;
    const projects = array(field(field(tree, 'state'), 'projects'));
    const product = projects.filter(item => string(field(item, 'id')) === job.productId);
    if (product.length !== 1) return false;
    const nodes = array(field(product[0], 'nodes')).filter(item => string(field(item, 'id')) === job.nodeId);
    if (nodes.length !== 1) return false;
    const metadata = field(nodes[0], 'metadata');
    if (string(field(metadata, 'status')) !== 'success') return false;
    const receipts = array(field(metadata, 'gatewayGenerationReceipts'));
    const matched = receipts.some(item => string(field(item, 'taskId')) === job.id && string(field(item, 'responseHash')) === job.result?.id);
    const after = workspace.readDocument('extension', rootId);
    return matched && after?.hash === root.hash && after.revision === root.revision;
  };
}
