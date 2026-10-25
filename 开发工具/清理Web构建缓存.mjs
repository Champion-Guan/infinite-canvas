import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { 创建有界运行日志 } from '../扩展功能/本机服务/有界运行日志.mjs';
import { fileURLToPath } from 'node:url';

function 核对构建目录(output) {
  output = resolve(output);
  assert.match(basename(output), /^构建-[A-Za-z0-9]{6}$/);
  assert.equal(basename(dirname(output)), 'Web客户包');
  assert.equal(realpathSync(output), output, '拒绝经过链接的构建目录');
  return output;
}

// 同一构建结束（包括失败）后清理；不删除安装暂存区中的客户运行依赖。
export function 清理Web构建临时依赖(output) {
  output = 核对构建目录(output);
  const names = ['装配来源/画布副本/web/node_modules', '构建缓存', 'Swift缓存'];
  const removed = [];
  for (const name of names) {
    const target = join(output, name);
    if (!existsSync(target)) continue;
    assert.equal(realpathSync(target), target, '拒绝清理经过链接的缓存');
    assert.ok(lstatSync(target).isDirectory());
    rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); removed.push(name);
  }
  if (removed.length) writeFileSync(join(output, '临时依赖清理.json'), JSON.stringify({ at: new Date().toISOString(), removed }, null, 2) + '\n', { mode: 0o600 });
  return removed;
}

export function 清理Web失败构建(output) {
  output = 核对构建目录(output);
  assert.ok(!existsSync(join(output, '构建结果.json')), '完整客户包不按失败构建清理');
  const report = { at: new Date().toISOString(), directory: basename(output), result: 'failed-build-removed' };
  rmSync(output, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  创建有界运行日志(join(dirname(output), '构建失败记录.jsonl'), { maxBytes: 64 * 1024, files: 2 }).write(JSON.stringify(report) + '\n');
  return report;
}

// 保留 ZIP、签名、暂存安装内容和装配源码；清理已完成构建前再次核验 ZIP。
export function 清理Web构建缓存(output) {
  output = 核对构建目录(output);
  const result = JSON.parse(readFileSync(join(output, '构建结果.json')));
  assert.equal(dirname(result.archive), output);
  assert.equal(dirname(result.stage), output);
  for (const file of [result.archive, result.stage]) assert.ok(!lstatSync(file).isSymbolicLink());
  const archive = readFileSync(result.archive);
  assert.equal(archive.length, result.descriptor.size);
  assert.equal(createHash('sha256').update(archive).digest('hex'), result.descriptor.sha256, '安装包摘要不符，保留所有文件');
  const removed = 清理Web构建临时依赖(output);
  const report = { at: new Date().toISOString(), version: result.version, archiveSHA256: result.descriptor.sha256, removed };
  if (removed.length) writeFileSync(join(output, '临时缓存清理.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  return report;
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  for (const output of process.argv.slice(2)) console.log(JSON.stringify({ output, ...清理Web构建缓存(output) }));
}
