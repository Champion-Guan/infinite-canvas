import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { 根目录 } from './公共.mjs';

assert.equal(process.argv.length, 3);
const output = resolve(process.argv[2]);
assert.ok(output.startsWith(join(根目录, '.运行/output/阶段6最终收口-')));
const read = name => JSON.parse(readFileSync(join(output, name), 'utf8'));
const original = read('补充界面复验.json');
const cold = read('冷重开补测.json');
assert.deepEqual(original.results.map(item => item.passed), [true, true, true, true, true, true]);
assert.deepEqual(cold.results.map(item => item.passed), [true, true]);
assert.deepEqual(original.blocked, ['浏览器步骤失败：记录原画布路由']);
assert.equal(cold.blocked.length, 0);
const report = {
  passed: true,
  date: new Date().toISOString(),
  batches: [
    { name: '补充UI真实操作', passed: true, results: original.results, note: '原报告的失败只发生在记录路由的Node侧夹具；六项业务断言已全部通过，原报告原样保留。' },
    { name: '独立浏览器冷重开补测', passed: true, results: cold.results, note: '修正夹具后单独验证保存、正常停服、换端口冷重开、媒体解码。' },
  ],
  historicalFixtureFailure: original.blocked[0],
  scope: '真实原React UI和SQLite隔离副本；不代表3100重启、旧数据迁移、外部服务或真实凭据验收。',
  sourceReports: ['补充界面复验.json', '冷重开补测.json'],
};
writeFileSync(join(output, '补充界面最终汇总.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ passed: true, batches: report.batches.length, results: 8 }));
