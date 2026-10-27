import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export const 源码回退保留数量 = 5;
const 快照名称 = /^源码-[A-Za-z0-9]{6}$/;
const 哈希 = bytes => createHash('sha256').update(bytes).digest('hex');

function 检查目录(path) {
  const info = lstatSync(path);
  assert.ok(info.isDirectory() && !info.isSymbolicLink() && info.uid === process.getuid(), '源码回退目录身份异常，未清理');
  return info;
}

export function 读取源码回退(directory, now = Date.now()) {
  const root = resolve(directory);
  assert.ok(basename(root) === '开发回退' && basename(dirname(root)) === '.运行', '只能轮换指定开发回退目录');
  检查目录(root);
  assert.equal(realpathSync(root), root, '源码回退路径不能经过符号链接');
  const completed = [], incomplete = [];
  for (const item of readdirSync(root, { withFileTypes: true })) {
    if (!快照名称.test(item.name) || !item.isDirectory() || item.isSymbolicLink()) continue;
    const path = join(root, item.name), info = 检查目录(path);
    let bytes;
    try {
      const marker = join(path, '回退说明.json'), markerInfo = lstatSync(marker);
      assert.ok(markerInfo.isFile() && !markerInfo.isSymbolicLink(), '源码快照说明身份异常，未清理');
      bytes = readFileSync(marker);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // 刚开始复制的快照没有完成说明，不参与轮换；一天前中断的旧副本按创建时间清理。
      if (now - info.birthtimeMs >= 24 * 60 * 60_000) incomplete.push({ name: item.name, path, dev: info.dev, ino: info.ino });
      continue;
    }
    const meta = JSON.parse(bytes), time = Date.parse(meta.date);
    assert.ok(typeof meta.date === 'string' && Number.isFinite(time) && typeof meta.restore === 'string', '源码快照说明损坏，未清理');
    completed.push({ name: item.name, path, date: meta.date, time, dev: info.dev, ino: info.ino, markerHash: 哈希(bytes) });
  }
  completed.sort((a, b) => b.time - a.time || b.name.localeCompare(a.name));
  return { root, completed, incomplete };
}

export function 轮换源码回退(directory, { onProgress = () => {} } = {}) {
  const plan = 读取源码回退(directory), kept = plan.completed.slice(0, 源码回退保留数量);
  if (plan.completed.length < 源码回退保留数量) return { retained: kept.map(item => item.name), removed: [], skippedIncomplete: true };
  // 删除前确认最近五份都含完整根来源和运行输入；不以空目录充当可回退版本。
  for (const item of kept) for (const name of ['扩展功能', '上游适配', '开发工具', '3100源']) 检查目录(join(item.path, name));
  const obsolete = [...plan.completed.slice(源码回退保留数量), ...plan.incomplete], removed = [];
  onProgress({ total: obsolete.length, removed: 0 });
  for (const item of obsolete) {
    let info;
    try { info = 检查目录(item.path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    assert.ok(info.dev === item.dev && info.ino === item.ino && dirname(item.path) === plan.root && 快照名称.test(basename(item.path)), '源码快照已发生替换，未清理');
    if (item.markerHash) assert.equal(哈希(readFileSync(join(item.path, '回退说明.json'))), item.markerHash, '源码快照说明已变化，未清理');
    else assert.ok(!readdirSync(item.path).includes('回退说明.json'), '未完成快照已完成，留待下次轮换');
    rmSync(item.path, { recursive: true });
    removed.push(item.name);
    if (removed.length % 25 === 0 || removed.length === obsolete.length) onProgress({ total: obsolete.length, removed: removed.length });
  }
  const remaining = 读取源码回退(directory);
  const report = { at: new Date().toISOString(), limit: 源码回退保留数量, retained: remaining.completed.map(({ name, date, markerHash }) => ({ name, date, markerHash })), removed, incompleteRemoved: plan.incomplete.length };
  const temporary = join(plan.root, '源码轮换记录.json.tmp-' + process.pid);
  writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, join(plan.root, '源码轮换记录.json'));
  return report;
}
