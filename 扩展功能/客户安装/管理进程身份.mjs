import { execFileSync } from 'node:child_process';

export function processIdentity(pid) {
  try { return { pid, command: execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim(),
    started: execFileSync('/bin/ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8' }).trim() }; } catch { return null; }
}
export function ownedProcess(record) {
  if (!Number.isSafeInteger(record?.pid)) return false;
  const current = processIdentity(record.pid);
  return Boolean(current && current.command === record.command && current.started === record.started);
}
