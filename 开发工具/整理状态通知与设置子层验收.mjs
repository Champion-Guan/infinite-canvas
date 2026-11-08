// 从实际磁盘包、浏览器原始记录和SQLite画布快照归档并断言；失败尝试原样保留。
import assert from 'node:assert/strict';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 读取状态通知与设置子层隔离记录 } from './接入状态通知与设置子层隔离副本.mjs';

const output = join(根目录, '开发文档/验收记录/状态通知与设置子层接入');
const browser = join(output, '浏览器原始记录');
const fixture = '/private/var/folders/kz/mjz6y1q970lfz57ldzrpyfnw0000gn/T/guan-status-layer-ui-OUtO2S';
const recordPath = join(根目录, '.运行/状态通知与设置子层-ts2CQG/子层接入记录.json');
if (existsSync(join(output, '验收汇总.json'))) throw Error('拒绝覆盖已归档验收');
cpSync(join(根目录, '.运行/output/playwright/状态通知与设置子层-20261020'), browser, { recursive: true, force: false, errorOnExist: true });
const snapshotsRoot = join(output, '画布落盘快照'); mkdirSync(snapshotsRoot);
for (const name of readdirSync(fixture).filter(name => /^画布证据-\d+\.json$/.test(name))) cpSync(join(fixture, name), join(snapshotsRoot, name), { errorOnExist: true });
for (const name of ['磁盘类型检查.json', '构建依赖.json', '构建指纹.json']) cpSync(join(fixture, name), join(output, name), { errorOnExist: true });
cpSync(recordPath, join(output, '隔离接入记录.json'), { errorOnExist: true });
for (const [from, to] of [['状态通知与设置子层.json', '批准清单.json'], ['状态通知与设置子层.patch', '批准差异.patch']]) cpSync(join(根目录, '上游适配/待审查', from), join(output, to), { errorOnExist: true });
function result(label) {
  const files = readdirSync(browser).filter(name => name.endsWith('-' + label + '.log'));
  assert.equal(files.length, 1, '原始浏览器结果必须唯一：' + label);
  for (const line of readFileSync(join(browser, files[0]), 'utf8').split('\n')) {
    try { const value = JSON.parse(line); if (value && typeof value === 'object') return value; } catch { /* CLI标题及非结果行保留在原件中。 */ }
  }
  throw Error('无可解析结果：' + label);
}
const record = 读取状态通知与设置子层隔离记录(recordPath);
const guard = readFileSync(join(output, '完整包保护.log'), 'utf8');
assert.match(guard, /pass 8/); assert.match(guard, /fail 0/);
const log = readFileSync(join(output, '实际磁盘构建与工作台.log'), 'utf8');
assert.match(log, /STATUS_LAYER_DISK_TYPES_OK/); assert.match(log, /STATUS_LAYER_DISK_BUILD_OK/);
const lint = readFileSync(join(output, '最终代码Lint.log'), 'utf8');
assert.match(lint, /"ownIssues": 0/); assert.match(lint, /"introduced": 0/);
const old = result('旧版可见子层独立测量'), current = result('新版设置完整边界复验');
for (const item of current.filter(item => item.dialogs)) {
  const theme = item.label.includes('浅色') ? '浅色' : '深色';
  const reference = old.find(value => value.theme === theme && value.viewport.width === item.viewport.width && value.viewport.height === item.viewport.height);
  assert.ok(reference);
  assert.deepEqual(item.dialogs.slice(0, Math.min(item.dialogs.length, 2)), reference.dialogs.slice(0, Math.min(item.dialogs.length, 2)));
  assert.deepEqual(item.masks, reference.masks.slice(0, item.masks.length));
  assert.equal(item.topHit, '画布设置');
  if (item.dialogs.length === 3) {
    const a = item.dialogs[2], b = reference.dialogs[2];
    assert.equal(a.x, b.x); assert.equal(a.width, b.width);
    assert.equal(a.y + a.height / 2, b.y + b.height / 2);
    assert.equal(b.height - a.height, 4); assert.ok(a.y >= 84 && a.y + a.height <= item.viewport.height);
  }
}
for (const item of current.filter(item => item.keyboard)) assert.deepEqual(item.keyboard, { modelFocus: true, drawerFocus: true, mainFocus: true });
const longList = result('长模型列表可滚动复验');
for (const item of longList) {
  assert.equal(item.mask.y, 84); assert.equal(item.mask.height, item.viewport.height - 84);
  assert.ok(Math.abs(parseFloat(item.body.maxHeight) - (item.viewport.height - 84) * 0.62) < 0.01);
  assert.ok(item.body.scrollHeight > item.body.clientHeight);
  assert.ok(item.dialog.y >= 84 && item.dialog.y + item.dialog.height <= item.viewport.height);
}
const dual = result('正确临时存储双提示');
assert.equal(dual.save.y - dual.confirmation.y - dual.confirmation.height, 12);
assert.ok(dual.faults.some(item => item.namespace === 'app_state' && item.status === 200));
const pointer = result('普通点击确认仍守保存ACK');
assert.equal(pointer.clicked, true); assert.equal(pointer.pending, 1);
assert.deepEqual(pointer.calls.map(item => item.operation), ['list']);
const recovery = result('过期租约键盘重连并恢复确认');
assert.equal(recovery.keyboardActivation, true); assert.equal(recovery.pending, 0); assert.equal(recovery.savedText, '已保存到本机');
assert.deepEqual(recovery.calls.map(item => item.operation), ['list', 'get', 'checkpoint', 'applied']);
for (const item of recovery.layouts) {
  assert.equal(item.save.y - item.confirmation.y - item.confirmation.height, 12);
  assert.ok(item.region.y >= 84 && item.region.y + item.region.height <= item.viewport.height - 19.99);
  assert.ok(item.region.width <= item.viewport.width - 40);
  if (item.viewport.height === 300) assert.ok(item.scroll.scrollHeight > item.scroll.clientHeight);
}
const second = result('第二任务真实丢保存ACK'), saved = result('保存ACK恢复但保留第二任务待确认');
assert.equal(second.submitted.length, 2); assert.equal(second.faults.length, 2);
assert.deepEqual(saved.calls.map(item => item.operation), ['list', 'get', 'checkpoint', 'applied']);
const cold = result('同根冷重开仅确认原任务');
assert.deepEqual(cold.calls.map(item => item.operation), ['fallback-load', 'list', 'get', 'checkpoint', 'applied']);
assert.equal(cold.pending, 0); assert.equal(cold.images.length, 4);
assert.ok(cold.images.every(item => item.loaded && item.w === 320 && item.h === 240));
const snapshots = readdirSync(snapshotsRoot).sort().map(name => ({ name, value: JSON.parse(readFileSync(join(snapshotsRoot, name))) }));
const jobs = value => value.documents.find(item => item.id === 'guan-generation-ledger-v1').value.jobs;
const before = snapshots.find(item => jobs(item.value).length === 2 && jobs(item.value).some(job => !job.applied));
const after = snapshots.at(-1), firstSaved = snapshots.find(item => jobs(item.value).length === 1 && jobs(item.value)[0].applied);
assert.ok(before && firstSaved);
assert.equal(firstSaved.value.requests.length, 1); assert.equal(after.value.requests.length, 2);
assert.ok(jobs(after.value).every(job => job.applied && job.state === 'succeeded'));
function identities(value) {
  return jobs(value).map(job => {
    const project = value.canvas.state.projects.find(project => project.id === job.productId);
    const node = project.nodes.find(node => node.id === job.nodeId);
    assert.equal(node.metadata.status, 'success');
    assert.ok(node.metadata.gatewayGenerationReceipts.some(item => item.taskId === job.id && item.responseHash === job.result.id));
    return { id: job.id, productId: job.productId, nodeId: job.nodeId, responseHash: job.result.id,
      images: node.metadata.images.map(image => ({ id: image.id, storageKey: image.storageKey, width: image.naturalWidth, height: image.naturalHeight, bytes: image.bytes })) };
  });
}
assert.deepEqual(identities(after.value), identities(before.value));
assert.deepEqual(after.value.requests, before.value.requests);
const retainedErrors = after.value.canvas.state.projects.flatMap(project => project.nodes.flatMap(node => (node.metadata?.images || []).filter(image => image.status === 'success' && image.errorDetails).map(image => ({ nodeId: node.id, imageId: image.id, errorDetails: image.errorDetails }))));
const report = { record, guardTests: { passed: 8, failed: 0 }, actualDiskTypesPassed: true, actualDiskViteBuildPassed: true,
  lint: { ownFiles: 13, ownIssues: 0, candidateIntroduced: 0 },
  settings: { mainAndDrawerAndMasksMatch: true, reference: old, actual: current, longList, modelContentHeightDifference: 4, modelCenterMatches: true },
  dualNotice: { realClick: pointer, ordinaryLayout: dual, narrowLayouts: recovery.layouts, keyboardReconnect: recovery,
    keyboardEvidence: 'Tab诊断从保存按钮开始会回到页面；正确路径从任务确认到保存重试，Enter触发真实请求。首次保存重试遇到租约到期，随后Enter激活重新连接并保存并完成原任务确认。' },
  recovery: { channelRequests: 2, noChannelRequestDuringRecovery: true, identities: identities(after.value), cold,
    beforeColdRestart: before.name, afterColdRestart: after.name },
  nonAcceptanceAttempts: ['旧版保留的零尺寸dialog使连续关闭脚本误选不可见子层，失败原始日志保留；最终只读测量可见子层完成四尺寸浅深色对照',
    '长列表首轮的动态last()在关闭模型后转指抽屉而超时；后用稳定的模型名称复验',
    '提示词首轮错误使用textarea定位；改为真实contenteditable输入后生成',
    '首次故障仅匹配页面端口，未覆盖独立存储端口，不计双提示通过；明确绑定本轮存储端口与工作区后实测真实200提交再丢ACK',
    '首轮Tab从保存按钮向后遍历，未到任务确认；诊断后按实际焦点顺序验证',
    '键盘保存恢复首次遇到租约过期；保留失败，随后由真实重新连接并保存入口完成恢复'],
  outstandingOutsideSixFiles: [
    { code: 'model-price-input', detail: '旧模型选择和渠道行包含价格（可选）输入，新版仍缺少该字段；本批只处理视区定位。旧静态index-Dt8DX3r-.js的SHA256为a0ec4d4679a3f8916fd7fdf6b489b6514155995a1c1522cb3f1dff433c5f601a。' },
    { code: 'successful-image-retains-error-details', detail: '成功图片仍保留此前保存失败的errorDetails字段；当前显示及确认成功，此字段清理不在已批准六文件中。', items: retainedErrors },
    { code: 'full-legacy-business-and-browser-zoom', detail: '旧后台关闭，Fallback等只比较真实容器；公网DNS/TLS、真实Mihomo、收费服务及真实浏览器页面缩放未据此宣称验收。' },
  ],
  approvedSixFileAcceptancePassed: true, entireMigrationComplete: false,
  productionTouched: false, keychainAccessed: false, paidCalls: false, published: false,
  fixtureBoundary: '仅合成主机的最后HTTPS一跳映射到本机HTTP；新临时SQLite和随机内存主密钥；正式3100未切换。' };
