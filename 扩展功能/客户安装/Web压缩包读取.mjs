// 沿用原Stable ZIP边界检查，解码后仅向新建版本目录写入；从不调用系统解包器。
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
const MAX_SCAN_BYTES = 32 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
export function readWebArchive(buffer, { trustedRuntime } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_ARCHIVE_BYTES) throw new Error('Release archive exceeds size limit');
  let end = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50 && offset + 22 + buffer.readUInt16LE(offset + 20) === buffer.length) { end = offset; break; }
  }
  if (end < 0) throw new Error('ZIP end record missing');
  const entries = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), start = buffer.readUInt32LE(end + 16);
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6) || buffer.readUInt16LE(end + 8) !== entries || !entries || entries > 20000 || start + size !== end) throw new Error('Unsupported ZIP layout');
  let cursor = start, total = 0;
  const roots = new Set(), names = new Set(), files = new Map();
  for (let index = 0; index < entries; index++) {
    if (cursor + 46 > end || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid ZIP directory');
    const flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10);
    const packedBytes = buffer.readUInt32LE(cursor + 20), bytes = buffer.readUInt32LE(cursor + 24), length = buffer.readUInt16LE(cursor + 28), extra = buffer.readUInt16LE(cursor + 30), comment = buffer.readUInt16LE(cursor + 32);
    const attrs = buffer.readUInt32LE(cursor + 38), local = buffer.readUInt32LE(cursor + 42);
    if (cursor + 46 + length + extra + comment > end || local >= start || (flags & 1) || ![0, 8].includes(method) || buffer.readUInt16LE(cursor + 34)) throw new Error('Unsupported ZIP entry');
    const name = buffer.subarray(cursor + 46, cursor + 46 + length).toString('utf8');
    const segments = name.replace(/\/$/, '').split('/');
    if (!name || /[\\:\x00-\x1f\x7f\ufffd]/.test(name) || segments.some(segment => !segment || segment === '.' || segment === '..')) throw new Error('Unsafe ZIP path');
    const canonical = name.replace(/\/$/, '').normalize('NFC').toLowerCase();
    if (names.has(canonical)) throw new Error('Duplicate ZIP path');
    names.add(canonical); roots.add(segments[0]);
    const type = (attrs >>> 16) & 0o170000;
    if (type && ![0o100000, 0o040000].includes(type)) throw new Error('ZIP links and special files forbidden');
    const runtime = segments.length === 3 && segments.slice(1).join('/') === 'runtime/node' && trustedRuntime;
    if ((name.endsWith('/') && bytes !== 0) || bytes > (runtime ? Math.min(trustedRuntime.runtimeSize, 160 * 1024 * 1024) : MAX_SCAN_BYTES)) throw new Error('ZIP entry exceeds scan limit');
    if (local + 30 > start || buffer.readUInt32LE(local) !== 0x04034b50 || buffer.readUInt16LE(local + 6) !== flags || buffer.readUInt16LE(local + 8) !== method) throw new Error('ZIP local header mismatch');
    const localNameLength = buffer.readUInt16LE(local + 26), localExtraLength = buffer.readUInt16LE(local + 28);
    const bodyStart = local + 30 + localNameLength + localExtraLength;
    if (bodyStart + packedBytes > start || !buffer.subarray(local + 30, local + 30 + localNameLength).equals(buffer.subarray(cursor + 46, cursor + 46 + length))) throw new Error('ZIP local path/body mismatch');
    for (const [offset, extraLength] of [[cursor + 46 + length, extra], [local + 30 + localNameLength, localExtraLength]]) {
      let position = offset;
      while (position < offset + extraLength) {
        if (position + 4 > offset + extraLength) throw new Error('Invalid ZIP extra field');
        const type = buffer.readUInt16LE(position), fieldLength = buffer.readUInt16LE(position + 2);
        if (position + 4 + fieldLength > offset + extraLength || ![0x5455, 0x7875, 0x5855, 0x7075].includes(type)) throw new Error('Unsupported ZIP extra field');
        if (type === 0x7075 && (fieldLength < 5 || buffer.subarray(position + 9, position + 4 + fieldLength).toString('utf8') !== name)) throw new Error('ZIP alternate Unicode path forbidden');
        position += 4 + fieldLength;
      }
    }
    const packed = buffer.subarray(bodyStart, bodyStart + packedBytes);
    const decoded = method === 8 ? inflateRawSync(packed, { maxOutputLength: Math.max(1, bytes) }) : packed;
    if (decoded.length !== bytes) throw new Error('ZIP expansion size mismatch');
    if (runtime && (bytes !== trustedRuntime.runtimeSize || createHash('sha256').update(decoded).digest('hex') !== trustedRuntime.runtimeSha256)) throw Error('Trusted runtime mismatch');
    if (!name.endsWith('/')) files.set(name, { bytes: decoded, executable: Boolean((attrs >>> 16) & 0o111) });
    total += bytes;
    if (total > 512 * 1024 * 1024) throw new Error('ZIP expansion exceeds size limit');
    cursor += 46 + length + extra + comment;
  }
  if (cursor !== end || roots.size !== 1) throw new Error('ZIP must contain exactly one release root');
  return { root: [...roots][0], entries, bytes: total, files };
}

