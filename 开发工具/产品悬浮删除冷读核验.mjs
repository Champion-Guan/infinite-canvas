import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 读取产品删除隔离记录, 加载产品删除磁盘服务 } from './接入产品悬浮删除隔离副本.mjs';
import { readFreshRevealCanvas } from './视区跟随原画布夹具.mjs';

// 只重开本轮合成临时库，不启动HTTP服务，不创建或读取凭据主密钥。
const [root] = process.argv.slice(2);
assert.equal(process.argv.length, 3);
assert.match(root ?? '', /^\/private\/var\/folders\/.+\/T\/guan-product-delete-original-[\w-]+$/);
assert.equal(realpathSync(root), root);
assert.ok(root.startsWith(realpathSync(tmpdir()) + '/guan-product-delete-original-'));
const integration = 读取产品删除隔离记录(join(根目录, '.运行/产品悬浮删除-OlIVTI/产品悬浮删除接入记录.json'));
const { openWorkspace } = await 加载产品删除磁盘服务(integration);
const workspace = openWorkspace({ dataRoot: join(root, '数据'), initialize: false });
let result;
try {
  const canvas = await readFreshRevealCanvas({ readDocument: (...args) => workspace.readDocument(...args), readMedia: id => workspace.readMedia(id) });
  assert.deepEqual(canvas.state.projects.map(item => item.id).sort(), ['ACNm8vrn9NnxCM4A5BBGV', 'FDz2AWNI1vXp79D9UveA7'].sort());
  assert.deepEqual(canvas.state.deletedProjects.map(item => item.id), ['H4qllhgwDKaTpC6EVww8t']);
  const product = canvas.state.projects.find(item => item.id === 'FDz2AWNI1vXp79D9UveA7');
  assert.equal(product.nodes.length, 1);
  const node = product.nodes[0];
  assert.equal(node.id, 'image-1792339159720-pp68j');
  assert.equal(node.metadata.naturalWidth, 128);
  assert.equal(node.metadata.naturalHeight, 128);
  assert.equal(node.metadata.storageKey, 'image:Z0rcxpvI7QuiVnIDBvY8c');
  const hash = 'a8ce2cc55a1e98af548750444969d3645ea4ef893522886e1693c7cc16f12c63';
  const media = workspace.readMedia(hash);
  const original = readFileSync(join(根目录, '.运行/output/playwright/产品悬浮删除-20261018/产品回收验收.png'));
  assert.deepEqual(media.bytes, original);
  assert.equal(createHash('sha256').update(media.bytes).digest('hex'), hash);
  result = { checkedAt: new Date().toISOString(), status: 'pass', root, freshProcess: true, initialized: false,
    httpServiceStarted: false, credentialKeyAccessed: false,
    activeProductIds: canvas.state.projects.map(item => item.id), recycledProductIds: canvas.state.deletedProjects.map(item => item.id),
    restoredProductId: product.id, restoredNodeId: node.id, mediaBytes: media.bytes.length, mediaSHA256: hash,
    note: '正常停止后经批准工作区API重新打开并读取；不是HTTP服务重开或恢复导航通过的证据。' };
} finally { workspace.close(); }
const output = join(根目录, '.运行/output/playwright/产品悬浮删除-20261018/正常停机后冷重开核验.json');
writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(result, null, 2));
