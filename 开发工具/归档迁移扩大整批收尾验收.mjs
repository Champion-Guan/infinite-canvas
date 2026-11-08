import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { 根目录 } from './公共.mjs';

// 只读已关闭的合成验收现场；不启动服务、不访问正式工作区、不补写任务状态。
const source = '/private/var/folders/kz/mjz6y1q970lfz57ldzrpyfnw0000gn/T/guan-finish-ui-TgcBJr';
const output = join(根目录, '开发文档/验收记录/迁移扩大整批收尾接入');
assert(!existsSync(output), '验收归档必须全新，不能覆盖历史');
const read = name => JSON.parse(readFileSync(join(source, name)));
const jobs = e => e.documents.find(d => d.id === 'guan-generation-ledger-v1').value.jobs;
const byId = (e, id) => jobs(e).find(j => j.id === id);
const pngHash = '6b1048f8a6d40bac0b2954c18fefa40c4ea7a96120fc2e54b7317c0e43c2bbec';
const referenceHash = '22b0ea00ce8a9c1163d9fdcca903db75ae77b5a11bdc2cc4c33108c114472f77';
const first = read('画布证据-1792506058254.json');
assert.equal(first.requests.length, 2);
assert.deepEqual(first.requests.map(r => r.status), [429, 200]);
assert.equal(jobs(first)[0].applied, true);
const reference = read('画布证据-1792506575337.json');
assert.deepEqual(reference.requests.slice(-2).map(r => [r.path, r.status, r.referenceImages, r.references[0].SHA256]),
  [['/v1/images/edits', 429, 1, referenceHash], ['/v1/images/edits', 200, 1, referenceHash]]);
assert.equal(jobs(reference).at(-1).applied, true);
const beforeBatch = read('画布证据-1792506951472.json');
const afterBatch = read('画布证据-1792507005871.json');
const added = jobs(afterBatch).filter(j => !jobs(beforeBatch).some(old => old.id === j.id));
assert.equal(added.length, 2);
assert.equal(afterBatch.requests.length - beforeBatch.requests.length, 4);
assert.equal(afterBatch.maxActive, 2);
assert(added.every(j => j.state === 'succeeded' && j.applied));
const failed = read('画布证据-1792507069577.json');
const retried = read('画布证据-1792507103459.json');
const retryId = 'da152067-209c-4201-a559-a53421c61c2a';
assert.equal(byId(failed, retryId).reason, 'result_save_unconfirmed');
assert.equal(failed.status.generation.unpersistedResults, 1);
assert.equal(byId(retried, retryId).state, 'succeeded');
assert.equal(byId(retried, retryId).applied, true);
assert.equal(retried.status.generation.unpersistedResults, 0);
assert.equal(retried.requests.length, failed.requests.length);
assert.equal(jobs(retried).length, jobs(failed).length);
const beforeRestart = read('画布证据-1792507226500.json');
const afterRestart = read('画布证据-1792507243762.json');
const final = read('画布证据-1792507313313.json');
function semantic(canvas) {
  const value = structuredClone(canvas);
  for (const project of value.state.projects) {
    delete project.updatedAt;
    for (const node of project.nodes) {
      if (node.metadata?.storageKey) delete node.metadata.content;
      // 恢复器为上传的单图补上 images:[]，空列表与未定义均表示没有批次槽位。
      if (node.metadata?.images?.length === 0) delete node.metadata.images;
      for (const image of node.metadata?.images || []) if (image.storageKey) delete image.content;
    }
  }
  return value;
}
assert.deepEqual(semantic(afterRestart.canvas), semantic(beforeRestart.canvas));
assert.deepEqual(jobs(afterRestart), jobs(beforeRestart));
assert.deepEqual(afterRestart.requests, beforeRestart.requests);
assert.equal(final.requests.length, 14);
assert.equal(final.canvas.state.projects[0].nodes.length, 13);
assert.equal(final.status.generation.running, 0);
assert.equal(final.status.generation.unpersistedResults, 0);
const retainedId = '4e0bc0d2-0272-423b-82c4-27815fdf7f1a';
assert.equal(byId(final, retainedId).state, 'succeeded');
assert.equal(byId(final, retainedId).applied, false);
const downloaded = join(根目录, '.运行/output/playwright/迁移扩大整批收尾-20261020/实际下载生成图.png');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(readFileSync(downloaded)), pngHash);
assert.equal(readFileSync(downloaded).length, 68);
assert(readFileSync('/tmp/guan-finish-final-guard.log', 'utf8').includes('FINISH_COMPLETE_PACKAGE_OK'));

mkdirSync(output);
mkdirSync(join(output, '画布证据'));
for (const name of readdirSync(source).filter(n => /^画布证据-\d+\.json$/.test(n)))
  cpSync(join(source, name), join(output, '画布证据', name), { errorOnExist: true, force: false });
