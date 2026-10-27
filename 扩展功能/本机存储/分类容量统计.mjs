import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { MEDIA_TYPES, PROTOCOL, SCHEMA_VERSION, StorageError, requireValue, validHash, validUUID } from './协议.mjs';
import { readFragmentGraph } from './分片值编码.mjs';
import { recycleOwnership, recycleCategory } from './回收站归属.mjs';

export const USAGE_FORMAT = 'guan-sqlite-usage.v1';
const sha = value => createHash('sha256').update(value).digest('hex');
const namespaces = {
  app_state: 'workspace', preferences: 'workspace', image_generation_logs: 'image_logs', video_generation_logs: 'video_logs',
  image_files: 'images', image_previews: 'previews', media_files: 'media_index', prompt_cache: 'prompts',
};
const labels = {
  images: '图片', previews: '图片缩略图', videos: '视频', audio: '音频', media_index: '通用媒体索引',
  prompts: '提示词缓存', workspace: '画布与应用配置', image_logs: '图片生成记录', video_logs: '视频生成记录',
  product_recycle: '产品回收站', workbook_recycle: 'Excel回收站',
  other_media: '其他媒体', shared: '跨分类共享内容', other: '其他扩展数据', history: '历史及未发布分片', retained_media: '当前未引用的保留媒体',
};
function safeStat(path, directory = false, optional = false) {
  let stat;
  try { stat = lstatSync(path); } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  requireValue(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1) && stat.uid === process.getuid() && (stat.mode & 0o022) === 0,
    'usage_unsafe_path', '容量统计拒绝链接、未知类型或不安全权限。', 409);
  return stat;
}
const check = (ok, message = '当前存储格式或引用不完整，未报告为空。') => requireValue(ok, 'usage_invalid_data', message, 409);
const mimeCategory = mime => mime.startsWith('image/') ? 'images' : mime.startsWith('video/') ? 'videos' : mime.startsWith('audio/') ? 'audio' : 'other_media';
function own(map, id, category) { if (!map.has(id)) map.set(id, new Set()); map.get(id).add(category); }
const owner = owners => owners.size === 1 ? [...owners][0] : 'shared';

