import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
import { 读取任务确认与设置边界隔离记录 } from './接入任务确认与设置边界隔离副本.mjs';

const evidenceRoot = join(根目录, '开发文档/验收记录/任务确认与设置边界接入');
const browser = join(evidenceRoot, '浏览器原始记录');
function result(label) {
  const files = readdirSync(browser).filter(name => name.endsWith('-' + label + '.log'));
  assert.equal(files.length, 1, '浏览器证据必须唯一：' + label);
  for (const line of readFileSync(join(browser, files[0]), 'utf8').split('\n')) {
    try { const value = JSON.parse(line); if (value && typeof value === 'object') return value; } catch { /* CLI标题等不是结果JSON。 */ }
  }
  throw Error('缺少实际浏览器结果：' + label);
}
const record = 读取任务确认与设置边界隔离记录(join(根目录, '.运行/任务确认与设置边界-curBBR/确认边界接入记录.json'));
const old = result('旧版四状态'), current = result('新版四状态');
for (let index = 0; index < 5; index++) {
  assert.deepEqual(current[index].modal, old[index].modal);
  assert.deepEqual(current[index].mask, old[index].mask);
  if (index < 4) { assert.deepEqual(current[index].body, old[index].body); assert.equal(current[index].topHit, '画布设置'); }
}
const keyboard = result('新版键盘与子层');
assert.equal(keyboard.closed.hidden, true);
assert.deepEqual(keyboard.closed.focus, { tag: 'BUTTON', label: '画布设置' });
assert.equal(keyboard.reopened, true);
const phases = result('确认各阶段失败');
assert.deepEqual(phases.map(value => value.phase), ['list', 'get', 'checkpoint', 'applied']);
for (const phase of phases) assert.ok(phase.calls.every(call => ['list', 'get', 'checkpoint', 'applied'].includes(call.operation)));
const duplicate = result('重复点击与丢ACK');
assert.deepEqual(duplicate.duplicate.calls.map(call => call.operation), ['list', 'get', 'checkpoint']);
assert.equal(duplicate.lost.faults[0].committed, 200);
assert.equal(duplicate.lost.pending, true);
assert.deepEqual(duplicate.final.map(call => call.operation), ['list']);
assert.equal(duplicate.allSubmitIds.length, 1);
const save = result('保存恢复自动确认');
assert.deepEqual(save.calls.map(call => call.operation), ['list', 'get', 'checkpoint', 'applied']);
assert.equal(new Set(save.allSubmitIds).size, 2);
assert.ok(save.rootFaults.some(value => value.namespace === 'app_state' && value.status === 200));
const cold = result('同根冷重开原任务恢复');
assert.deepEqual(cold.calls.map(call => call.operation), ['fallback-load', 'list', 'get', 'checkpoint', 'applied']);
assert.equal(cold.pending, 0);
assert.ok(cold.imageDimensions.length === 6 && cold.imageDimensions.every(value => value.loaded && value.w === 320 && value.h === 240));
const snapshots = readdirSync(join(evidenceRoot, '画布落盘快照')).filter(name => /^画布证据-\d+\.json$/.test(name)).sort().map(name => ({ name, value: JSON.parse(readFileSync(join(evidenceRoot, '画布落盘快照', name))) }));
const jobs = snapshot => snapshot.value.documents.find(value => value.id === 'guan-generation-ledger-v1').value.jobs;
const before = snapshots.find(snapshot => jobs(snapshot).length === 3 && jobs(snapshot).some(job => !job.applied));
const after = snapshots.at(-1);
assert.ok(before); assert.equal(jobs(after).length, 3); assert.ok(jobs(after).every(job => job.state === 'succeeded' && job.applied));
const identity = snapshot => jobs(snapshot).map(job => ({ id: job.id, productId: job.productId, nodeId: job.nodeId, responseHash: job.result.id }));
assert.deepEqual(identity(after), identity(before));
assert.deepEqual(after.value.requests, before.value.requests); assert.equal(after.value.requests.length, 3);
for (const job of jobs(after)) {
  const project = after.value.canvas.state.projects.find(project => project.id === job.productId);
  const node = project.nodes.find(node => node.id === job.nodeId);
  assert.equal(node.metadata.status, 'success');
  assert.ok(node.metadata.gatewayGenerationReceipts.some(receipt => receipt.taskId === job.id && receipt.responseHash === job.result.id));
}
const oldChild = result('旧版子层边界实测'), newChild = result('新版模型子层实测');
assert.deepEqual(oldChild.drawer, { x: 800, y: 84, width: 640, height: 916 });
assert.deepEqual(newChild.drawer, { x: 800, y: 0, width: 640, height: 1000 });
const blocked = readdirSync(browser).find(name => name.endsWith('-确认先守保存ACK.log'));
assert.ok(readFileSync(join(browser, blocked), 'utf8').includes('intercepts pointer events'));
const report = { record, guardTests: { passed: 8, failed: 0 }, diskProtocolTests: { passed: 1, failed: 0 },
  actualDiskTypesPassed: true, actualDiskViteBuildPassed: true,
  taskConfirmationRecovery: { passed: true, failurePhases: ['list', 'get', 'checkpoint', 'applied', 'applied-ack', 'canvas-save-ack'], repeatedClickSingleFlight: true,
    saveRecoveryEventContinuesConfirmation: true, pendingBeforeColdRestart: before.name, afterColdRestart: after.name, identities: identity(after), channelRequests: 3, noChannelRequestDuringRecovery: true },
  settingsMainBoundary: { passed: true, states: current.slice(0, 4), smallerWindow: current[4], escapeAndFocus: keyboard.closed, reopened: true },
  outstanding: [
    { code: 'settings-child-viewport', oldDrawer: oldChild.drawer, newDrawer: newChild.drawer, oldModel: oldChild.dialogs[2], newModel: newChild.dialogs[2] },
    { code: 'local-status-overlap', evidence: blocked, outcome: '保存错误提示挡住确认按钮；先点击真实保存重试可触发确认成功。未绕过命中检查强制点击。' },
  ],
  nonAcceptanceAttempts: ['首轮构建夹具因非交互stdin EOF正常关闭，之后用同指纹构建和交互控制台重开空白临时SQLite', '初次保存故障范围包含图片元数据，尚无卡片收据；收窄到app_state后重新验收真实画布ACK丢失', '等待确认按钮的首次脚本在媒体元数据失败场景超时；该次不计确认恢复通过', '对未选中图片直接寻找生成按钮超时；随后创建空图并明确设置一张，取得第三任务冷重开证据', '首次Esc后立即计数仍含退出动画，后续等待真实隐藏并核验焦点归还'],
  productionTouched: false, keychainAccessed: false, paidCalls: false, published: false,
  browserClosed: true, fixtureClosedNormallyAndKeyZeroed: true,
  allAcceptancePassed: false,
  boundary: '全部渠道为受限合成主机的loopback HTTP映射；未验证公网DNS/TLS、真实Mihomo或收费服务。旧前端后台关闭，旧Fallback内容为空，截图只用于实际容器边界和布局对照。' };
writeFileSync(join(evidenceRoot, '验收汇总.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ taskRecovery: true, mainSettingsBoundary: true, pendingFollowUps: report.outstanding.map(value => value.code), channelRequests: 3, allAcceptancePassed: false }));
