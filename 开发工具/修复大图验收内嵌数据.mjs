import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';

// 服务正常排空停止后运行。只处理本次大图验收样本，媒体字节和其他画布保持不变。
const workspace = openWorkspace({ dataRoot: '/Users/guanchengbin/Library/Application Support/AI-Workbench-重建版/工作区', initialize: false });
const rootId = 'app-' + createHash('sha256').update('app_state').digest('hex');
const field = (tree, key) => tree?.[0] === 'object' ? tree[1].find(pair => pair[0] === key)?.[1] : undefined;
try {
    const root = workspace.readDocument('extension', rootId), beforeBytes = Buffer.byteLength(JSON.stringify(root.value));
    const entry = root.value.entries.find(([key]) => key === 'infinite-canvas:canvas_store')[1];
    const projects = field(field(entry.tree, 'state'), 'projects')[1];
    const project = projects.find(tree => field(tree, 'id')?.[1] === 'planning-size-main-20261114');
    assert.ok(project, '仅允许修复指定验收样本');
    const nodes = field(project, 'nodes')[1], metadata = field(nodes.find(n => field(n, 'id')?.[1] === 'same-parameter-size-check'), 'metadata');
    const images = field(metadata, 'productMainImages')[1], refs = new Set(entry.mediaIds), verified = new Set();
    let converted = 0, trimmed = 0;
    for (const image of images) {
        const url = field(image, 'url'), key = field(image, 'storageKey');
        if (url?.[0] !== 'string' || !url[1].startsWith('data:' + 'image/')) continue;
        assert.equal(key?.[0], 'string');
        const match = /^data:(image\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(url[1]);
        assert.ok(match);
        const bytes = Buffer.from(match[2], 'base64'), hash = createHash('sha256').update(bytes).digest('hex');
        assert.equal(bytes.length, field(image, 'bytes')[1]);
        if (!verified.has(hash)) {
            const ack = workspace.writeMedia(bytes, match[1]);
            assert.equal(ack.id, hash);
            const read = workspace.readMedia(hash);
            assert.deepEqual(read.bytes, bytes);
            verified.add(hash);
        }
        const descriptor = { mime: match[1], size: bytes.length, id: hash };
        url[0] = 'blob-url'; url[1] = descriptor;
        refs.add(hash); converted++;
    }
    const source = field(field(metadata, 'productImagePlan'), 'source'), parameters = field(source, 'parameters');
    if (parameters?.[0] === 'string') {
        const snapshot = JSON.parse(parameters[1]);
        for (const image of snapshot.productMainImages || []) {
            if (image.storageKey && typeof image.url === 'string' && image.url.startsWith('data:' + 'image/')) {
                delete image.url; trimmed++;
            }
        }
        parameters[1] = JSON.stringify(snapshot);
    }
    entry.mediaIds = [...refs].sort();
    const mediaIds = [...new Set(root.value.entries.flatMap(([, e]) => e.mediaIds))].sort();
    const afterBytes = Buffer.byteLength(JSON.stringify(root.value));
    if (converted || trimmed) workspace.writeDocument({ collection: 'extension', id: rootId, value: root.value,
        mediaIds, expectedRevision: root.revision, operationId: randomUUID() });
    console.log(JSON.stringify({ beforeBytes, afterBytes, convertedImages: converted, compactedSourceImages: trimmed,
        verifiedExactMedia: verified.size, projectsPreserved: projects.length, nodesPreserved: nodes.length }));
} finally { workspace.close(); }
