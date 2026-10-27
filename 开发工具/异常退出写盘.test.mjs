import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, statSync, truncateSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openWorkspace } from '../扩展功能/本机存储/SQLite工作区.mjs';
import { createRecoverableShardedApplicationStorage } from '../扩展功能/本机存储/可恢复分片应用存储.mjs';
import { writeState, readState } from '../扩展功能/客户安装/Web安装目录.mjs';
import { 准备私人暂存 } from '../扩展功能/本机服务/私人暂存保护.mjs';
import { 清理中断代理目录 } from '../扩展功能/网络代理/代理运行目录保护.mjs';
import { 执行有界构建命令 } from './有界构建进程.mjs';

const pause = ms => new Promise(done => setTimeout(done, ms));
function temporary(t) { const root = mkdtempSync(join(tmpdir(), '异常退出写盘-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; }
async function deadPid() { const child = spawn(process.execPath, ['-e', '']); const pid = child.pid; await new Promise(done => child.once('exit', done)); return pid; }

test('素材索引失败清本次文件；已存在媒体不删除；中断暂存下次独占打开后回收', t => {
  const root = temporary(t); let fail = false;
  let store = openWorkspace({ dataRoot: root, initialize: true, beforeCommit: () => { if (fail) throw Error('synthetic-failure'); } });
  try {
    const bytes = Buffer.from('new-media'), id = createHash('sha256').update(bytes).digest('hex');
    fail = true; assert.throws(() => store.writeMedia(bytes, 'application/octet-stream'), /synthetic-failure/);
    assert.deepEqual(readdirSync(join(root, '媒体')), []);
    // 以前已经存在的未索引文件保留，避免误删可能需要恢复的数据。
    writeFileSync(join(root, '媒体', id), bytes, { mode: 0o600 });
    assert.throws(() => store.writeMedia(bytes, 'application/octet-stream'), /synthetic-failure/);
    assert.deepEqual(readFileSync(join(root, '媒体', id)), bytes);
    store.close();
    const stage = join(root, '媒体', '.暂存-' + randomUUID()); writeFileSync(stage, 'interrupted', { mode: 0o600 });
    fail = false; store = openWorkspace({ dataRoot: root });
    assert.equal(existsSync(stage), false); assert.deepEqual(readFileSync(join(root, '媒体', id)), bytes);
  } finally { store.close(); }
});
test('手动备份失败不遗留半份数据库和媒体副本', async t => {
  const root = temporary(t), store = openWorkspace({ dataRoot: root, initialize: true });
  try {
    const media = store.writeMedia(Buffer.from('media'), 'application/octet-stream');
    writeFileSync(join(root, '媒体', media.id), 'corrupted');
    await assert.rejects(store.createBackup(), e => e.code === 'media_corrupt');
    assert.deepEqual(readdirSync(join(root, '备份')), []);
  } finally { store.close(); }
});
test('私人配置暂存识别死亡进程并清理，保留活跃写入；残留过多拒绝继续创建', async t => {
  const root = temporary(t), pid = await deadPid();
  const inactive = join(root, `.private-write-${pid}-${randomUUID()}`), active = join(root, `.private-write-${process.pid}-${randomUUID()}`);
  writeFileSync(inactive, 'interrupted'); writeFileSync(active, 'active'); writeFileSync(join(root, '配置.json'), 'keep');
  准备私人暂存(root, 10); assert.equal(existsSync(inactive), false); assert.equal(existsSync(active), true);
  for (let i = 0; i < 15; i++) writeFileSync(join(root, `.private-write-${process.pid}-${randomUUID()}`), 'active');
  assert.throws(() => 准备私人暂存(root, 10), e => e.code === 'private_staging_limit');
  assert.equal(readFileSync(join(root, '配置.json'), 'utf8'), 'keep');
});
test('代理目录只在所有者与守护进程都退出后清理，历史未知目录按容量门禁保护', async t => {
  const root = temporary(t), pid = await deadPid();
  for (const [name, ownerPid, watchdogPid] of [['workbench-proxy-Ab1234', pid, pid], ['workbench-proxy-Cd5678', pid, process.pid]]) {
    const folder = join(root, name); mkdirSync(folder, { mode: 0o700 });
    writeFileSync(join(folder, '代理所有者.json'), JSON.stringify({ ownerPid, watchdogPid }), { mode: 0o600 });
    writeFileSync(join(folder, 'config.yaml'), 'synthetic');
  }
  assert.equal((await 清理中断代理目录(root)).removed, 1);
  assert.deepEqual(readdirSync(root), ['workbench-proxy-Cd5678']);
  const cache = join(root, '未知旧缓存'); writeFileSync(cache, ''); truncateSync(cache, 257 * 1024 ** 2);
  await assert.rejects(清理中断代理目录(root), e => e.code === 'disk_budget_exceeded');
});
test('构建子进程持续写入越过容量上限时停止，退出后不再增长', async t => {
  const root = temporary(t), file = join(root, '增长.bin');
  const script = "const f=require('fs');setInterval(()=>f.appendFileSync(process.argv[1],Buffer.alloc(8192)),10)";
  await assert.rejects(执行有界构建命令(process.execPath, ['-e', script, file], { budgetDirectory: root, maxBytes: 32 * 1024, reserveBytes: 0, intervalMs: 20, timeout: 5000 }), e => e.code === 'disk_budget_exceeded');
  const size = statSync(file).size; await pause(100); assert.equal(statSync(file).size, size);
});
test('构建正常输出可读；超时结束；依赖内部链接不遍历到外部目标', async t => {
  const root = temporary(t), outside = temporary(t); writeFileSync(join(outside, '原文件'), 'keep'); symlinkSync(outside, join(root, '依赖链接'));
  assert.equal((await 执行有界构建命令(process.execPath, ['-e', "process.stdout.write('构建日志')"], { budgetDirectory: root, maxBytes: 1024, reserveBytes: 0 })).toString(), '构建日志');
  await assert.rejects(执行有界构建命令(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { budgetDirectory: root, maxBytes: 1024, reserveBytes: 0, timeout: 100 }), e => e.code === 'build_command_timeout');
  assert.equal(readFileSync(join(outside, '原文件'), 'utf8'), 'keep');
});
test('主构建进程被SIGKILL后，独立守护结束自己的写盘子进程', async t => {
  const root = temporary(t), file = join(root, '增长.bin'), pidFile = join(root, '子进程.json');
  const module = pathToFileURL(resolve('开发工具/有界构建进程.mjs')).href;
  const writer = "const f=require('fs');f.writeFileSync(process.argv[2],String(process.pid));setInterval(()=>f.appendFileSync(process.argv[1],Buffer.alloc(1024)),10)";
  const runner = "const m=await import(process.argv[1]);await m.执行有界构建命令(process.execPath,['-e',process.argv[2],process.argv[3],process.argv[4]],{budgetDirectory:process.argv[5],maxBytes:1048576,reserveBytes:0,intervalMs:20});";
  const parent = spawn(process.execPath, ['--input-type=module', '-e', runner, module, writer, file, pidFile, root], { stdio: 'ignore' });
  t.after(() => { if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL'); });
  for (let i = 0; i < 150 && !existsSync(file); i++) await pause(20);
  assert.equal(existsSync(file), true);
  const ended = new Promise(done => parent.once('exit', done)); parent.kill('SIGKILL'); await ended;
  const pid = Number(readFileSync(pidFile, 'utf8'));
  let running = true;
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') { running = false; break; } throw e; }
    await pause(20);
  }
  assert.equal(running, false);
  const size = statSync(file).size; await pause(100); assert.equal(statSync(file).size, size);
});

test('重复保存相同画布和仅时间变化的画布200次，冷重开后仍不增加文档、操作记录或数据库体积', async t => {
  const root = temporary(t), store = openWorkspace({ dataRoot: root, initialize: true });
  const dbPath = join(root, '工作台.sqlite'), reader = new DatabaseSync(dbPath, { readOnly: true });
  const client = { readDocument: async (...args) => store.readDocument(...args), writeDocument: async value => store.writeDocument(value) };
  const make = () => createRecoverableShardedApplicationStorage({ client });
  const canvas = { state: { projects: [{ id: 'synthetic-product', name: '不变画布', updatedAt: '2026-01-01T00:00:00Z', nodes: [{ id: 'prompt', content: '不变提示词' }] }] }, version: 0 };
  const key = 'infinite-canvas:canvas_store';
  const size = () => ['', '-wal'].reduce((sum, suffix) => sum + (existsSync(dbPath + suffix) ? statSync(dbPath + suffix).size : 0), 0);
  const counts = () => reader.prepare('SELECT (SELECT count(*) FROM documents) AS documents, (SELECT count(*) FROM operations) AS operations').get();
  let app = make();
  try {
    await app.createInstance({ storeName: 'app_state' }).setItem(key, JSON.stringify(canvas)); await app.flush();
    const baseline = counts(), bytes = size();
    for (let round = 0; round < 5; round++) {
      if (round) { app.close(); app = make(); }
      const a = app.createInstance({ storeName: 'app_state' });
      await a.getItem(key);
      for (let i = 0; i < 40; i++) {
        const next = structuredClone(canvas); next.state.projects[0].updatedAt = new Date(Date.UTC(2026, 1, 1, round, i)).toISOString();
        await a.setItem(key, JSON.stringify(next));
      }
      await app.flush(); assert.deepEqual(counts(), baseline); assert.equal(size(), bytes);
    }
    // 真实改动必须保存，去重不能掩盖客户编辑。
    canvas.state.projects[0].nodes[0].content = '客户实际编辑';
    await app.createInstance({ storeName: 'app_state' }).setItem(key, JSON.stringify(canvas)); await app.flush();
    assert.ok(counts().operations > baseline.operations);
    assert.equal(JSON.parse(await app.createInstance({ storeName: 'app_state' }).getItem(key)).state.projects[0].nodes[0].content, '客户实际编辑');
  } finally { app.close(); reader.close(); store.close(); }
});

test('安装状态写入沿用有界原子写；回收过期旧格式，保留新近暂存及原状态，拒绝超大新状态', async t => {
  const root = temporary(t), file = join(root, '当前版本.json');
  const inactive = join(root, '当前版本.json.' + randomUUID()), recent = join(root, '运行地址.json.' + randomUUID());
  writeFileSync(inactive, 'old'); writeFileSync(recent, 'in-flight');
  const old = new Date(Date.now() - 25 * 60 * 60 * 1000); utimesSync(inactive, old, old);
  await writeState(file, { version: 'synthetic' });
  assert.equal(existsSync(inactive), false); assert.equal(readFileSync(recent, 'utf8'), 'in-flight');
  assert.deepEqual(await readState(file), { version: 'synthetic' });
  await assert.rejects(writeState(file, { text: 'x'.repeat(16384) }), e => e.code === 'update_state_invalid');
  assert.deepEqual(await readState(file), { version: 'synthetic' });
  assert.deepEqual(readdirSync(root).sort(), ['当前版本.json', recent.slice(root.length + 1)].sort());
});
