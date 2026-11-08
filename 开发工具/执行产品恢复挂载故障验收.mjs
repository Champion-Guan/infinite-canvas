import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';

const mode = process.argv[2];
if (!['根拒绝', '丢失ACK', '偏好拒绝', '原址恢复'].includes(mode)) throw Error('仅接受本轮隔离故障');
// 通过既有 CLI 操作真实页面；只拦截临时服务请求，不替换业务 store/host。
async function scenario(page, mode) {
  const aSurface = page.locator('div[data-product-id="restore-product-A"][data-product-active]');
  const bSurface = page.locator('div[data-product-id="restore-product-B"][data-product-active]');
  const close = page.getByRole('button', { name: '关闭', exact: true });
  if (await close.isVisible()) await close.click();
  await page.getByRole('tab', { name: '隔离产品A', exact: true }).hover();
  await page.getByRole('button', { name: '删除隔离产品A及对应画布', exact: true }).click();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.waitForURL('**/canvas/restore-product-B');
  const bInstance = await bSurface.elementHandle();
  await page.getByRole('banner', { name: '工作台顶栏' }).getByRole('button', { name: '产品回收站', exact: true }).click();
  let reached, release, triggered = false, operationId;
  const seen = new Promise(resolve => { reached = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const logs = [], target = mode === '偏好拒绝' ? 'preferences' : 'app_state';
  const handler = async route => {
    const request = route.request();
    if (request.method() !== 'PUT') return route.continue();
    const body = request.postDataJSON();
    if (body?.value?.format !== 'guan-app-storage.v2') return route.continue();
    const record = { namespace: body.value.namespace, operationId: body.operationId, expectedRevision: body.expectedRevision };
    logs.push(record);
    if (!triggered && body.value.namespace === target && await page.getByRole('tab', { name: '隔离产品A', exact: true }).count()) {
      triggered = true; operationId = body.operationId; record.injected = mode; reached();
      await hold;
      if (mode === '丢失ACK') {
        const response = await route.fetch();
        if (response.status() !== 200) throw Error('落盘响应不是200');
        const ack = await response.json();
        record.realAck = { persisted: ack.persisted, operationId: ack.operationId, revision: ack.revision, hash: ack.hash };
      }
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'isolated_save_rejected', message: '隔离验收：' + mode } }) });
    }
    if (body.operationId === operationId) {
      const response = await route.fetch();
      const ack = await response.json();
      record.retryAck = { persisted: ack.persisted, operationId: ack.operationId, revision: ack.revision, hash: ack.hash };
      return route.fulfill({ response });
    }
    return route.continue();
  };
  await page.route('**/documents/extension/*', handler);
  try {
    await page.getByRole('button', { name: '恢复', exact: true }).click();
    let timer;
    try { await Promise.race([seen, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('未命中目标恢复根')), 8000); })]); }
    finally { clearTimeout(timer); }
    const beforeAck = { url: page.url(), mountedA: await aSurface.count(), bInstancePreserved: await bInstance.evaluate(el => el.isConnected),
      activeB: await bSurface.getAttribute('data-product-active'), newDisabled: await page.getByRole('button', { name: '新建产品', exact: true }).isDisabled(), closeDisabled: await close.isDisabled() };
    if (beforeAck.mountedA !== 0 || !beforeAck.bInstancePreserved || beforeAck.activeB !== 'true' || !beforeAck.newDisabled || !beforeAck.closeDisabled) throw Error('确认前挂载或忙状态不符：' + JSON.stringify(beforeAck));
    release();
    await page.getByRole('alert').filter({ hasText: '隔离验收：' + mode }).waitFor();
    const rejected = { url: page.url(), mountedA: await aSurface.count(), alerts: await page.getByRole('alert').allTextContents() };
    if (rejected.mountedA !== 0 || !rejected.url.endsWith('/canvas/restore-product-B')) throw Error('拒绝后提前挂载或导航');
    await page.getByRole('button', { name: '重试保存后继续', exact: true }).click();
    await page.waitForURL('**/canvas/restore-product-A');
    await aSurface.locator('img[alt="恢复验收图片"]').first().waitFor();
    const attempts = logs.filter(item => item.operationId === operationId);
    if (attempts.length !== 2 || attempts[0].expectedRevision !== attempts[1].expectedRevision || !attempts[1].retryAck?.persisted) throw Error('未以同operationId、同版本重试落盘');
    if (mode === '丢失ACK' && JSON.stringify(attempts[0].realAck) !== JSON.stringify(attempts[1].retryAck)) throw Error('丢ACK重试不是同一笔幂等确认');
    return { status: 'pass', mode, beforeAck, rejected, attempts, after: { url: page.url(), activeA: await aSurface.getAttribute('data-product-active'), bInstancePreserved: await bInstance.evaluate(el => el.isConnected), alerts: await page.getByRole('alert').allTextContents() } };
  } finally { release?.(); await page.unroute('**/documents/extension/*', handler); }
}
async function originalRoute(page) {
  const aSurface = page.locator('div[data-product-id="restore-product-A"][data-product-active]');
  const bSurface = page.locator('div[data-product-id="restore-product-B"][data-product-active]');
  const close = page.getByRole('button', { name: '关闭', exact: true });
  if (await close.isVisible()) await close.click();
  const bInstance = await bSurface.elementHandle();
  const logs = [];
  // CLI定位错误后允许沿真实已归档、已确认状态续验，不改应用数据。
  let archiveFailed = !await page.getByRole('tab', { name: '隔离产品A', exact: true }).count(), restoreFailed = false, rootOperation;
  const handler = async route => {
    const request = route.request();
    if (request.method() !== 'PUT') return route.continue();
    const body = request.postDataJSON();
    if (body?.value?.format !== 'guan-app-storage.v2') return route.continue();
    const record = { namespace: body.value.namespace, operationId: body.operationId, expectedRevision: body.expectedRevision };
    logs.push(record);
    const hasA = await page.getByRole('tab', { name: '隔离产品A', exact: true }).count();
    let reason;
    if (!archiveFailed && body.value.namespace === 'preferences' && !hasA) { archiveFailed = true; reason = '归档导航拒绝'; }
    else if (archiveFailed && !restoreFailed && body.value.namespace === 'app_state' && hasA) { restoreFailed = true; rootOperation = body.operationId; reason = '原址恢复根拒绝'; }
    if (reason) {
      record.injected = reason;
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'isolated_original_route', message: '隔离验收：' + reason } }) });
    }
    if (body.operationId === rootOperation) {
      const response = await route.fetch(), ack = await response.json();
      record.retryAck = { persisted: ack.persisted, operationId: ack.operationId, revision: ack.revision };
      return route.fulfill({ response });
    }
    return route.continue();
  };
  await page.route('**/documents/extension/*', handler);
  try {
    if (!archiveFailed) {
      await page.getByRole('tab', { name: '隔离产品A', exact: true }).hover();
      await page.getByRole('button', { name: '删除隔离产品A及对应画布', exact: true }).click();
      await page.getByRole('button', { name: '删除', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: '隔离验收：归档导航拒绝' }).waitFor();
      await page.getByRole('button', { name: '取消', exact: true }).click();
      await page.getByRole('button', { name: '重试未确认保存', exact: true }).click();
      await page.locator('[data-save-state="saved"]').waitFor();
    }
    if (!page.url().endsWith('/canvas/restore-product-A') || await aSurface.count()) throw Error('未形成真实原网址已归档状态');
    await page.getByRole('banner', { name: '工作台顶栏' }).getByRole('button', { name: '产品回收站', exact: true }).click();
    await page.getByRole('button', { name: '恢复', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: '隔离验收：原址恢复根拒绝' }).waitFor();
    const hint = '产品恢复尚未确认，请勿刷新或关闭；若保存失败，请在回收站重试。';
    await page.getByRole('status').filter({ hasText: hint }).waitFor();
    const rejected = { url: page.url(), mountedA: await aSurface.count(), bInstancePreserved: await bInstance.evaluate(el => el.isConnected), hint: await page.getByRole('status').filter({ hasText: hint }).textContent() };
    if (rejected.mountedA || !rejected.bInstancePreserved) throw Error('原址恢复失败提前挂载或卸载B');
    await page.getByRole('button', { name: '重试保存后继续', exact: true }).click();
    await aSurface.locator('img[alt="恢复验收图片"]').first().waitFor();
    const attempts = logs.filter(item => item.operationId === rootOperation);
    if (attempts.length !== 2 || !attempts[1].retryAck?.persisted) throw Error('原址恢复未同操作重试');
    return { status: 'pass', mode: '原址恢复', archiveFailed, restoreFailed, rejected, attempts,
      after: { url: page.url(), activeA: await aSurface.getAttribute('data-product-active'), bInstancePreserved: await bInstance.evaluate(el => el.isConnected), alerts: await page.getByRole('alert').allTextContents() } };
  } finally { await page.unroute('**/documents/extension/*', handler); }
}
const selected = mode === '原址恢复' ? originalRoute : scenario;
const code = 'async page => { const scenario = ' + selected.toString() + '; return scenario(page, ' + JSON.stringify(mode) + '); }';
try {
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [join(根目录, '开发工具/产品恢复挂载浏览器命令.mjs'), mode + '真实验收', 'run-code', code], { cwd: 根目录, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  process.stdout.write(stdout + stderr);
} catch (error) { process.stdout.write((error.stdout ?? '') + (error.stderr ?? '')); process.exitCode = 1; }
