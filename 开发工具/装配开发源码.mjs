// 根目录源码是唯一维护来源；.运行中的模块仅为可重建的编译/服务输入。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = data => createHash('sha256').update(data).digest('hex');
const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
function inside(root, name) {
  assert.ok(typeof name === 'string' && !isAbsolute(name), '映射路径必须相对项目目录');
  const file = resolve(root, name), rel = relative(root, file);
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), '映射路径不能离开项目目录');
  return file;
}
function writeChanged(file, data) {
  if (existsSync(file) && hash(readFileSync(file)) === hash(data)) return false;
  mkdirSync(dirname(file), { recursive: true });
  const temporary = file + '.装配-' + process.pid;
  writeFileSync(temporary, data); renameSync(temporary, file);
  return true;
}
export function 读取源码映射(root = defaultRoot) {
  return readJSON(join(root, '上游适配/开发源码映射.json'));
}
export function 装配开发源码({ root = defaultRoot, checkOnly = false, activeDirectory, runtimeDirectory, upstreamDirectory } = {}) {
  const mapping = 读取源码映射(root), active = activeDirectory || join(root, '.运行/3100源');
  const runtime = runtimeDirectory || join(root, '.运行/开发版3100'); mkdirSync(runtime, { recursive: true });
  const stateFile = join(runtime, '源码装配.json');
  const previous = existsSync(stateFile) ? readJSON(stateFile) : { 文件: {} };
  const baseline = readJSON(join(root, '上游基线.json'));
  assert.equal(mapping.版本, 1); assert.equal(mapping.基线, baseline.提交);
  const desired = new Map(), origins = new Map();
  for (const item of mapping.文件) {
    assert.ok(/^(扩展功能|界面资源|开发文档)\//.test(item.来源), '未知源码职责目录');
    const source = inside(root, item.来源), target = inside(active, item.目标);
    const data = readFileSync(source);
    if (desired.has(target)) assert.equal(hash(desired.get(target)), hash(data), '装配目标来源冲突：' + item.目标);
    desired.set(target, data); origins.set(target, item);
  }
  // 必须在仓库外应用补丁，避免git从父仓库发现路径后静默跳过文件。
  const scratch = mkdtempSync(join(tmpdir(), '画布接入装配-'));
  try {
    const upstream = upstreamDirectory || resolve(root, baseline.目录);
    for (const item of mapping.接入差异) {
      const data = execFileSync('git', ['show', baseline.提交 + ':' + item.目标], { cwd: upstream, maxBuffer: 20 * 1024 * 1024 });
      assert.equal(hash(data), item.基线SHA256, '上游基线不符：' + item.目标);
      const file = inside(scratch, item.目标); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, data);
    }
    const patches = mapping.接入补丁;
    assert.ok(Array.isArray(patches) && patches.length > 0, '缺少有序小补丁清单');
    for (const item of patches) {
      const patch = inside(root, item.文件);
      if (item.SHA256) assert.equal(hash(readFileSync(patch)), item.SHA256, '补丁内容与清单不符：' + item.文件);
      if (item.前态SHA256) assert.equal(hash(readFileSync(inside(scratch, item.目标))), item.前态SHA256, '补丁前态不符：' + item.文件);
      execFileSync('git', ['apply', '--check', patch], { cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'] });
      execFileSync('git', ['apply', patch], { cwd: scratch, stdio: ['ignore', 'pipe', 'pipe'] });
      if (item.后态SHA256) assert.equal(hash(readFileSync(inside(scratch, item.目标))), item.后态SHA256, '补丁后态不符：' + item.文件);
    }
    for (const item of mapping.接入差异) {
      const target = inside(active, '画布副本/' + item.目标);
      desired.set(target, readFileSync(inside(scratch, item.目标))); origins.set(target, item);
    }
    // 先验证所有目标，再写任何文件；意外手工改动不能被装配静默覆盖。
    for (const [file, data] of desired) {
      if (!existsSync(file)) continue;
      const current = hash(readFileSync(file)), next = hash(data), rel = relative(active, file);
      const known = previous.文件[rel] || origins.get(file)?.原SHA256;
      assert.ok(current === next || current === known, '运行副本有未归并改动，请先保留并归入根目录源码：' + rel);
    }
    const different = [...desired].filter(([file, data]) => !existsSync(file) || hash(readFileSync(file)) !== hash(data));
    if (checkOnly) {
      assert.equal(different.length, 0, '运行副本与权威源码不一致：' + different.map(([file]) => relative(active, file)).join('、'));
      return { 文件: desired.size, 一致: true };
    }
    for (const [file, data] of different) writeChanged(file, data);
    const files = Object.fromEntries([...desired].map(([file, data]) => [relative(active, file), hash(data)]));
    const fingerprint = hash(JSON.stringify(files));
    const state = { 来源: root, 运行副本: active, 指纹: fingerprint, 文件: files };
    writeChanged(stateFile, Buffer.from(JSON.stringify(state, null, 2) + '\n'));
    return { 文件: desired.size, 更新: different.length, 指纹: fingerprint };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
export function 清理旧挂载({ root = defaultRoot } = {}) {
  装配开发源码({ root, checkOnly: true });
  const mapping = 读取源码映射(root);
  const receiptFile = join(root, '.运行/开发版3100/目录归并验收.json');
  assert.ok(existsSync(receiptFile), '原3100验收记录尚未保存，保留全部旧挂载');
  const receipt = readJSON(receiptFile), state = readJSON(join(root, '.运行/开发版3100/源码装配.json'));
  assert.equal(receipt.源码指纹, state.指纹, '验收记录与当前装配不一致');
  assert.equal(receipt.通过, true, '原3100尚未验收通过');
  const old = new Map(mapping.文件.filter(item => item.类型 === '前端').map(item => [item.原位置, item.原SHA256]));
  for (const [name, expected] of old) if (existsSync(inside(root, name))) assert.equal(hash(readFileSync(inside(root, name))), expected, '旧挂载出现后续改动，拒绝清理：' + name);
  const backup = inside(root, mapping.回退 + '/清理前挂载'); let moved = 0;
  for (const [name] of old) {
    const file = inside(root, name);
    if (!existsSync(file)) continue;
    const target = inside(backup, name); mkdirSync(dirname(target), { recursive: true }); renameSync(file, target); moved++;
  }
  // 仅移除空目录；不递归删除任何未列入来源清单的文件。
  function removeEmpty(directory) {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) if (entry.isDirectory()) removeEmpty(join(directory, entry.name));
    try { rmdirSync(directory); } catch { /* 未归并文件继续保留 */ }
  }
  removeEmpty(join(root, '.运行/3100源/画布副本/web/src/guan'));
  return { 清理旧挂载: moved, 可恢复保留: backup };
}
if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] || '装配';
  assert.ok(['装配', '检查', '清理'].includes(mode));
  console.log(JSON.stringify(mode === '清理' ? 清理旧挂载() : 装配开发源码({ checkOnly: mode === '检查' }), null, 2));
}
