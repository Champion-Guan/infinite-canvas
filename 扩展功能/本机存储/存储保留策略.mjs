import { createHash, randomUUID } from 'node:crypto';
import { requireValue } from './协议.mjs';

export const RETENTION_DAY = 86_400_000;
const hash = value => createHash('sha256').update(value).digest('hex');
const fragmentId = value => typeof value === 'string' && /^app-part-[a-f0-9]{64}$/.test(value);
const defaults = { enabled: true, days: 90 };

// 与工作区使用同一连接和事务；不打开第二个写连接，不扫描用户目录。
export function createStorageRetention({ db, transaction, active, recentUploads, removeExternal, checkCompactionSpace, checkWriteSpace, now = Date.now }) {
  db.exec(`CREATE TABLE IF NOT EXISTS storage_retention (key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS storage_retention_items (kind TEXT NOT NULL,id TEXT NOT NULL,since INTEGER NOT NULL,PRIMARY KEY(kind,id)) STRICT;`);
  const plans = new Map();
  const read = (key, fallback) => {
    const row = db.prepare('SELECT value FROM storage_retention WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : fallback;
  };
  const save = (key, value) => db.prepare('INSERT INTO storage_retention VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  function status() {
    active();
    const page = db.prepare('PRAGMA page_size').get().page_size, free = db.prepare('PRAGMA freelist_count').get().freelist_count;
    return { policy: { ...read('policy', defaults) }, lastRun: read('lastRun', null), lastAutomaticAt: read('lastAutomaticAt', null),
      reusableBytes: page * free };
  }
  function configure(policy) {
    active(true);
    requireValue(policy && Object.keys(policy).sort().join(',') === 'days,enabled' && typeof policy.enabled === 'boolean' &&
      Number.isInteger(policy.days) && policy.days >= 7 && policy.days <= 365, 'invalid_retention_policy', '保留天数须在7至365天之间。');
    checkWriteSpace();
    transaction(() => save('policy', policy));
    return status();
  }
  function inventory() {
    const rows = db.prepare(`SELECT collection,id,hash,CASE WHEN id LIKE 'app-part-%' THEN NULL ELSE body END AS body,
      CASE WHEN id LIKE 'app-part-%' THEN json_extract(body,'$.format') ELSE NULL END AS fragmentFormat
      FROM documents ORDER BY collection,id`).all();
    const byId = new Map(rows.filter(row => row.collection === 'extension').map(row => [row.id, row]));
    const reachable = new Set(), roots = rows.filter(row => !fragmentId(row.id));
    function references(value) {
      if (fragmentId(value)) { visit(value); return; }
      if (value && typeof value === 'object') for (const child of Object.values(value)) references(child);
    }
    function visit(id) {
      if (reachable.has(id)) return;
      const row = byId.get(id);
      requireValue(row, 'retention_reference_invalid', '存在缺失的存储分片，已暂停整理。', 409);
      reachable.add(id);
      const body = db.prepare('SELECT body FROM documents WHERE collection=? AND id=?').get('extension', id).body;
      requireValue(hash(body) === row.hash && hash(body) === id.slice(9), 'retention_reference_invalid', '存储分片校验失败，已暂停整理。', 409);
      references(JSON.parse(body));
    }
    for (const row of roots) {
      requireValue(hash(row.body) === row.hash, 'retention_reference_invalid', '业务记录校验失败，已暂停整理。', 409);
      references(JSON.parse(row.body));
    }
    const fragments = rows.filter(row => row.collection === 'extension' && fragmentId(row.id) && !reachable.has(row.id));
    requireValue(fragments.every(row => row.hash === row.id.slice(9) && row.fragmentFormat === 'guan-app-fragment.v1'),
      'retention_reference_invalid', '发现未知格式的旧记录，已暂停整理。', 409);
    const media = db.prepare('SELECT id,size,content IS NULL AS external FROM media WHERE NOT EXISTS (SELECT 1 FROM document_media WHERE media_id=media.id)').all();
    const signature = hash(JSON.stringify(roots.map(row => [row.collection, row.id, row.hash])));
    return { fragments, media, signature };
  }
  function preview({ mode = 'expired', days = status().policy.days } = {}) {
    active(true);
    requireValue(['expired', 'organize'].includes(mode), 'invalid_cleanup_mode', '整理模式无效。');
    const time = now(), current = inventory(), seen = new Set();
    checkWriteSpace((current.fragments.length + current.media.length) * 200);
    transaction(() => {
      const record = db.prepare('INSERT OR IGNORE INTO storage_retention_items VALUES (?,?,?)');
      for (const [kind, rows] of [['fragments', current.fragments], ['media', current.media]]) for (const row of rows) {
        seen.add(kind + ':' + row.id); record.run(kind, row.id, time);
      }
      for (const row of db.prepare("SELECT kind,id FROM storage_retention_items WHERE kind IN ('fragments','media')").all())
        if (!seen.has(row.kind + ':' + row.id)) db.prepare('DELETE FROM storage_retention_items WHERE kind=? AND id=?').run(row.kind, row.id);
    });
    const since = new Map(db.prepare('SELECT kind,id,since FROM storage_retention_items').all().map(row => [row.kind + ':' + row.id, row.since]));
    const lastUpload = id => Math.max(recentUploads.get(id) || 0, since.get('uploads:' + id) || 0);
    const eligible = (kind, row) => (mode === 'organize' || kind === 'media' && since.has('retired:' + row.id) ||
      since.get(kind + ':' + row.id) <= time - days * RETENTION_DAY) &&
      (kind !== 'media' || time - lastUpload(row.id) >= 15_000);
    const fragments = current.fragments.filter(row => eligible('fragments', row));
    const media = current.media.filter(row => eligible('media', row));
    const fragmentBytes = fragments.reduce((sum, row) => sum + db.prepare('SELECT length(CAST(body AS BLOB)) AS bytes FROM documents WHERE collection=? AND id=?').get('extension', row.id).bytes, 0);
    const mediaBytes = media.reduce((sum, row) => sum + row.size, 0);
    const bytes = fragmentBytes + mediaBytes, id = randomUUID();
    for (const [key, plan] of plans) if (plan.expiresAt < time) plans.delete(key);
    const plan = { id, signature: current.signature, fragments, media, bytes, expiresAt: time + 10 * 60_000 };
    if (plans.size >= 8) plans.delete(plans.keys().next().value);
    plans.set(id, plan);
    return { id, bytes, fragmentBytes, mediaBytes, fragments: fragments.length, media: media.length,
      waiting: current.fragments.length + current.media.length - fragments.length - media.length };
  }
  function verify(id) {
    const plan = plans.get(id);
    requireValue(plan && plan.expiresAt >= now(), 'cleanup_preview_expired', '整理预览已过期，请重新扫描。', 409);
    requireValue(inventory().signature === plan.signature, 'cleanup_preview_changed', '扫描后有内容发生变化，请重新扫描。', 409);
    return plan;
  }
  function execute(id, { recheck = false } = {}) {
    active(true);
    const plan = recheck ? plans.get(id) : verify(id);
    requireValue(plan && plan.expiresAt >= now(), 'cleanup_preview_expired', '整理预览已过期，请重新扫描。', 409);
    const current = inventory(), safeFragments = new Set(current.fragments.map(row => row.id));
    checkWriteSpace(plan.bytes);
    for (const row of plan.media) if (row.external) removeExternal(row.id, true);
    let bytes = 0, fragments = 0, media = 0;
    transaction(() => {
      const remove = db.prepare('DELETE FROM documents WHERE collection=? AND id=? AND hash=?');
      for (const row of plan.fragments) {
        if (!safeFragments.has(row.id)) continue;
        const size = db.prepare('SELECT length(CAST(body AS BLOB)) AS bytes FROM documents WHERE collection=? AND id=?').get('extension', row.id)?.bytes || 0;
        db.prepare('DELETE FROM document_media WHERE collection=? AND document_id=?').run('extension', row.id);
        const result = remove.run('extension', row.id, row.hash);
        fragments += Number(result.changes); if (result.changes) bytes += size;
      }
      for (const row of plan.media) {
        if (now() - Math.max(recentUploads.get(row.id) || 0,
          db.prepare("SELECT since FROM storage_retention_items WHERE kind='uploads' AND id=?").get(row.id)?.since || 0) < 15_000) continue;
        const result = db.prepare('DELETE FROM media WHERE id=? AND NOT EXISTS (SELECT 1 FROM document_media WHERE media_id=?)').run(row.id, row.id);
        if (result.changes) { media++; bytes += row.size; }
      }
      db.prepare("DELETE FROM storage_retention_items WHERE kind='media' AND id NOT IN (SELECT id FROM media)").run();
      db.prepare("DELETE FROM storage_retention_items WHERE kind='uploads' AND id NOT IN (SELECT id FROM media)").run();
      db.prepare("DELETE FROM storage_retention_items WHERE kind='retired' AND id NOT IN (SELECT id FROM media)").run();
      db.prepare("DELETE FROM storage_retention_items WHERE kind='fragments' AND id NOT IN (SELECT id FROM documents WHERE collection='extension')").run();
    });
    for (const row of plan.media) if (row.external && !db.prepare('SELECT 1 FROM media WHERE id=?').get(row.id)) removeExternal(row.id);
    plans.delete(id);
    return { bytes, fragments, media };
  }
  function record(result) {
    active(true);
    checkWriteSpace();
    transaction(() => { save('lastRun', result); if (result.automatic) save('lastAutomaticAt', result.completedAt); });
    return status();
  }
  function unreferencedBytes(ids) {
    return [...new Set(ids)].reduce((sum, id) => sum + (now() - (recentUploads.get(id) || 0) < 15_000 ? 0
      : db.prepare('SELECT size FROM media WHERE id=? AND NOT EXISTS (SELECT 1 FROM document_media WHERE media_id=?)').get(id, id)?.size || 0), 0);
  }
  function compact() {
    active(true);
    checkCompactionSpace();
    requireValue(db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy === 0, 'cleanup_busy', '数据库正在读取，请稍后释放空间。', 409);
    const page = db.prepare('PRAGMA page_size').get().page_size, before = page * db.prepare('PRAGMA page_count').get().page_count;
    db.exec('VACUUM');
    db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    const after = page * db.prepare('PRAGMA page_count').get().page_count;
    return { bytes: Math.max(0, before - after), completedAt: now() };
  }
  function uploaded(ids) {
    const put = db.prepare("INSERT INTO storage_retention_items VALUES ('uploads',?,?) ON CONFLICT(kind,id) DO UPDATE SET since=excluded.since");
    for (const id of ids) { put.run(id, now()); db.prepare("DELETE FROM storage_retention_items WHERE kind IN ('media','retired') AND id=?").run(id); }
  }
  function referencesChanged(previous, next) {
    const before = new Set(previous), after = new Set(next);
    for (const id of [...previous.filter(id => !after.has(id)), ...next.filter(id => !before.has(id))]) {
      if (db.prepare('SELECT 1 FROM document_media WHERE media_id=? LIMIT 1').get(id))
        db.prepare("DELETE FROM storage_retention_items WHERE kind IN ('media','retired') AND id=?").run(id);
      else db.prepare("INSERT OR IGNORE INTO storage_retention_items VALUES ('media',?,?)").run(id, now());
    }
  }
  function retireMedia(ids) {
    active(true); checkWriteSpace();
    transaction(() => {
      const put = db.prepare("INSERT OR IGNORE INTO storage_retention_items VALUES ('retired',?,?)");
      for (const id of ids) put.run(id, now());
    });
  }
  return { status, configure, preview, verify, execute, record, unreferencedBytes, uploaded, referencesChanged, compact, retireMedia };
}
