async (page) => {
  const origin = 'http://localhost:3100';
  const proxyUrl = '__PROXY_URL__', upstreamUrl = '__UPSTREAM_URL__';
  const report = { results: [], errors: [], unexpectedRequests: [] };
  const check = (value, message) => { if (!value) throw Error(message); };
  check(page.url() === 'about:blank', '必须使用独立测试浏览器资料');
  page.on('pageerror', error => report.errors.push(error.message));
  await page.context().route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.origin === proxyUrl) return route.continue();
    report.unexpectedRequests.push(url.origin + url.pathname); return route.abort();
  });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('relay-fixture')) return;
    localStorage.setItem('infinite-canvas:prompt_source_store_v2', JSON.stringify({ state: { sources: [{ id: 'banana-prompt-quicker', builtIn: true, enabled: false }], schedule: { intervalMinutes: 0, lastFetchedAt: '' } }, version: 0 }));
    sessionStorage.setItem('relay-fixture', '1');
  });
  const test = async (name, run) => {
    try { report.results.push({ name, passed: true, evidence: await run() }); }
    catch (error) { report.results.push({ name, passed: false, error: error.message }); throw error; }
    finally { await page.evaluate(value => { window.__guanRelayAcceptance = value; }, report); }
  };
  const settings = () => page.getByRole('dialog', { name: /配置与用户偏好/ });
  // 原版Form.Item未关联label与input；从已核查的本地代理tabpanel定位唯一输入框。
  const address = () => settings().getByRole('tabpanel', { name: '本地代理', exact: true }).getByRole('textbox');
  const open = async () => { await page.getByRole('button', { name: '画布设置', exact: true }).click(); await settings().waitFor(); await settings().getByRole('tab', { name: '本地代理', exact: true }).click(); };
  const close = async () => { await settings().getByRole('button', { name: '关闭', exact: true }).click(); await settings().waitFor({ state: 'hidden' }); };
  const capture = async name => { await page.screenshot({ path: '__ARTIFACT_DIR__/' + name + '.png' }); };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByRole('banner', { name: '工作台顶栏', exact: true }).waitFor();

  await test('恢复原版代理页签，新资料不开启开关，其他关闭项不恢复', async () => {
    await open();
    check(await settings().getByRole('tab', { name: 'WebDAV', exact: true }).count() === 0, 'WebDAV被恢复');
    check(await settings().getByRole('switch').getAttribute('aria-checked') === 'false', '被自动启用');
    check(await settings().getByRole('button', { name: '测试连接', exact: true }).count() === 0, '关闭时显示测试按钮');
    await capture('浅色关闭状态'); return { defaultEnabled: false, proxyTab: true, webdavTab: false };
  });
  await test('实际点击开关、填写地址并测试真实隔离转发器', async () => {
    await settings().getByRole('switch').click();
    await address().fill(proxyUrl);
    await settings().getByRole('button', { name: '测试连接', exact: true }).click();
    await page.getByText('本地代理连接正常（@basketikun/canvas-proxy v0.1.0）', { exact: true }).waitFor();
    await capture('浅色连接成功'); await close(); return { health: '@basketikun/canvas-proxy v0.1.0' };
  });
  await test('真实模型列表API经本地HTTP转发返回浏览器，不使用真实Key', async () => {
    const names = await page.evaluate(async baseUrl => {
      const { fetchImageModels } = await window.__guanImport('/src/services/api/image.ts');
      return fetchImageModels({ baseUrl, apiKey: 'synthetic-fixture-only', apiFormat: 'openai' });
    }, upstreamUrl);
    check(JSON.stringify(names) === '["synthetic-image","synthetic-text"]', '真实模型返回不符');
    return { modelNames: names, syntheticOnly: true };
  });
  await test('开关及地址刷新后保留，关闭后恢复原直连URL且不改渠道配置', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await open();
    check(await settings().getByRole('switch').getAttribute('aria-checked') === 'true', '开启偏好未保留');
    check(await address().inputValue() === proxyUrl, '地址未保留');
    await settings().getByRole('switch').click();
    const state = await page.evaluate(async () => {
      const api = await window.__guanImport('/src/stores/use-config-store.ts');
      return { enabled: api.useConfigStore.getState().config.proxyEnabled, url: api.withLocalProxy('https://provider.example.invalid/v1/models'), key: api.useConfigStore.getState().config.apiKey };
    });
    check(state.enabled === false && state.url === 'https://provider.example.invalid/v1/models' && state.key === '', '关闭策略或默认配置不符');
    await close(); return { reloadPersists: true, directUrlRestored: true, defaultCredentialEmpty: true };
  });
  await test('深色与窄屏原UI可用，设置反复开关不闪退、不锁界面', async () => {
    await page.getByRole('banner', { name: '工作台顶栏', exact: true }).getByRole('button', { name: '切换深色主题', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.classList.contains('dark') && !document.documentElement.dataset.magicuiThemeVt);
    await open(); await capture('深色代理设置'); await close();
    await page.setViewportSize({ width: 390, height: 844 });
    await open(); await capture('窄屏代理设置'); await close();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await open(); await close();
    check(report.errors.length === 0 && report.unexpectedRequests.length === 0, JSON.stringify(report));
    return { lightDark: true, narrow: true, closeCycles: 3, errors: 0, unexpectedRequests: 0 };
  });
  report.passed = true;
  await page.evaluate(value => { window.__guanRelayAcceptance = value; }, report);
}
