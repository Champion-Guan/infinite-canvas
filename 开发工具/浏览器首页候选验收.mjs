async (page) => {
  const output = '__GUAN_PREVIEW_OUTPUT__';
  const assets = '__GUAN_HOME_ASSETS__';
  const origin = 'http://localhost:3100';
  if (page.url() !== 'about:blank') throw Error('仅接受全新隔离浏览器页面。');
  const report = { scope: '独立候选首页，不是3100产品接入验收', results: [], errors: [], unexpectedRequests: [] };
  page.on('pageerror', error => report.errors.push(error.message));
  await page.context().route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin && (url.pathname === '/' || /^\/canvas\/[^/]+$/.test(url.pathname))) return route.fulfill({ path: output + '/index.html', contentType: 'text/html' });
    if (url.origin === origin && url.pathname === '/__guan_home_preview.js') return route.fulfill({ path: output + '/首页预览入口.js', contentType: 'application/javascript' });
    if (url.origin === origin && url.pathname === '/__guan_home_preview.css') return route.fulfill({ path: output + '/首页预览入口.css', contentType: 'text/css' });
    const name = decodeURIComponent(url.pathname).replace('/guan/首页轮播/', '');
    if (url.origin === origin && /^第[123]组-(商品图[123]|详情长图1|效果图[1-6])\.webp$/.test(name)) return route.fulfill({ path: assets + '/' + name, contentType: 'image/webp' });
    report.unexpectedRequests.push(url.origin + url.pathname);
    return route.abort();
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('infinite-canvas:theme_store')) localStorage.setItem('infinite-canvas:theme_store', JSON.stringify({ state: { theme: 'light' }, version: 0 }));
  });
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const save = () => page.evaluate(value => { window.__guanHomeCandidateResult = value; }, report);
  const test = async (name, run) => {
    try { const evidence = await run(); report.results.push({ name, passed: true, evidence }); }
    catch (error) { report.results.push({ name, passed: false, error: error.message }); await save(); throw error; }
    await save();
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin);
  await page.getByRole('heading', { name: 'A+ 详情页', exact: true }).waitFor();
  console.log(await page.locator('body').ariaSnapshot());
  await test('两列等宽、浅色白底、入口没有初始化创建', async () => {
    const left = await page.getByRole('region', { name: 'A+ 详情页', exact: true }).boundingBox();
    const right = await page.getByRole('region', { name: '暂无产品', exact: true }).boundingBox();
    check(left && right && Math.abs(left.width - right.width) < 2 && left.x < right.x, '桌面不是左右等宽布局');
    const main = page.getByRole('main', { name: '工作台首页' });
    const background = await main.evaluate(element => getComputedStyle(element).backgroundColor);
    check(background === 'rgb(255, 255, 255)', '浅色背景不是白色');
    check(await page.getByRole('button', { name: '导入产品', exact: true }).isDisabled(), '未接入导入被误启用');
    check(await page.getByRole('button', { name: '产品回收站', exact: true }).isDisabled(), '未接入回收站被误启用');
    check(new URL(page.url()).pathname === '/', '初始化创建了画布或发生跳转');
    await page.screenshot({ path: output + '/首页-浅色.png' });
    return { leftWidth: left.width, rightWidth: right.width, background };
  });
  await test('轮播切换、键盘操作', async () => {
    await page.getByRole('button', { name: '下一组模板', exact: true }).click();
    check(await page.getByRole('group', { name: '2 / 3：运动鞋', exact: true }).count() === 1, '下一组未切换');
    await page.getByRole('button', { name: '查看智能手表模板', exact: true }).focus();
    await page.keyboard.press('Enter');
    check(await page.getByRole('group', { name: '3 / 3：智能手表', exact: true }).count() === 1, '键盘无法切换');
    await page.getByRole('button', { name: '下一组模板', exact: true }).click();
    check(await page.getByRole('group', { name: '1 / 3：游戏手柄', exact: true }).count() === 1, '末组未循环回第一组');
    return { manualCarousel: true, keyboard: true };
  });
  await test('深色与移动布局无横向溢出', async () => {
    await page.evaluate(() => localStorage.setItem('infinite-canvas:theme_store', JSON.stringify({ state: { theme: 'dark' }, version: 0 })));
    await page.reload();
    const main = page.getByRole('main', { name: '工作台首页' });
    await main.waitFor();
    const background = await main.evaluate(element => getComputedStyle(element).backgroundColor);
    check(background === 'rgb(23, 23, 23)', '深色背景未跟随');
    await page.screenshot({ path: output + '/首页-深色.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    const left = await page.getByRole('region', { name: 'A+ 详情页', exact: true }).boundingBox();
    const right = await page.getByRole('region', { name: '暂无产品', exact: true }).boundingBox();
    check(left && right && left.y < right.y && Math.abs(left.x - right.x) < 2, '移动布局未纵向排列');
    check(await main.evaluate(element => element.scrollWidth <= element.clientWidth), '移动页面横向溢出');
    await page.screenshot({ path: output + '/首页-移动端.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    return { darkBackground: background, mobileWidth: 390 };
  });
  await test('新建调用真实隔离store，刷新和根入口不重复创建', async () => {
    await page.getByRole('button', { name: '新建产品', exact: true }).click();
    await page.waitForURL(/\/canvas\/[^/]+$/);
    const canvas = page.getByTestId('preview-canvas');
    const path = new URL(page.url()).pathname;
    check(await canvas.getAttribute('data-project-count') === '1', '新建数目不为1');
    // 作者store的持久化延迟为400ms；等待实际记录可被新页面读回。
    await page.waitForTimeout(600);
    await page.reload();
    await page.getByTestId('preview-canvas').getByRole('heading').filter({ hasText: /.+/ }).waitFor();
    check(await canvas.getAttribute('data-project-count') === '1', '刷新丢失或重复创建');
    await page.goto(origin);
    await page.waitForURL(origin + path);
    check(await canvas.getAttribute('data-project-count') === '1', '根入口重复创建');
    return { path, storedProjects: 1, actualCanvasTested: false };
  });
  check(report.errors.length === 0, '候选存在页面异常');
  check(report.unexpectedRequests.length === 0, '候选产生未声明网络请求');
  report.passed = true;
  await save();
  console.log(JSON.stringify(report));
}