writeFileSync(join(output, '验收汇总.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const paths = ['上游适配/状态通知与设置子层批准.mjs', '开发工具/接入状态通知与设置子层隔离副本.mjs', '开发工具/状态通知与设置子层隔离保护.test.mjs', '开发工具/状态通知与设置子层原工作台夹具.mjs', '开发工具/状态通知与设置子层浏览器命令.mjs', '开发工具/状态通知与设置子层旧版浏览器命令.mjs', '开发工具/状态通知与设置子层设置验收.mjs', '开发工具/检查状态通知与设置子层接入代码.mjs', '开发工具/整理状态通知与设置子层验收.mjs'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
writeFileSync(join(output, '工具指纹.json'), JSON.stringify(paths.map(path => ({ path, SHA256: sha(readFileSync(join(根目录, path))) })), null, 2) + '\n', { flag: 'wx' });
const files = [];
function visit(path = '') {
  for (const name of readdirSync(join(output, path)).sort()) {
    const relative = path ? path + '/' + name : name, file = join(output, relative), stat = lstatSync(file);
    assert.ok(!stat.isSymbolicLink());
    if (stat.isDirectory()) visit(relative);
    else { assert.ok(stat.isFile() && stat.nlink === 1); files.push({ path: relative, bytes: stat.size, SHA256: sha(readFileSync(file)) }); }
  }
}
visit(); writeFileSync(join(output, '归档指纹.json'), JSON.stringify(files, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ approvedSixFileAcceptancePassed: true, entireMigrationComplete: false, channelRequests: 2, archiveFiles: files.length, outstanding: report.outstandingOutsideSixFiles.map(item => item.code) }));
