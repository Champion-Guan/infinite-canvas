// 真实旧实现/批准新包同尺寸验收；只通过可见UI操作，DOM仅用于只读测量。
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { 根目录 } from './公共.mjs';
const mode = process.argv[2];
if (!['旧版', '新版'].includes(mode) || process.argv.length !== 3) throw Error('必须指定旧版或新版');
async function checkSettings(page, old, output) {
  const scope = old ? page.locator('iframe').first().contentFrame() : page;
  const results = [];
  const settle = () => page.waitForTimeout(450); // 等待Ant Design的进入/退出动画后记录真实边界。
  async function closeAll() {
    for (let i = 0; i < 3 && await scope.locator('[role="dialog"]:visible').count(); i++) { await scope.locator('[role="dialog"]:visible').last().press('Escape'); await settle(); }
  }
  async function measure(label) {
    await settle();
    const dialogs = await scope.locator('[role="dialog"]:visible').all();
    const boxes = await Promise.all(dialogs.map(item => item.boundingBox()));
    const masks = await scope.locator('.ant-modal-mask, .ant-drawer-mask').evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().height && getComputedStyle(element).display !== 'none').map(element => {
      const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
    }));
    const topHit = await page.evaluate(() => document.elementFromPoint(innerWidth - 35, 42)?.closest('button')?.getAttribute('aria-label'));
    const body = await scope.locator('.ant-modal-body:visible').last().evaluate(element => ({ maxHeight: getComputedStyle(element).maxHeight, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight }));
    await page.screenshot({ path: output + '/' + label + '.png' });
    return { label, viewport: page.viewportSize(), dialogs: boxes, masks, topHit, body };
  }
  await closeAll(); await page.setViewportSize({ width: 1440, height: 1000 });
  for (const theme of ['浅色', '深色']) {
    const toggle = page.getByRole('button', { name: theme === '浅色' ? '切换浅色主题' : '切换深色主题', exact: true });
    if (await toggle.count()) await toggle.click();
    await (old ? scope.getByRole('button', { name: '配置', exact: true }) : page.getByRole('button', { name: '画布设置', exact: true })).click();
    await scope.getByRole('dialog').first().waitFor();
    for (const tab of ['代理设置', 'Fallback 配置']) {
      await scope.getByRole('tab', { name: tab, exact: true }).click();
      results.push(await measure((old ? '旧' : '新') + tab + theme));
    }
    await scope.getByRole('tab', { name: '渠道', exact: true }).click();
    await scope.getByRole('button', { name: '编辑', exact: true }).click();
    await scope.getByRole('dialog', { name: '编辑渠道', exact: true }).waitFor();
    results.push(await measure((old ? '旧' : '新') + '渠道编辑' + theme));
    await scope.getByRole('button', { name: '选择模型', exact: true }).click();
    await scope.getByRole('dialog').nth(2).waitFor();
    results.push(await measure((old ? '旧' : '新') + '模型选择' + theme));
    await scope.getByRole('dialog').nth(2).press('Escape'); await scope.getByRole('dialog').nth(2).waitFor({ state: 'hidden' });
    const modelFocus = await scope.getByRole('button', { name: '选择模型', exact: true }).evaluate(element => element === element.ownerDocument.activeElement);
    await scope.getByRole('dialog', { name: '编辑渠道', exact: true }).press('Escape'); await scope.getByRole('dialog', { name: '编辑渠道', exact: true }).waitFor({ state: 'hidden' });
    const drawerFocus = await scope.getByRole('button', { name: '编辑', exact: true }).evaluate(element => element === element.ownerDocument.activeElement);
    await scope.getByRole('dialog').first().press('Escape'); await scope.getByRole('dialog').waitFor({ state: 'hidden' });
    const mainFocus = await (old ? scope.getByRole('button', { name: '配置', exact: true }) : page.getByRole('button', { name: '画布设置', exact: true })).evaluate(element => element === element.ownerDocument.activeElement);
    results.push({ theme, keyboard: { modelFocus, drawerFocus, mainFocus } });
  }
  for (const size of [{ width: 1200, height: 800 }, { width: 800, height: 600 }, { width: 960, height: 500 }]) {
    await page.setViewportSize(size);
    await (old ? scope.getByRole('button', { name: '配置', exact: true }) : page.getByRole('button', { name: '画布设置', exact: true })).click();
    await scope.getByRole('tab', { name: '渠道', exact: true }).click();
    await scope.getByRole('button', { name: '编辑', exact: true }).click();
    results.push(await measure((old ? '旧' : '新') + '缩窗抽屉' + size.width + 'x' + size.height));
    await scope.getByRole('button', { name: '选择模型', exact: true }).click();
    results.push(await measure((old ? '旧' : '新') + '缩窗模型' + size.width + 'x' + size.height));
    await closeAll();
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  return results;
}
const output = join(根目录, '.运行/output/playwright/状态通知与设置子层-20261020');
const code = 'async (page) => (' + checkSettings.toString() + ')(page, ' + (mode === '旧版') + ', ' + JSON.stringify(output) + ')';
execFileSync(process.execPath, [join(根目录, '开发工具', mode === '旧版' ? '状态通知与设置子层旧版浏览器命令.mjs' : '状态通知与设置子层浏览器命令.mjs'), mode + '设置完整边界复验', 'run-code', code], { cwd: 根目录, stdio: 'inherit' });
