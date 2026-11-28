import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 当前存储基线完整匹配, 当前存储基线包含 } from '../上游适配/SQLite当前存储基线批准.mjs';

const manifest = JSON.parse(readFileSync(new URL('../上游适配/待审查/SQLite当前存储基线.json', import.meta.url), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'sqlite-current-source-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const item of manifest.文件) {
    const path = join(root, item.文件);
    mkdirSync(join(path, '..'), { recursive: true });
    const source = readFileSync(new URL('../' + item.文件, import.meta.url));
    assert.equal(hash(source), item.SHA256, item.文件);
    writeFileSync(path, source);
  }
  const fingerprint = (base, path) => existsSync(join(base, path)) ? hash(readFileSync(join(base, path))) : null;
  return { root, fingerprint };
}

test('当前存储基线整体精确匹配，未修改历史批准文件', t => {
  const f = fixture(t);
  assert.equal(当前存储基线完整匹配(f.root, f.fingerprint), true);
  assert.equal(当前存储基线包含(f.root, manifest.文件[0].文件, f.fingerprint), true);
  assert.equal(当前存储基线包含(f.root, '任意文件.mjs', f.fingerprint), false);
});

test('单文件漂移或不完整基线时整组拒绝', t => {
  const f = fixture(t), item = manifest.文件[1], path = join(f.root, item.文件);
  writeFileSync(path, readFileSync(path, 'utf8') + '\n');
  assert.equal(当前存储基线完整匹配(f.root, f.fingerprint), false);
  assert.equal(当前存储基线包含(f.root, manifest.文件[0].文件, f.fingerprint), false);
  const incomplete = fixture(t);
  rmSync(join(incomplete.root, manifest.文件.at(-1).文件));
  assert.equal(当前存储基线完整匹配(incomplete.root, incomplete.fingerprint), false);
});

test('新基线只记录已提交的正式源码来源，不改变历史 SQLite 清单', () => {
  assert.equal(manifest.依据提交, 'b1a8dccb');
  assert.equal(manifest.文件.length, 19);
  assert.deepEqual(manifest.文件.map(item => item.发布来源), [
    'beta30', 'beta31', 'beta30', 'beta29', 'beta29', '37a76801',
    'beta29', 'beta29', 'beta30', '1f9e04eb', 'beta30', 'beta22', 'beta20', '2026-11-17紧急修复', 'beta30',
    'beta27', 'beta34', 'beta37', 'beta20',
  ]);
});
