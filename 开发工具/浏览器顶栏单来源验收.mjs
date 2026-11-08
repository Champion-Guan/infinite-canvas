async (page) => {
  const origin = 'http://localhost:3100';
  const report = { results: [], errors: [], unexpectedRequests: [], sourceRequests: 0 };
  const check = (value, message) => { if (!value) throw Error(message); };
  check(page.url() === 'about:blank', '必须使用独立新测试资料');
  let offline = false;
  page.on('pageerror', error => report.errors.push(error.message));
  await page.context().route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization,content-type' };
    if (url.href === 'https://source.example.invalid/prompts.json') {
      report.sourceRequests++;
      return route.fulfill({ status: offline ? 503 : 200, headers, contentType: 'application/json', body: JSON.stringify([{ id: 'synthetic-size', title: '合成尺寸展示', prompt: '长宽高尺寸展示', tags: ['尺寸'] }]) });
    }
    report.unexpectedRequests.push(url.origin + url.pathname); return route.abort();
  });
  await page.addInitScript(() => {
    window.__sourceTimers = [];
    const original = window.setInterval;
    window.setInterval = function (...args) {
      if ((new Error().stack || '').includes('use-prompt-source-scheduler')) window.__sourceTimers.push(args[1]);
      return original.apply(this, args);
    };
    if (!sessionStorage.getItem('single-source-fixture')) {
      const ids = ['banana-prompt-quicker', 'davidwu-gpt-image2-prompts', 'freestylefly-gpt-image-2', 'awesome-gpt-image', 'awesome-gpt4o-image-prompts', 'youmind-gpt-image-2', 'youmind-nano-banana-pro'];
      localStorage.setItem('infinite-canvas:prompt_source_store_v2', JSON.stringify({ state: {
        sources: [...ids.map(id => ({ id, builtIn: true, enabled: false })), { id: 'synthetic-existing', name: '合成既有来源', url: 'https://source.example.invalid/prompts.json', homepage: '', builtIn: false, enabled: true }],
        schedule: { intervalMinutes: 30, lastFetchedAt: '2020-01-01T00:00:00Z' },
      }, version: 0 }));
      sessionStorage.setItem('single-source-fixture', '1');
    }
  });
  const test = async (name, run) => {
    try { report.results.push({ name, passed: true, evidence: await run() }); }
    catch (error) { report.results.push({ name, passed: false, error: error.message }); throw error; }
    finally { await page.evaluate(value => { window.__guanSingleSourceAcceptance = value; }, report); }
  };
  const header = () => page.getByRole('banner', { name: '工作台顶栏', exact: true });
  const settings = () => page.getByRole('dialog', { name: /配置与用户偏好/ });
  const openSettings = async () => { await page.getByRole('button', { name: '画布设置', exact: true }).click(); await settings().waitFor(); };
  const closeSettings = async () => { await settings().getByRole('button', { name: '关闭', exact: true }).click(); await settings().waitFor({ state: 'hidden' }); };
  const capture = async name => { await page.waitForTimeout(450); await page.screenshot({ path: '__ARTIFACT_DIR__/' + name + '.png' }); };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(origin, { waitUntil: 'domcontentloaded' }); await header().waitFor();

  await test('默认跟随系统、顶栏真实手动切换和刷新保留，设置无界面主题', async () => {
    await page.waitForFunction(() => document.querySelector('[aria-label="工作台顶栏"]').dataset.theme === 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.querySelector('[aria-label="工作台顶栏"]').dataset.theme === 'light');
    await header().getByRole('button', { name: '切换深色主题', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.classList.contains('dark') && !document.documentElement.dataset.magicuiThemeVt);
    await page.reload({ waitUntil: 'domcontentloaded' }); await header().waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="工作台顶栏"]').dataset.theme === 'dark');
    await openSettings(); await settings().getByRole('tab', { name: '偏好设置', exact: true }).click();
    check(await settings().getByText('界面主题', { exact: true }).count() === 0, '界面主题仍存在');
    await capture('深色偏好设置'); await closeSettings();
    await header().getByRole('button', { name: '切换浅色主题', exact: true }).click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark') && !document.documentElement.dataset.magicuiThemeVt);
    return { systemFollows: true, manualPersists: true, preferencesRemoved: true };
  });
  await test('旧7内置过滤为1、既有自定义和非零间隔保留，启动无自动来源请求', async () => {
    const state = await page.evaluate(async () => {
      const s = (await window.__guanImport('/src/stores/use-prompt-source-store.ts')).usePromptSourceStore.getState();
      return { ids: s.sources.map(s => s.id), interval: s.schedule.intervalMinutes, timers: window.__sourceTimers.length };
    });
    check(JSON.stringify(state.ids) === JSON.stringify(['banana-prompt-quicker', 'synthetic-existing']) && state.interval === 30 && state.timers === 0 && report.sourceRequests === 0, '恢复过滤/自动刷新异常：' + JSON.stringify(state));
    await openSettings(); await settings().getByRole('tab', { name: '提示词来源', exact: true }).click();
    for (const name of ['新增来源', '全部立即拉取']) check(await settings().getByRole('button', { name, exact: true }).count() === 0, name + '仍存在');
    check(await settings().getByText('定时拉取', { exact: true }).count() === 0, '定时区块仍存在');
    await settings().getByText('Banana Prompt Quicker', { exact: true }).waitFor(); await capture('浅色单测试来源');
    return state;
  });
  const row = () => settings().locator('.rounded-lg.border').filter({ has: page.getByText('合成既有来源', { exact: true }) });
  await test('保留单源立即拉取/内容立即更新、编辑启停；失败保留缓存', async () => {
    await row().getByRole('button', { name: '编辑来源', exact: true }).click();
    const edit = page.getByRole('dialog', { name: /编辑提示词来源/ }); await edit.waitFor();
    await edit.getByLabel('来源主页（可选）', { exact: true }).fill('https://source.example.invalid');
    await edit.getByRole('button', { name: /^保\s*存$/ }).click(); await edit.waitFor({ state: 'hidden' });
    await row().getByRole('switch').click(); check(await row().getByRole('switch').getAttribute('aria-checked') === 'false', '停用失败'); await row().getByRole('switch').click();
    await row().getByRole('button', { name: '立即拉取', exact: true }).click(); await row().getByText('1 条', { exact: true }).waitFor();
    const before = report.sourceRequests;
    await row().getByRole('button', { name: '查看内容', exact: true }).click();
    const content = page.getByRole('dialog', { name: /合成既有来源 · 提示词内容/ }); await content.waitFor(); await content.getByText('合成尺寸展示', { exact: true }).waitFor();
    check(report.sourceRequests === before, '缓存查看自动请求');
    await content.getByRole('button', { name: '立即更新', exact: true }).click(); await page.waitForTimeout(350); check(report.sourceRequests > before, '手动内容刷新无效');
    await page.keyboard.press('Escape'); await content.waitFor({ state: 'hidden' });
    offline = true; await row().getByRole('button', { name: '立即拉取', exact: true }).click(); await row().getByText('失败', { exact: true }).waitFor(); offline = false;
    const count = await page.evaluate(async () => (await (await window.__guanImport('/src/services/api/prompts.ts')).fetchSourcePrompts('synthetic-existing')).length);
    check(count === 1, '失败清除了缓存'); await closeSettings(); return { editToggle: true, failedRefreshCache: count, manualRequests: report.sourceRequests };
  });
  await test('新增/自动/全部拉取底层拒绝；旧配置真实文件导入不带回6内置', async () => {
    const fixture = await page.evaluate(async () => {
      const store = (await window.__guanImport('/src/stores/use-prompt-source-store.ts')).usePromptSourceStore.getState();
      const api = await window.__guanImport('/src/services/api/prompts.ts'); const denied = [];
      for (const [name, run] of [['add', () => store.addSource()], ['saveNew', () => store.saveSource({ id: 'new' })], ['schedule', () => store.updateSchedule('intervalMinutes', 60)], ['all', () => api.refreshAllSources()], ['auto', () => api.refreshDueSources()]]) {
        try { await run(); } catch (error) { if (error.code === 'product_feature_disabled') denied.push(name); }
      }
      const { config, webdav } = (await window.__guanImport('/src/stores/use-config-store.ts')).useConfigStore.getState();
      const ids = ['davidwu-gpt-image2-prompts', 'freestylefly-gpt-image-2', 'awesome-gpt-image', 'awesome-gpt4o-image-prompts', 'youmind-gpt-image-2', 'youmind-nano-banana-pro'];
      return { denied, data: { app: 'infinite-canvas', version: 1, config, webdav, promptSources: { sources: [...store.sources, ...ids.map(id => ({ id, builtIn: true }))], schedule: store.schedule } } };
    });
    check(fixture.denied.length === 5, '底层门禁未全拒绝：' + fixture.denied);
    await openSettings(); await settings().locator('input[type="file"]').setInputFiles({ name: 'synthetic-old-config.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture.data)) });
    await page.waitForTimeout(400);
    const ids = await page.evaluate(async () => (await window.__guanImport('/src/stores/use-prompt-source-store.ts')).usePromptSourceStore.getState().sources.map(s => s.id));
    check(ids.length === 2 && ids.includes('synthetic-existing') && ids.includes('banana-prompt-quicker'), '导入恢复了已移除来源'); await closeSettings();
    return { denied: fixture.denied, importedIds: ids };
  });
  await test('新资料默认仅1内置、浅深和窄屏设置可反复关闭、无异常或未知外网', async () => {
    await page.evaluate(() => localStorage.removeItem('infinite-canvas:prompt_source_store_v2'));
    await page.reload({ waitUntil: 'domcontentloaded' }); await header().waitFor();
    const ids = await page.evaluate(async () => (await window.__guanImport('/src/stores/use-prompt-source-store.ts')).usePromptSourceStore.getState().sources.map(s => s.id));
    check(JSON.stringify(ids) === '["banana-prompt-quicker"]', '新资料并非单默认来源');
    for (let i = 0; i < 3; i++) { await openSettings(); await closeSettings(); }
    await page.setViewportSize({ width: 390, height: 844 }); await openSettings(); await settings().getByRole('tab', { name: '提示词来源', exact: true }).click(); await capture('窄屏单来源'); await closeSettings();
    check(report.errors.length === 0 && report.unexpectedRequests.length === 0, '异常或未知外网：' + JSON.stringify(report));
    return { newDefaults: ids, settingsCycles: 3, errors: 0, unexpectedRequests: 0 };
  });
  report.passed = true; await page.evaluate(value => { window.__guanSingleSourceAcceptance = value; }, report); console.log(JSON.stringify(report));
}
