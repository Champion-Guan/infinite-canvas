import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readPrivateFile } from './runtime-paths.mjs';

// Only a verified installation transaction may write this native setting.
// No HTTP/IPC parameter can select a service address. Existing installations
// stay at 8888 until their browser copy has been independently verified.
export async function stableServiceOrigin(privateRoot) {
  const raw = await readPrivateFile(path.join(privateRoot, 'installation/service-origin.json'), { maxBytes: 4096 });
  if (raw === null) return 'http://127.0.0.1:8888';
  let value; try { value = JSON.parse(raw); } catch { throw Error('update_origin_record_invalid'); }
  if (value?.format !== 1 || !['http://127.0.0.1:8888', 'http://127.0.0.1:3000'].includes(value.origin)
    || Object.keys(value).some(key => !['format', 'origin', 'migration'].includes(key))) throw Error('update_origin_record_invalid');
  if (value.origin.endsWith(':8888')) return value.origin;
  if (!/^localhost-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value.migration || '')) throw Error('update_origin_record_invalid');
  const directory = path.join(privateRoot, 'backups', value.migration);
  const receipt = JSON.parse(await readPrivateFile(path.join(directory, 'MIGRATION.json'), { maxBytes: 4096 }));
  if (receipt.phase !== 'browser-verified' || receipt.exportMode !== 'top-level' || receipt.target !== 'http://localhost:3000'
    || !['http://localhost:8888', 'http://127.0.0.1:8888'].includes(receipt.source)) throw Error('update_origin_record_invalid');
  for (const [file, digest] of [['browser-127.json', receipt.sha256], ['browser-localhost-before.json', receipt.targetSha256],
    ['browser-localhost-merged.json', receipt.mergedSha256]]) {
    if (!/^[a-f0-9]{64}$/.test(digest || '') || createHash('sha256').update(await readFile(path.join(directory, file))).digest('hex') !== digest)
      throw Error('update_origin_record_invalid');
  }
  return value.origin;
}
