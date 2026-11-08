async (page) => {
  const output = '__GUAN_HOME_OUTPUT__';
  const origin = 'http://localhost:3100';
  if (page.url() !== 'about:blank') throw Error('必须是全新隔离浏览器，不接入用户Chrome。');
  // 冷读依赖时允许60秒；仍保留超时失败，不以重试掩盖流程错误。
  page.setDefaultNavigationTimeout(60000);
  page.setDefaultTimeout(60000);
  const report = { scope: '真实3100首页→新建→IndexedDB→真实画布→刷新', results: [], errors: [], localFailures: [], blockedExternal: [], checkpoints: [] };
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('requestfailed', request => { if (new URL(request.url()).origin === origin && request.failure()?.errorText !== 'net::ERR_ABORTED') report.localFailures.push({ url: request.url(), reason: request.failure()?.errorText }); });
  await page.context().route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    report.blockedExternal.push(url.origin + url.pathname);
    return route.abort();
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('infinite-canvas:theme_store')) localStorage.setItem('infinite-canvas:theme_store', JSON.stringify({ state: { theme: 'light' }, version: 0 }));
  });
  const check = (value, message) => { if (!value) throw Error(message); };
  const save = () => page.evaluate(value => { window.__guanHomeAcceptance = value; }, report);
  const test = async (name, run) => {
    try { report.results.push({ name, passed: true, evidence: await run() }); }
    catch (error) { report.results.push({ name, passed: false, error: error.message }); await save(); throw error; }
    await save();
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin, { waitUntil: 'commit' });
  const main = page.getByRole('main', { name: '工作台首页' });
  await main.waitFor();
  console.log(await page.locator('body').ariaSnapshot());
  await test('旧版首页顶栏84px、Logo加载、设置反复开关且无重复弹窗', async () => {
    const header = page.getByRole('banner', { name: '工作台顶栏' });
    const box = await header.boundingBox();
    check(box && box.height === 84 && box.y === 0, '旧顶栏尺寸不符');
    const logo = await header.locator('img[alt="G"]').evaluate(img => ({ complete: img.complete, width: img.naturalWidth }));
    check(logo.complete && logo.width > 0, '旧Logo未加载');
    check(await header.getByRole('button', { name: '主题切换已关闭', exact: true }).isDisabled(), '已关闭主题切换被重开');
    check(await header.getByRole('button', { name: '选择已上传的 Excel 文件', exact: true }).isDisabled(), '未迁入Excel业务被重开');
    for (let i = 0; i < 3; i++) {
      await header.getByRole('button', { name: '画布设置', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: /配置与用户偏好/ });
      await dialog.waitFor();
      check(await dialog.count() === 1, '首页设置重复挂载');
      if (i === 1) await dialog.getByRole('button', { name: /关闭|Close/ }).click();
      else await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
      check(await page.locator('body').evaluate(body => getComputedStyle(body).pointerEvents !== 'none'), '关闭后界面仍无响应');
    }
    return { box, logo, modalCycles: 3, canvasHeaderUnchanged: '另在新建画布后验证' };
  });
  await test('真实首页左右各半、白底、空数据不自动创建', async () => {
    const left = await page.getByRole('region', { name: 'A+ 详情页', exact: true }).boundingBox();
    const right = await page.getByRole('region', { name: '暂无产品', exact: true }).boundingBox();
    const background = await main.evaluate(element => getComputedStyle(element).backgroundColor);
    const count = await page.evaluate(async () => (await window.__guanImport('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore.getState().projects.length);
    check(left && right && Math.abs(left.width - right.width) < 2 && left.x < right.x, '首页不是左右等宽');
    check(background === 'rgb(255, 255, 255)' && count === 0 && new URL(page.url()).pathname === '/', '白底或空记录状态不符');
    check(await main.getByRole('button', { name: '导入产品', exact: true }).isDisabled(), '导入被错误开启');
    check(await main.getByRole('button', { name: '产品回收站', exact: true }).isDisabled(), '回收站被错误开启');
    return { left, right, background, projects: count };
  });
  await test('三组30张原图完整加载、轮播和键盘循环', async () => {
    await page.waitForFunction(() => { const imgs = [...document.querySelectorAll('main[aria-label="工作台首页"] img')]; return imgs.length === 33 && imgs.every(img => img.complete && img.naturalWidth > 0); });
    const images = await main.locator('img').evaluateAll(imgs => imgs.filter(img => img.src.endsWith('.webp')).map(img => ({ src: img.getAttribute('src'), width: img.naturalWidth, height: img.naturalHeight })));
    for (const [index, title] of ['游戏手柄', '运动鞋', '智能手表'].entries()) {
      const dot = main.getByRole('button', { name: `切换到第 ${index + 1} 个轮播模板`, exact: true });
      await dot.focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(i => document.querySelector(`[aria-label="切换到第 ${i} 个轮播模板"]`)?.getAttribute('aria-current') === 'true', index + 1);
      await page.getByRole('group', { name: `${index + 1} / 3：${title}`, exact: true }).waitFor();
    }
    check(new Set(images.map(img => img.src)).size === 30, '未加载完整30张原图');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('[aria-label="切换到第 1 个轮播模板"]')?.getAttribute('aria-current') === 'true');
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => document.querySelector('[aria-label="切换到第 3 个轮播模板"]')?.getAttribute('aria-current') === 'true');
    const before = await main.locator('[aria-current="true"]').getAttribute('aria-label');
    await page.waitForFunction(previous => document.querySelector('main [aria-current="true"]')?.getAttribute('aria-label') !== previous, before, { timeout: 8000 });
    await page.screenshot({ path: output + '/首页-浅色.png' });
    return { loadedImages: images.length, images, keyboard: true, autoplay: true };
  });
  await test('深色与390px窄屏，主题关闭策略未重开', async () => {
    await page.evaluate(() => localStorage.setItem('infinite-canvas:theme_store', JSON.stringify({ state: { theme: 'dark' }, version: 0 })));
    await page.reload(); await main.waitFor();
    const background = await main.evaluate(element => getComputedStyle(element).backgroundColor);
    check(background === 'rgb(23, 23, 23)', '深色未跟随已保存偏好');
    await page.screenshot({ path: output + '/首页-深色.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    const left = await page.getByRole('region', { name: 'A+ 详情页', exact: true }).boundingBox();
    const right = await page.getByRole('region', { name: '暂无产品', exact: true }).boundingBox();
    check(left && right && left.y < right.y && Math.abs(left.x - right.x) < 2, '窄屏未纵向排列');
    check(await main.evaluate(element => element.scrollWidth <= element.clientWidth), '窄屏首页横向溢出');
    await page.screenshot({ path: output + '/首页-窄屏.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    return { background, viewport: '390x844', horizontalOverflow: false };
  });
  await test('新建到真实画布、持久化刷新和根入口不重复创建', async () => {
    await main.getByRole('button', { name: '新建产品', exact: true }).click();
    await page.waitForURL(/\/canvas\/[^/]+$/);
    report.checkpoints.push({ stage: '点击新建后', url: page.url() });
    await page.getByRole('button', { name: '打开画布菜单', exact: true }).waitFor();
    check(await page.getByRole('banner', { name: '工作台顶栏' }).count() === 0, '首页顶栏错误渗入画布页');
    report.checkpoints.push({ stage: '真实画布已挂载', url: page.url() });
    const path = new URL(page.url()).pathname;
    // CLI取证与原版400ms防抖均为异步；明确读取已提交记录，不把Promise/短暂中间态当落盘。
    const started = Date.now();
    let stable = 0;
    while (stable < 2) {
      const storedIds = await page.evaluate(async () => {
        const { localForageStorage } = await window.__guanImport('/src/lib/localforage-storage.ts');
        return JSON.parse(await localForageStorage.getItem('infinite-canvas:canvas_store') || '{}').state?.projects.map(p => p.id) ?? [];
      });
      stable = storedIds.length === 1 && path === '/canvas/' + storedIds[0] && Date.now() - started >= 600 ? stable + 1 : 0;
      if (Date.now() - started > 10000) throw Error('新建记录尚未稳定落盘，禁止刷新验收');
      await page.waitForTimeout(100);
    }
    report.checkpoints.push({ stage: '持久化已读回', data: await page.evaluate(async () => {
      const { localForageStorage } = await window.__guanImport('/src/lib/localforage-storage.ts');
      const { useCanvasStore } = await window.__guanImport('/src/stores/canvas/use-canvas-store.ts');
      return { moduleUrls: performance.getEntriesByType('resource').filter(e => e.name.includes('use-canvas-store')).map(e => e.name), memoryIds: useCanvasStore.getState().projects.map(p => p.id), storedIds: JSON.parse(await localForageStorage.getItem('infinite-canvas:canvas_store') || '{}').state?.projects.map(p => p.id) };
    }) });
    await page.reload(); await page.getByRole('button', { name: '打开画布菜单', exact: true }).waitFor();
    report.checkpoints.push({ stage: '刷新后真实画布已挂载', url: page.url() });
    await page.goto(origin); await page.waitForURL(origin + path);
    const count = await page.evaluate(async () => (await window.__guanImport('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore.getState().projects.length);
    check(count === 1 && await main.count() === 0, '刷新丢失或重复创建');
    const settings = page.getByRole('button', { name: '配置', exact: true }); await settings.click();
    const dialog = page.getByRole('dialog', { name: /配置与用户偏好/ }); await dialog.waitFor();
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    await page.screenshot({ path: output + '/新建后真实画布.png' });
    return { path, storedProjects: count, actualCanvasTested: true, settingsOpenedAndClosed: true };
  });
  check(report.errors.length === 0 && report.localFailures.length === 0, '页面异常或本地资源请求失败');
  report.passed = true; await save(); console.log(JSON.stringify(report));
}
