async (page) => {
  const origin = 'http://localhost:3100';
  const report = { origin, results: [], errors: [], externalRequests: [], sourceTimers: [] };
  if (page.url() !== 'about:blank' && new URL(page.url()).origin !== origin) throw Error('只允许3100独立测试资料');
  const check = (value, message) => { if (!value) throw Error(message); };
  page.on('pageerror', error => report.errors.push(error.message));
  await page.context().unroute('**/*');
  await page.context().route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    report.externalRequests.push(url.origin + url.pathname);
    return route.abort();
  });
  await page.addInitScript(() => {
    window.__sourceIntervals = [];
    const original = window.setInterval;
    window.setInterval = function (...args) {
      const stack = new Error().stack || '';
      if (stack.includes('use-prompt-source-scheduler')) window.__sourceIntervals.push(stack);
      return original.apply(this, args);
    };
  });
  const test = async (name, run) => {
    try { report.results.push({ name, passed: true, evidence: await run() }); }
    catch (error) { report.results.push({ name, passed: false, error: error.message }); throw error; }
    finally { await page.evaluate(value => { window.__guanThreeAcceptance = value; }, report); }
  };
  const settings = () => page.getByRole('dialog', { name: /配置与用户偏好/ });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '画布设置', exact: true }).waitFor();
  await test('首页设置只保留渠道、偏好、本地存储；无脚本编辑入口', async () => {
    await page.getByRole('button', { name: '画布设置', exact: true }).click();
    const dialog = settings(); await dialog.waitFor();
    const tabs = await dialog.getByRole('tab').allTextContents();
    check(JSON.stringify(tabs) === JSON.stringify(['渠道', '偏好设置', '本地存储']), '设置页签不符');
    await dialog.getByRole('button', { name: '编辑', exact: true }).first().click();
    const drawer = page.getByRole('dialog', { name: '编辑渠道', exact: true }); await drawer.waitFor();
    check(await drawer.getByRole('button', { name: /调用脚本|编辑脚本/ }).count() === 0, '残留脚本按钮');
    check(await page.locator('.cm-editor').count() === 0, '脚本编辑器仍挂载');
    await drawer.getByRole('button', { name: '关闭', exact: true }).click(); await drawer.waitFor({ state: 'hidden' });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    return { tabs, editorMounted: false };
  });
  const fixture = await page.evaluate(async () => {
    const config = await window.__guanImport('/src/stores/use-config-store.ts');
    const { importAppConfig } = await window.__guanImport('/src/services/config-file.ts');
    const localforage = (await window.__guanImport('/node_modules/.vite/deps/localforage.js')).default;
    const source = { id: 'synthetic-stage5-source', name: '合成旧来源', url: 'https://source.example.invalid/prompts.json', homepage: 'https://source.example.invalid', enabled: true, builtIn: false };
    const script = 'globalThis.__forbiddenScriptExecuted = true; return [];';
    const channel = config.createModelChannel({ id: 'synthetic-stage5-channel', name: '合成脚本渠道', baseUrl: 'https://api.example.invalid', apiKey: 'synthetic-not-a-real-key', models: [{ name: 'scripted-image', capability: 'image', script }, { name: 'ordinary-image', capability: 'image' }] });
    const scriptedModel = config.encodeChannelModel(channel.id, 'scripted-image');
    const data = { app: 'infinite-canvas', version: 1, exportedAt: '2020-01-01T00:00:00Z', config: { ...config.useConfigStore.getState().config, channels: [channel], models: config.modelOptionsFromChannels([channel]), imageModel: scriptedModel, model: scriptedModel, count: '1', canvasImageCount: '1', autoFocusOnSelect: false }, webdav: config.useConfigStore.getState().webdav, promptSources: { sources: [source], schedule: { intervalMinutes: 30, lastFetchedAt: '2020-01-01T00:00:00Z' } } };
    await importAppConfig(new File([JSON.stringify(data)], 'synthetic.json', { type: 'application/json' }));
    const cache = { sourceId: source.id, items: [{ id: 'synthetic-prompt', title: '缓存尺寸展示', prompt: '合成尺寸展示提示词', tags: ['尺寸'] }], fetchedAt: 0, signature: 'deliberately-stale', count: 1, lastSuccessAt: '2020-01-01T00:00:00Z', lastError: '' };
    await localforage.createInstance({ name: 'infinite-canvas', storeName: 'prompt_cache' }).setItem('prompt-source:' + source.id, cache);
    const { useCanvasStore } = await window.__guanImport('/src/stores/canvas/use-canvas-store.ts');
    const id = useCanvasStore.getState().createProject('三项关闭合成验收');
    useCanvasStore.getState().updateProject(id, { nodes: [
      { id: 'stage5-text', type: 'text', title: '保存验收', position: { x: 60, y: 140 }, width: 280, height: 170, metadata: { content: '三项关闭后保存原文', status: 'success' } },
      { id: 'stage5-config', type: 'config', title: '脚本拒绝验收', position: { x: 450, y: 140 }, width: 300, height: 350, metadata: { generationMode: 'image', model: scriptedModel, prompt: '合成测试图', content: '合成测试图', count: 1, status: 'idle' } },
    ], connections: [], viewport: { x: 0, y: 0, k: 1 } });
    return { id, source, script, cache, scriptedModel };
  });
  report.fixture = fixture;
  await page.waitForTimeout(1200);
  await page.goto(origin + '/canvas/' + fixture.id, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-node-id="stage5-text"]').waitFor();
  await test('过期且签名变化的缓存仍可搜索；旧配置hydrate不触发刷新或定时器', async () => {
    const result = await page.evaluate(async fixture => {
      const api = await window.__guanImport('/src/services/api/prompts.ts');
      const sources = (await window.__guanImport('/src/stores/use-prompt-source-store.ts')).usePromptSourceStore.getState();
      const config = (await window.__guanImport('/src/stores/use-config-store.ts')).useConfigStore.getState().config;
      const rows = await api.fetchPrompts({ keyword: '尺寸展示' });
      const empty = await api.fetchSourcePrompts(sources.sources.find(s => s.builtIn).id);
      const localforage = (await window.__guanImport('/node_modules/.vite/deps/localforage.js')).default;
      const cache = await localforage.createInstance({ name: 'infinite-canvas', storeName: 'prompt_cache' }).getItem('prompt-source:' + fixture.source.id);
      return { matches: rows.total, cacheUnchanged: JSON.stringify(cache) === JSON.stringify(fixture.cache), noCacheItems: empty.length, sourceRetained: sources.sources.some(s => s.id === fixture.source.id && s.url === fixture.source.url), intervalRetained: sources.schedule.intervalMinutes, scriptRetained: config.channels[0].models[0].script === fixture.script, timers: window.__sourceIntervals.length };
    }, fixture);
    check(result.matches === 1 && result.cacheUnchanged && result.noCacheItems === 0 && result.sourceRetained && result.intervalRetained === 30 && result.scriptRetained && result.timers === 0, '缓存或hydrate行为不符');
    check(report.externalRequests.length === 0, '仍发起外部来源请求');
    return result;
  });
  await test('深层脚本/刷新/来源接口均明确拒绝，无执行或网络；普通模型解析不变', async () => {
    const result = await page.evaluate(async fixture => {
      const { resolveModelScript, useConfigStore, encodeChannelModel } = await window.__guanImport('/src/stores/use-config-store.ts');
      const { runModelPlugin } = await window.__guanImport('/src/services/api/model-plugin.ts');
      const { runPromptSource } = await window.__guanImport('/src/services/api/prompt-source-runtime.ts');
      const api = await window.__guanImport('/src/services/api/prompts.ts');
      const store = (await window.__guanImport('/src/stores/use-prompt-source-store.ts')).usePromptSourceStore.getState();
      const calls = [() => resolveModelScript(useConfigStore.getState().config, fixture.scriptedModel), () => runModelPlugin({ capability: 'image', script: fixture.script, config: useConfigStore.getState().config }), () => runPromptSource(fixture.source), () => api.refreshSource(fixture.source.id), () => api.refreshAllSources(), () => api.refreshDueSources(1), () => store.addSource(), () => store.saveSource(fixture.source), () => store.removeSource(fixture.source.id), () => store.toggleSource(fixture.source.id, false), () => store.updateSchedule('intervalMinutes', 0)];
      const denied = [];
      for (const call of calls) { try { await call(); denied.push(false); } catch (error) { denied.push(error.code === 'product_feature_disabled'); } }
      return { denied, executed: Boolean(window.__forbiddenScriptExecuted), ordinaryScript: resolveModelScript(useConfigStore.getState().config, encodeChannelModel('synthetic-stage5-channel', 'ordinary-image')) };
    }, fixture);
    check(result.denied.length === 11 && result.denied.every(Boolean) && !result.executed && result.ordinaryScript === '', '深层门禁未生效');
    check(report.externalRequests.length === 0, '深层接口仍出网');
    return result;
  });
  await test('旧脚本禁用提示可见、编辑器不挂载，非法来源页签回退渠道', async () => {
    await page.evaluate(async () => (await window.__guanImport('/src/stores/use-config-store.ts')).useConfigStore.getState().openConfigDialog(false, 'prompt-sources'));
    const dialog = settings(); await dialog.waitFor();
    check(await dialog.getByRole('tab', { name: '渠道', exact: true }).getAttribute('aria-selected') === 'true', '来源页签未回退');
    await dialog.getByRole('button', { name: '编辑', exact: true }).first().click();
    const drawer = page.getByRole('dialog', { name: '编辑渠道', exact: true }); await drawer.waitFor();
    await drawer.getByText('自定义脚本已停用', { exact: true }).waitFor();
    check(await drawer.getByRole('button', { name: /脚本/ }).count() === 0 && await page.locator('.cm-editor').count() === 0, '残留编辑入口');
    await drawer.getByRole('button', { name: '关闭', exact: true }).click(); await drawer.waitFor({ state: 'hidden' });
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '导出配置', exact: true }).click();
    await (await download).saveAs('__ARTIFACT_DIR__/合成配置.json');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    return { notice: true, noEditor: true, configDownload: true };
  });
  await test('文本UI编辑写入IndexedDB，刷新不丢失；快捷键弹窗仍可关闭', async () => {
    const node = page.locator('[data-node-id="stage5-text"]');
    await node.dblclick({ position: { x: 100, y: 80 } });
    await node.locator('textarea').fill('三项关闭后仍可保存并刷新');
    // 先退出编辑并排空作者400ms保存防抖，避免瞬时读回通过就立即刷新。
    await node.locator('textarea').press('Escape');
    await node.getByText('三项关闭后仍可保存并刷新', { exact: true }).waitFor();
    await page.waitForTimeout(1200);
    await page.waitForFunction(async id => {
      const { localForageStorage } = await window.__guanImport('/src/lib/localforage-storage.ts');
      return JSON.parse(await localForageStorage.getItem('infinite-canvas:canvas_store') || '{}').state?.projects.find(p => p.id === id)?.nodes.find(n => n.id === 'stage5-text')?.metadata.content === '三项关闭后仍可保存并刷新';
    }, fixture.id);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await node.getByText('三项关闭后仍可保存并刷新', { exact: true }).waitFor();
    check(await page.getByRole('button', { name: '配置', exact: true }).count() === 0 && await page.getByRole('link', { name: 'GitHub', exact: true }).count() === 0, '右上双入口回归');
    await page.getByRole('button', { name: '快捷键', exact: true }).first().click();
    const dialog = page.getByRole('dialog').last(); await dialog.waitFor();
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    return { indexedDBReadBack: true, reloadRetained: true, shortcuts: true };
  });
  await test('实际点击脚本模型开始生成：显示停用原因，任务收尾而不执行或降级请求', async () => {
    await page.locator('[data-node-id="stage5-config"]').getByRole('button', { name: '开始生成', exact: true }).click();
    await page.getByText(/自定义模型调用脚本已关闭/).first().waitFor();
    await page.waitForFunction(async id => {
      const p = (await window.__guanImport('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore.getState().openProject(id);
      return p.nodes.some(n => n.metadata?.errorDetails?.includes('自定义模型调用脚本已关闭')) && p.nodes.every(n => n.metadata?.status !== 'loading');
    }, fixture.id);
    check(report.externalRequests.length === 0 && !await page.evaluate(() => Boolean(window.__forbiddenScriptExecuted)), '生成错误后执行脚本或外部请求');
    return { visibleDisabledError: true, noLoadingNodes: true, noExternalRequest: true, scriptExecuted: false };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await test('窄屏保留画布和快捷键入口，没有新增页面错误或来源请求', async () => {
    await page.getByRole('button', { name: '快捷键', exact: true }).first().waitFor();
    check(await page.locator('[data-node-id="stage5-text"]').count() === 1, '窄屏丢失画布');
    check(report.errors.length === 0 && report.externalRequests.length === 0, '发生页面错误或来源请求');
    report.sourceTimers = await page.evaluate(() => window.__sourceIntervals);
    return { viewport: '390x844', pageErrors: report.errors.length, externalRequests: report.externalRequests.length };
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  report.passed = true;
  await page.evaluate(value => { window.__guanThreeAcceptance = value; }, report);
  console.log(JSON.stringify(report));
}
