async (page) => {
  // 只在自建隔离浏览器运行。3197是只读旧首页参照，不访问3000和用户Chrome。
  if (!['http://localhost:3100/', 'http://localhost:3197/'].includes(page.url())) throw Error('非隔离首页，停止');
  const source = page.url().includes(':3197');
  await page.setViewportSize({ width: 2048, height: 940 });
  const dark = source ? await page.locator('html').getAttribute('data-workbench-theme') : await page.locator('main').getAttribute('data-theme');
  if (dark !== 'dark') throw Error('必须同为深色');
  const dot = page.getByRole('button', { name: '切换到第 1 个轮播模板', exact: true });
  await dot.click();
  await page.waitForFunction(() => {
    const region = document.querySelector('[aria-label="轮播模板预览"]');
    const card = region?.querySelector('[data-slot="card"]');
    if (!card) return false;
    const a = region.getBoundingClientRect(), b = card.getBoundingClientRect();
    // 等待轮播真正停靠，不能在尚有0.02px位移的最后几帧取样。
    return Math.abs(b.x + b.width / 2 - a.x - a.width / 2) < .001;
  });
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(source => {
    const rect = selector => {
      const el = document.querySelector(selector), r = el.getBoundingClientRect(), css = getComputedStyle(el);
      return { x: r.x, y: r.y, width: r.width, height: r.height, color: css.color, background: css.backgroundColor, fontSize: css.fontSize, lineHeight: css.lineHeight, gap: css.gap };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      areas: Object.fromEntries([
        ...['.guan-product-empty', '.guan-product-landing-preview', '.guan-product-landing-introduction', '.guan-product-landing-actions', '.guan-product-landing-buttons', '[data-slot="card"]', '.guan-product-landing-introduction h1', '.guan-product-landing-actions h2'].map(s => [s, s]),
        ['顶栏', source ? '[role="dialog"] > .flex.size-full > aside' : 'header[aria-label="工作台顶栏"]'],
        ['Logo', source ? '.local-brand-wrap a' : 'header img[alt="G"]'],
        ['Excel选择器', '[aria-label="选择已上传的 Excel 文件"]'],
        ['设置按钮', '[aria-label="画布设置"]'],
        ['主题按钮', '[aria-label="切换浅色主题"]'],
      ].map(([name, selector]) => [name, rect(selector)])),
      images: Array.from(document.querySelector('[data-slot="card"]').querySelectorAll('img'), img => { const r = img.getBoundingClientRect(); return { alt: img.alt, width: r.width, height: r.height, fit: getComputedStyle(img).objectFit, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }; }),
    };
  }, source);
  await page.screenshot({ path: '__OUTPUT__/' + (source ? '旧首页-深色.png' : '新首页-深色.png') });
  return result;
}
