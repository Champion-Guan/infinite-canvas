import { createHash } from 'node:crypto';
import { readFragmentGraph } from '../本机存储/分片值编码.mjs';
import { requireValue } from '../本机存储/协议.mjs';

const rootId = 'app-' + createHash('sha256').update('app_state').digest('hex');
const field = (tree, key) => tree?.[0] === 'object' && Array.isArray(tree[1]) ? tree[1].find(pair => pair?.[0] === key)?.[1] : null;
const string = tree => tree?.[0] === 'string' ? tree[1] : null;
const array = tree => tree?.[0] === 'array' && Array.isArray(tree[1]) ? tree[1] : [];
function taskId(productId, nodeId, remoteId) {
    const bytes = createHash('sha256').update(JSON.stringify([productId, nodeId, remoteId])).digest();
    bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
    const value = bytes.subarray(0, 16).toString('hex');
    return [value.slice(0, 8), value.slice(8, 12), value.slice(12, 16), value.slice(16, 20), value.slice(20)].join('-');
}
// 兼容保护接入前保存、尚未打开的产品。按已提交根缓存，切设置页不重读或写入。
export function createLegacyVideoInventory({ workspace, isTracked }) {
    let cachedHash = null, cached = [], flight = null;
    async function read() {
        const root = workspace.readDocument('extension', rootId);
        if (!root) return [];
        if (cachedHash === root.hash) return cached;
        requireValue(root.value.namespace === 'app_state', 'video_inventory_invalid', '视频盘点的画布命名空间不符。', 409);
        const entries = root.value.format === 'guan-app-storage.v1' ? root.value.entries : root.value.format === 'guan-app-storage.v2'
            ? await readFragmentGraph({ head: root.value.head, readDocument: async (collection, id) => workspace.readDocument(collection, id) }) : null;
        requireValue(Array.isArray(entries) && (root.value.format !== 'guan-app-storage.v2' || entries.length === root.value.entryCount), 'video_inventory_invalid', '视频盘点的画布目录不完整。', 409);
        const stores = entries.filter(item => item?.[0] === 'infinite-canvas:canvas_store');
        requireValue(stores.length <= 1, 'video_inventory_invalid', '视频盘点发现重复画布目录。', 409);
        const jobs = [];
        for (const product of array(field(field(stores[0]?.[1]?.tree, 'state'), 'projects'))) {
            const productId = string(field(product, 'id'));
            for (const node of array(field(product, 'nodes'))) {
                if (string(field(node, 'type')) !== 'video') continue;
                const metadata = field(node, 'metadata'), remoteId = string(field(metadata, 'videoTaskId'));
                if (!remoteId || string(field(metadata, 'status')) === 'success' && /^media:[0-9a-f]{64}$/.test(string(field(metadata, 'storageKey')) || '')) continue;
                const nodeId = string(field(node, 'id'));
                requireValue(productId && nodeId, 'video_inventory_invalid', '视频原产品或节点身份缺失。', 409);
                jobs.push({ id: taskId(productId, nodeId, remoteId), productId, nodeId, remoteId, state: 'uncertain', reason: 'video_legacy_untracked', createdAt: 0, canConfirmNoResult: false });
            }
        }
        const after = workspace.readDocument('extension', rootId);
        requireValue(after?.revision === root.revision && after.hash === root.hash, 'video_inventory_changed', '画布正在保存，请完成后再更新。', 409);
        cachedHash = root.hash; cached = jobs; return jobs;
    }
    return async () => {
        if (!flight) { const pending = read(); flight = pending; pending.finally(() => { if (flight === pending) flight = null; }).catch(() => {}); }
        return (await flight).filter(job => !isTracked(job.productId, job.nodeId, job.remoteId)).map(({ remoteId, ...job }) => job);
    };
}
