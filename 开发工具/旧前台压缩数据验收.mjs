// 仅用于全新Playwright资料和3197隔离入口；绝不接触用户3000资料。
async (page) => {
  if (page.url() !== 'about:blank') throw Error('必须使用全新隔离测试浏览器');
  const origin = 'http://localhost:3197';
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const report = { origin, syntheticOnly: true, results: [] };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin, { waitUntil: 'load' });
  await page.waitForFunction(() => window.GuanWorkbenchData && window.fflate && window.XLSX);
  check(!await page.getByText('本地数据读取失败', { exact: true }).isVisible(), '空资料首页初始化失败');
  const fixture = await page.evaluate(() => {
    const api = window.GuanWorkbenchData;
    if (localStorage.getItem(api.storageKey)) throw Error('不是空白测试资料，停止');
    api.createProductSet({ fileName: '压缩恢复测试.xlsx', rows: [{ sku: 'synthetic-001', titleZh: '压缩读取验证产品' }] });
    const state = api.getState();
    state.syntheticPadding = '仅为隔离验收生成的测试内容'.repeat(6000);
    api.saveState(state);
    const raw = localStorage.getItem(api.storageKey);
    if (!raw.startsWith('guan-workbench-compressed-v1:')) throw Error('未生成真实压缩格式');
    return { raw, key: api.storageKey, productId: state.products[0].id, paddingLength: state.syntheticPadding.length };
  });
  report.results.push({ name: '原数据契约生成压缩格式', passed: true, paddingLength: fixture.paddingLength });
  const blockDecoder = route => route.abort();
  await page.route('**/local-vendor/fflate.umd.js*', blockDecoder);
  await page.reload({ waitUntil: 'load' });
  await page.getByText('本地数据读取失败', { exact: true }).waitFor();
  check(await page.evaluate(({ key, raw }) => localStorage.getItem(key) === raw, fixture), '缺少解压库时主记录被覆盖');
  report.results.push({ name: '受控复现缺解压库错误，主记录保持原样', passed: true });
  await page.unroute('**/local-vendor/fflate.umd.js*', blockDecoder);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.GuanWorkbenchData && window.fflate && window.XLSX);
  const restored = await page.evaluate(({ key, raw, productId, paddingLength }) => {
    const state = window.GuanWorkbenchData.getState();
    return {
      rawUnchanged: localStorage.getItem(key) === raw,
      productPresent: state.products.some(product => product.id === productId && product.identity.titleZh === '压缩读取验证产品'),
      paddingPresent: state.syntheticPadding.length === paddingLength,
      excelAvailable: typeof window.XLSX.read === 'function',
      recoveryCopies: Object.keys(localStorage).filter(key => key.startsWith('guan-workbench:data-contract:v1:recovery:')).length,
    };
  }, fixture);
  check(restored.rawUnchanged && restored.productPresent && restored.paddingPresent && restored.excelAvailable, '补回依赖后读取校验失败：' + JSON.stringify(restored));
  check(!await page.getByText('本地数据读取失败', { exact: true }).isVisible(), '恢复后仍显示数据读取错误');
  await page.getByText('压缩恢复测试.xlsx', { exact: false }).first().waitFor();
  check(!await page.getByRole('heading', { name: 'Oops!', exact: true }).isVisible(), '旧首页静态资源加载失败');
  check(!errors.some(error => /ChunkLoadError/.test(error)), '旧静态chunk未加载');
  report.results.push({ name: '刷新后完整读取压缩产品，主记录不变且恢复副本保留', passed: true, ...restored });
  for (const path of ['/local-app/health', '/local-proxy/status', '/api/health']) {
    const response = await page.request.get(origin + path);
    check(response.status() === 503, '意外恢复旧后台：' + path);
  }
  report.results.push({ name: '旧后台接口保持关闭', passed: true });
  return report;
}