for (const name of ['磁盘类型检查.json', '构建依赖.json', '构建指纹.json'])
  cpSync(join(source, name), join(output, name), { errorOnExist: true, force: false });
// 按现行磁盘保留规则，只归档小型验收证据，不再复制合成数据库和其备份。
cpSync(join(根目录, '.运行/output/playwright/迁移扩大整批收尾-20261020'), join(output, '浏览器'), { recursive: true, errorOnExist: true, force: false });
for (const name of ['旧Fallback浅色.png', '旧Fallback深色.png', '旧代理浅色.png', '旧代理深色.png']) {
  const file = join(根目录, '.运行/output/playwright/迁移扩大整批-20261020', name);
  if (existsSync(file)) cpSync(file, join(output, name), { errorOnExist: true, force: false });
}
for (const file of ['/tmp/guan-finish-guard.log', '/tmp/guan-finish-disk.log', '/tmp/guan-finish-tools-final-lint.log',
  '/tmp/guan-finish-ui.log', '/tmp/guan-finish-assembly.log', '/tmp/guan-finish-before.log', '/tmp/guan-finish-final-guard.log', '/tmp/guan-finish-cleanup.log'])
  cpSync(file, join(output, basename(file)), { errorOnExist: true, force: false });
cpSync('/var/folders/kz/mjz6y1q970lfz57ldzrpyfnw0000gn/T/guan-finish-disk-CU0aEl/验收证据.json', join(output, '实际磁盘HTTP回归证据.json'), { errorOnExist: true, force: false });
const summary = {
  date: '2026-10-20', approvedFiles: 5,
  patchSHA256: 'c6ac07e02b4af913067bc6c8e500cfa9f49920e90e8890716f0149b9c5f48b03',
  manifestSHA256: '1e16eb142fdd72452364e6718d2752652917a08e9f490cbb55380ba7cf6e2761',
  integrationRecord: join(根目录, '.运行/迁移扩大整批收尾-dhB3YW/收尾接入记录.json'),
  allAcceptancePassed: false,
  results: { guardAndDecoderTestsPassed: 12, actualDiskRegressionPassed: 1, diskTypes: true, viteBuild: true,
    helperLint: { files: 6, errors: 0, warnings: 0 },
    imageGenerationSaveAndDecode: true, multipartReferenceHash: referenceHash,
    batchNewTasks: 2, batchChannelRequests: 4, duplicateBatchClickAddedExtraTasks: false, observedMaxActive: 2,
    saveOnlyRetry: { taskId: retryId, requestsBefore: 14, requestsAfter: 14, applied: true },
    coldReopenSemanticStateEqual: true, coldReopenNormalization: ['持久媒体的临时Blob URL', '产品更新时间', '空批次槽位列表与未定义'],
    coldReopenTasksEqual: true, coldReopenChannelRequestsUnchanged: true,
    download: { method: 'keyboard', bytes: 68, SHA256: pngHash },
    finalNodes: 13, finalJobs: 7, finalAppliedJobs: 6, finalChannelRequests: 14,
    finalRunning: 0, finalUnpersistedResults: 0,
    fixedModalRect: { x: 230, y: 92, width: 980, height: 816 },
    isolatedServiceClosedNormally: true, isolatedBrowserClosed: true, daily3100UnchangedPID: 28335 },
  retainedIssue: { taskId: retainedId, state: 'succeeded', applied: false,
    description: '叠加媒体写入失败与画布保存未确认后，图片和收据已落盘且可恢复，但任务应用标记未完成；成功图片缺少仅确认入口。未补写账本，根因和具体后继待审。' },
  boundaries: ['合成渠道仅通过进程内HTTPS钩子转到随机loopback；不是公网DNS/TLS或真实收费渠道验收。',
    '生成返回合成1px PNG；真实浏览器解码、保存、重开和键盘下载已验证，鼠标悬停下载未通过几何定位。',
    '旧设置基于916px高iframe，新设置基于1000px整页；固定高度与文案通过，遮罩和居中边界尚未一致。',
    '原67批与251项历史测试未全量重跑，历史allAcceptancePassed:false报告保留。',
    '只归档合成SQLite，随机主密钥已清零；不读取正式工作区或真实凭据。']
};
writeFileSync(join(output, '接入验收汇总.json'), JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
const inventory = [];
function walk(root, prefix = '') {
  for (const name of readdirSync(root).sort()) {
    const relative = prefix ? prefix + '/' + name : name, file = join(root, name);
    const stat = lstatSync(file);
    if (stat.isDirectory()) walk(file, relative);
    else { assert(stat.isFile() && !stat.isSymbolicLink()); inventory.push({ file: relative, SHA256: hash(readFileSync(file)) }); }
  }
}
walk(output);
writeFileSync(join(output, '归档指纹.json'), JSON.stringify(inventory, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, verified: true, allAcceptancePassed: false, archivedFiles: inventory.length }));