// 只读独立连接持有业务快照；不在写连接跨await持有事务，不解密凭据、不读取媒体正文。
// 磁盘文件长度是采样值，不冒充与并行写入原子一致的磁盘快照。备份明确不计入。
export async function readCategorizedUsage({ dataRoot, workspaceId }) {
  let db;
  try {
    check(isAbsolute(dataRoot) && validUUID(workspaceId));
    safeStat(dataRoot, true);
    const dbPath = join(dataRoot, '工作台.sqlite'), mediaRoot = join(dataRoot, '媒体');
    safeStat(dbPath); safeStat(mediaRoot, true);
    for (const suffix of ['-wal', '-shm']) safeStat(dbPath + suffix, false, true);
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=3000; BEGIN');
    check(db.prepare('PRAGMA application_id').get().application_id === 0x47574149 && db.prepare('PRAGMA user_version').get().user_version === SCHEMA_VERSION);
    check(db.prepare("SELECT value FROM workspace WHERE key='id'").get()?.value === workspaceId);
    const categories = new Map(Object.entries(labels).map(([name, label]) => [name, { name, label, records: 0, files: 0, blocks: 0, documentBytes: 0, mediaBytes: 0, bytes: 0 }]));
    const docs = new Map(), docOwners = new Map(), media = new Map(), mediaOwners = new Map(), files = new Map(), storageKeyOwners = new Map();
    let ownership = recycleOwnership({});
    const docWeights = new Map();
    let documentBytes = 0, indexedMediaBytes = 0, steps = 0;
    const yieldPeriodically = async () => { if (++steps % 128 === 0) await setImmediate(); };
    for (const row of db.prepare('SELECT collection,id,length(CAST(body AS BLOB)) AS bytes FROM documents').iterate()) {
      docs.set(row.collection + '/' + row.id, row); documentBytes += row.bytes;
      check(docs.size <= 100_000, '统计记录超过本次安全上限，请使用后续分页统计。');
      await yieldPeriodically();
    }
    for (const row of db.prepare('SELECT id,mime,size FROM media').iterate()) {
      check(validHash(row.id) && MEDIA_TYPES.includes(row.mime) && Number.isSafeInteger(row.size) && row.size > 0);
      media.set(row.id, row); indexedMediaBytes += row.size;
      check(media.size <= 100_000, '媒体索引超过本次安全上限，请使用后续分页统计。');
      await yieldPeriodically();
    }
    const getDocument = (collection, id) => {
      const row = db.prepare('SELECT body,hash FROM documents WHERE collection=? AND id=?').get(collection, id);
      check(row && sha(row.body) === row.hash, '当前文档或分片缺失、哈希不符，统计已停止。');
      return { collection, id, value: JSON.parse(row.body), mediaIds: db.prepare('SELECT media_id FROM document_media WHERE collection=? AND document_id=? ORDER BY media_id').all(collection, id).map(ref => ref.media_id) };
    };
    // 回收站快照和当前画布都保存在同一个 canvas_store 文档中；只把快照里的媒体归到对应回收站，
    // 这样不会把回收站误报成普通画布，也不会把当前产品的共享媒体重复计入。
    function childCategory(category, field) {
      if (category === 'canvas-root' && field === 'deletedProjects') return 'product_recycle';
      if (category === 'canvas-root' && field === 'guanWorkbooks') return 'workbook-root';
      if (category === 'workbook-root' && field === 'recycledWorkbooks') return 'workbook_recycle';
      if (category === 'workbook-root' && field === 'contract') return 'contract-root';
      if (category === 'contract-root') return field === 'workspace' ? 'workspace' : 'owned-records';
      if (category === 'workbook-root') return 'workspace';
      return category;
    }
    function treeString(tree) {
      return Array.isArray(tree) && tree[0] === 'string' && typeof tree[1] === 'string' ? tree[1] : null;
    }
    function objectField(tree, name) {
      if (!Array.isArray(tree) || tree[0] !== 'object' || !Array.isArray(tree[1])) return null;
      return tree[1].find(pair => Array.isArray(pair) && pair[0] === name)?.[1] ?? null;
    }
    function plainTree(tree) {
      if (!Array.isArray(tree)) return null;
      if (tree[0] === 'object') return Object.fromEntries(tree[1].map(([key, child]) => [key, plainTree(child)]));
      if (tree[0] === 'array') return tree[1].map(plainTree);
      return ['string', 'number', 'boolean'].includes(tree[0]) ? tree[1] : null;
    }
    function collectRecycleIds(tree) {
      const value = plainTree(tree);
      ownership = recycleOwnership(value?.state ?? value ?? {});
    }
    function assetCategory(tree) { return recycleCategory(plainTree(tree), ownership); }
    function walkAssetTree(tree, refs) {
      if (!Array.isArray(tree) || tree[0] !== 'object' || !Array.isArray(tree[1])) { walkTree(tree, 'workspace', refs); return; }
      for (const pair of tree[1]) {
        if (!Array.isArray(pair) || pair.length !== 2) continue;
        if (pair[0] === 'state' && pair[1]?.[0] === 'object') {
          const assets = objectField(pair[1], 'assets');
          if (assets?.[0] === 'array' && Array.isArray(assets[1])) {
            for (const [name, child] of pair[1][1]) {
              if (name === 'assets') for (const asset of assets[1]) walkTree(asset, assetCategory(asset), refs);
              else walkTree(child, 'workspace', refs);
            }
            continue;
          }
        }
        walkTree(pair[1], 'workspace', refs);
      }
    }
    const mediaCategory = category => ['canvas-root', 'workbook-root', 'contract-root', 'owned-records'].includes(category) ? 'workspace' : category;
    function walkTree(tree, category, refs, depth = 0) {
      check(depth <= 32 && Array.isArray(tree));
      const [tag, value] = tree;
      if (category === 'owned-records') {
        if (tag === 'array') { for (const child of value) walkTree(child, assetCategory(child), refs, depth + 1); return; }
        category = assetCategory(tree);
      }
      if ((tag === 'null' || tag === 'undefined') && tree.length === 1) return;
      check(tree.length === 2);
      if (tag === 'string') {
        check(typeof value === 'string' && !value.startsWith('blob:'));
        if (/^(?:image|video|audio|file|video-reference|audio-reference):/.test(value)) own(storageKeyOwners, value, mediaCategory(category));
        return;
      }
      if (tag === 'boolean') { check(typeof value === 'boolean'); return; }
      if (tag === 'number') { check(Number.isFinite(value)); return; }
      if (tag === 'date') { check(typeof value === 'string' && Number.isFinite(Date.parse(value))); return; }
      if (tag === 'secret') { check(typeof value === 'string' && /^secret:[A-Za-z0-9_-]{1,128}$/.test(value)); return; }
      // 渠道绑定由应用编码器持久化；统计只校验引用格式，不访问或解密凭据。
      if (tag === 'provider') { check(typeof value === 'string' && /^provider:[a-f0-9]{64}$/.test(value), '渠道凭据引用格式无效，容量统计已停止。'); return; }
      if (['blob', 'blob-url', 'array-buffer'].includes(tag)) {
        check(value && typeof value.mime === 'string' && (!value.mime || MEDIA_TYPES.includes(value.mime)) && Number.isSafeInteger(value.size) && value.size >= 0 && value.size <= 512 * 1024 * 1024 && Array.isArray(value.parts) && value.parts.every(validHash) && value.parts.length === Math.ceil(value.size / (16 * 1024 * 1024)));
        const ownerCategory = mediaCategory(category);
        const kind = ['product_recycle', 'workbook_recycle', 'shared'].includes(ownerCategory) ? ownerCategory
          : ownerCategory === 'previews' ? 'previews'
          : !value.mime || value.mime === 'application/octet-stream' ? ownerCategory === 'images' ? 'images' : 'other_media'
          : mimeCategory(value.mime);
        const fileKey = JSON.stringify([value.mime, value.size, value.parts]);
        own(files, fileKey, kind);
        for (let i = 0; i < value.parts.length; i++) {
          const id = value.parts[i];
          check(media.get(id)?.size === Math.min(16 * 1024 * 1024, value.size - i * 16 * 1024 * 1024), '媒体块索引缺失或长度不符，统计已停止。');
          refs.add(id); own(mediaOwners, id, kind);
        }
        return;
      }
      check((tag === 'array' || tag === 'object') && Array.isArray(value));
      const names = new Set();
      for (const item of value) {
        if (tag === 'array') walkTree(item, category, refs, depth + 1);
        else {
          check(Array.isArray(item) && item.length === 2 && typeof item[0] === 'string' && !names.has(item[0]));
          names.add(item[0]); walkTree(item[1], childCategory(category, item[0]), refs, depth + 1);
        }
      }
    }
    function addWeight(weights, kind, bytes) { kind = mediaCategory(kind); weights.set(kind, (weights.get(kind) ?? 0) + bytes); }
    function weighTree(tree, kind, weights) {
      if (kind === 'owned-records') {
        if (tree?.[0] === 'array') { addWeight(weights, 'workspace', 12 + Math.max(0, tree[1].length - 1)); for (const child of tree[1]) weighTree(child, assetCategory(child), weights); return; }
        kind = assetCategory(tree);
      }
      if (kind === 'asset-root') {
        const value = plainTree(tree), assets = value?.state?.assets;
        if (Array.isArray(assets)) {
          const state = objectField(tree, 'state');
          const assetTrees = objectField(state, 'assets');
          const total = Buffer.byteLength(JSON.stringify(tree));
          let assigned = 0;
          for (const asset of assetTrees[1]) { const size = Buffer.byteLength(JSON.stringify(asset)); addWeight(weights, assetCategory(asset), size); assigned += size; }
          addWeight(weights, 'workspace', total - assigned); return;
        }
        kind = 'workspace';
      }
      if (!['array', 'object'].includes(tree?.[0])) { addWeight(weights, kind, Buffer.byteLength(JSON.stringify(tree))); return; }
      const [tag, children] = tree;
      // 容器、逗号和字段名也参与分配，全部分类相加仍严格等于内容字节。
      addWeight(weights, kind, Buffer.byteLength(JSON.stringify([tag, []])) + Math.max(0, children.length - 1));
      for (const child of children) {
        if (tag === 'array') weighTree(child, kind, weights);
        else {
          const next = childCategory(kind, child[0]);
          addWeight(weights, next, Buffer.byteLength(JSON.stringify(child[0])) + 3);
          weighTree(child[1], next, weights);
        }
      }
    }
    function countRecycleRecords(tree, depth = 0) {
      check(depth <= 32 && Array.isArray(tree));
      const [tag, value] = tree;
      if (tag === 'array' && Array.isArray(value)) {
        for (const item of value) countRecycleRecords(item, depth + 1);
        return;
      }
      if (tag !== 'object' || !Array.isArray(value)) return;
      for (const pair of value) {
        if (!Array.isArray(pair) || pair.length !== 2) continue;
        const [name, child] = pair;
        if (name === 'deletedProjects' && child?.[0] === 'array' && Array.isArray(child[1])) categories.get('product_recycle').records += child[1].length;
        if (name === 'recycledWorkbooks' && child?.[0] === 'array' && Array.isArray(child[1])) categories.get('workbook_recycle').records += child[1].length;
        countRecycleRecords(child, depth + 1);
      }
    }
    const rootIds = new Set();
    for (const [namespace, category] of Object.entries(namespaces)) {
      const id = 'app-' + sha(namespace), key = 'extension/' + id;
      rootIds.add(key);
      if (!docs.has(key)) continue;
      const document = getDocument('extension', id), value = document.value;
      check(value.namespace === namespace);
      own(docOwners, key, category);
      const namespaceDocs = new Set([key]);
      let entries;
      if (value.format === 'guan-app-storage.v1') entries = value.entries;
      else {
        check(value.format === 'guan-app-storage.v2' && Object.keys(value).length === 4 && Number.isSafeInteger(value.entryCount) && value.entryCount >= 0);
        entries = await readFragmentGraph({ head: value.head, readDocument: async (collection, part) => {
          await yieldPeriodically(); own(docOwners, collection + '/' + part, category); namespaceDocs.add(collection + '/' + part); return getDocument(collection, part);
        } });
        check(Array.isArray(entries) && entries.length === value.entryCount);
      }
      check(Array.isArray(entries));
      if (namespace === 'app_state') {
        const canvasEntry = entries.find(pair => Array.isArray(pair) && pair[0] === 'infinite-canvas:canvas_store');
        if (canvasEntry) collectRecycleIds(canvasEntry[1]?.tree);
      }
      const keys = new Set(), rootRefs = new Set(), weights = new Map();
      for (const pair of entries) {
        check(Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && pair[0].length > 0 && pair[0].length <= 512 && !keys.has(pair[0]));
        keys.add(pair[0]);
        const refs = new Set(), entryKey = pair[0];
        const treeCategory = namespace === 'app_state' && entryKey === 'infinite-canvas:canvas_store' ? 'canvas-root' : category;
        if (treeCategory === 'canvas-root') collectRecycleIds(pair[1]?.tree);
        const assetTreeCategory = namespace === 'app_state' && entryKey === 'infinite-canvas:asset_store' ? 'asset-root' : treeCategory;
        const owners = storageKeyOwners.get(entryKey);
        const logCategory = ['image_generation_logs', 'video_generation_logs'].includes(namespace) ? assetCategory(pair[1]?.tree) : 'workspace';
        const effectiveCategory = owners?.size ? owner(owners) : logCategory !== 'workspace' ? logCategory : assetTreeCategory;
        weighTree(pair[1]?.tree, effectiveCategory, weights);
        // 回收站记录数只计产品/工作簿条目，关联媒体索引不再混入业务条目数。
        if (!['product_recycle', 'workbook_recycle'].includes(effectiveCategory)) categories.get(category).records++;
        const rootTree = effectiveCategory === 'asset-root' ? pair[1]?.tree : null;
        if (rootTree) walkAssetTree(rootTree, refs);
        else walkTree(pair[1]?.tree, effectiveCategory, refs);
        if (treeCategory === 'canvas-root') countRecycleRecords(pair[1]?.tree);
        check(Array.isArray(pair[1]?.mediaIds) && pair[1].mediaIds.every(validHash) && pair[1].mediaIds.length === refs.size && pair[1].mediaIds.every(id => refs.has(id)) && new Set(pair[1].mediaIds).size === refs.size);
        for (const id of refs) rootRefs.add(id);
        await yieldPeriodically();
      }
      check(document.mediaIds.length === rootRefs.size && document.mediaIds.every(id => rootRefs.has(id)));
      for (const docKey of namespaceDocs) docWeights.set(docKey, weights);
    }
    for (const [key, row] of docs) {
      let kind;
      if (docOwners.has(key)) kind = owner(docOwners.get(key));
      else if (row.collection === 'extension' && /^app-part-[a-f0-9]{64}$/.test(row.id)) kind = 'history';
      else {
        check(!(row.collection === 'extension' && row.id.startsWith('app-') && !rootIds.has(key)), '发现未知应用存储版本，统计已停止。');
        kind = row.collection === 'canvas' ? 'workspace' : 'other';
        categories.get(kind).records++;
      }
      const weights = kind !== 'shared' ? docWeights.get(key) : null;
      const totalWeight = weights ? [...weights.values()].reduce((sum, n) => sum + n, 0) : 0;
      if (totalWeight) {
        const rows = [...weights].filter(([, bytes]) => bytes > 0); let assigned = 0;
        for (let i = 0; i < rows.length; i++) {
          const [name, weight] = rows[i], bytes = i === rows.length - 1 ? row.bytes - assigned : Math.floor(row.bytes * weight / totalWeight);
          categories.get(name).documentBytes += bytes; assigned += bytes;
        }
      } else categories.get(kind).documentBytes += row.bytes;
      if (kind === 'history') categories.get(kind).blocks++;
    }
    // 普通业务文档的直接媒体引用兼容；已有类型描述优先，不把同一图片另算一份。
    for (const row of db.prepare('SELECT collection,document_id,media_id FROM document_media').iterate()) {
      check(media.has(row.media_id));
      if (docOwners.has(row.collection + '/' + row.document_id) || /^app-part-[a-f0-9]{64}$/.test(row.document_id)) continue;
      if (!mediaOwners.has(row.media_id)) own(mediaOwners, row.media_id, mimeCategory(media.get(row.media_id).mime));
    }
    for (const [id, row] of media) {
      const kind = mediaOwners.has(id) ? owner(mediaOwners.get(id)) : 'retained_media';
      categories.get(kind).mediaBytes += row.size; categories.get(kind).blocks++;
    }
    for (const owners of files.values()) categories.get(owner(owners)).files++;
    db.exec('COMMIT'); db.close(); db = null;

    let mediaDiskBytes = 0, unindexedMediaBytes = 0, unindexedMediaFiles = 0;
    const seen = new Set();
    for (const entry of readdirSync(mediaRoot, { withFileTypes: true })) {
      let stat;
      try { stat = safeStat(join(mediaRoot, entry.name)); } catch (error) {
        if (error.code === 'ENOENT' && entry.name.startsWith('.暂存-')) continue;
        throw error;
      }
      mediaDiskBytes += stat.size;
      if (media.has(entry.name)) { check(stat.size === media.get(entry.name).size, '媒体文件缺失或大小不符，统计已停止。'); seen.add(entry.name); }
      else { unindexedMediaBytes += stat.size; unindexedMediaFiles++; }
      await yieldPeriodically();
    }
    check(seen.size === media.size, '已索引媒体文件缺失，统计已停止。');
    const databaseFileBytes = safeStat(dbPath).size, walBytes = safeStat(dbPath + '-wal', false, true)?.size ?? 0, shmBytes = safeStat(dbPath + '-shm', false, true)?.size ?? 0;
    const databaseBytes = databaseFileBytes + walBytes + shmBytes;
    const stores = [...categories.values()].map(row => ({ ...row, bytes: row.documentBytes + row.mediaBytes }));
    const contentBytes = documentBytes + indexedMediaBytes;
    check(stores.reduce((sum, row) => sum + row.bytes, 0) === contentBytes);
    const retainedContentBytes = stores.filter(row => row.name === 'history' || row.name === 'retained_media').reduce((sum, row) => sum + row.bytes, 0);
    return { protocol: PROTOCOL, workspaceId, usage: databaseBytes + mediaDiskBytes, quota: null, contentBytes,
      databases: [{ name: '工作台.sqlite + 媒体', version: SCHEMA_VERSION, bytes: contentBytes, stores }],
      breakdown: { format: USAGE_FORMAT, sampledAt: new Date().toISOString(), currentContentBytes: contentBytes - retainedContentBytes, retainedContentBytes,
        documentBytes, indexedMediaBytes, mediaDiskBytes, unindexedMediaBytes, unindexedMediaFiles, databaseBytes, databaseFileBytes, walBytes, shmBytes,
        businessSnapshot: true, physicalSample: true, backupsIncluded: false, mediaContentVerified: false } };
  } catch (error) {
    if (error instanceof StorageError) throw error;
    throw new StorageError('usage_unavailable', '容量读取失败，未报告为空；请稍后刷新。', 503);
  } finally {
    if (db) { try { if (db.isTransaction) db.exec('ROLLBACK'); } finally { db.close(); } }
  }
}
