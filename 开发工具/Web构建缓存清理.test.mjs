import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { 清理Web构建缓存, 清理Web构建临时依赖, 清理Web失败构建 } from './清理Web构建缓存.mjs';

test('清缓存保留安装包、客户运行依赖和装配源码；重复运行无损；摘要错误拒绝清理', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), '构建缓存验证-')));
  const output = join(root, 'Web客户包/构建-Ab1234'), stage = join(output, '安装内容');
  const deps = join(output, '装配来源/画布副本/web/node_modules'), runtime = join(stage, 'node_modules');
  try {
    for (const folder of [deps, runtime]) mkdirSync(folder, { recursive: true });
    const archive = join(output, '安装包.zip'), bytes = Buffer.from('synthetic-verified-archive');
    writeFileSync(archive, bytes); writeFileSync(join(runtime, '客户依赖'), 'keep');
    writeFileSync(join(output, '装配来源/画布副本/web/源码.ts'), 'keep');
    const descriptor = { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    writeFileSync(join(output, '构建结果.json'), JSON.stringify({ archive, stage, descriptor }));
    assert.deepEqual(清理Web构建缓存(output).removed, ['装配来源/画布副本/web/node_modules']);
    assert.equal(existsSync(deps), false); assert.equal(readFileSync(join(runtime, '客户依赖'), 'utf8'), 'keep');
    assert.equal(readFileSync(join(output, '装配来源/画布副本/web/源码.ts'), 'utf8'), 'keep');
    assert.throws(() => 清理Web失败构建(output));
    assert.deepEqual(readFileSync(archive), bytes); assert.deepEqual(清理Web构建缓存(output).removed, []);
    mkdirSync(deps); writeFileSync(archive, Buffer.from('corrupt'));
    assert.throws(() => 清理Web构建缓存(output)); assert.equal(existsSync(deps), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('失败构建清除临时依赖及半成品，仅保留失败记录', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), '失败构建清理验证-')));
  const output = join(root, 'Web客户包/构建-Ab1234');
  try {
    const names = ['装配来源/画布副本/web/node_modules', '构建缓存', 'Swift缓存'];
    for (const name of names) mkdirSync(join(output, name), { recursive: true });
    writeFileSync(join(output, '装配来源/画布副本/web/源码.ts'), 'keep');
    assert.deepEqual(清理Web构建临时依赖(output), names);
    assert.equal(readFileSync(join(output, '装配来源/画布副本/web/源码.ts'), 'utf8'), 'keep');
    清理Web失败构建(output);
    assert.equal(existsSync(output), false);
    assert.equal(existsSync(join(root, 'Web客户包/构建失败记录.jsonl')), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
