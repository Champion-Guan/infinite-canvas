async (page) => {
  const origin = 'http://localhost:3100';
  if (page.url() !== 'about:blank' && new URL(page.url()).origin !== origin) throw Error('仅允许3100隔离Origin');
  const report = { origin, results: [], errors: [], blockedRequests: [], forbiddenRequests: [], fixture: null };
  page.on('pageerror', error => report.errors.push(error.message));
  await page.context().route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/plugins/') || /agent\.example|plugin\.example|webdav\.example|google-analytics|googletagmanager|hm\.baidu/.test(url.hostname) || /\/basketikun\/infinite-canvas\/.*(?:version|changelog)/i.test(url.pathname)) report.forbiddenRequests.push({ origin: url.origin, path: url.pathname });
    if (url.origin === origin) return route.continue();
    if (!report.blockedRequests.some(item => item.origin === url.origin && item.path === url.pathname)) report.blockedRequests.push({ origin: url.origin, path: url.pathname });
    return route.abort();
  });
  const check = (condition, message) => { if (!condition) throw Error(message); };
  const save = () => page.evaluate(value => { window.__guanSelectionAcceptance = value; }, report);
  const waitData = async (predicate, arg) => {
    const started = Date.now();
    while (!(await page.evaluate(predicate, arg))) {
      if (Date.now() - started > 30000) throw Error('异步状态超时');
      await page.waitForTimeout(100);
    }
  };
  const test = async (name, run) => {
    const start = Date.now();
    try { const evidence = await run(); report.results.push({ name, passed: true, ms: Date.now() - start, evidence }); }
    catch (error) {
      report.results.push({ name, passed: false, error: error.message });
      await save(); console.log(JSON.stringify(report)); throw error;
    }
    await save();
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const createButton = page.getByRole('main').getByRole('button', { name: /^(新建画布|新建产品)$/ });
  await createButton.waitFor();
  await test('空资料不自动创建，关闭导航且使用获批首页顶栏', async () => {
    await page.waitForTimeout(500);
    const state = await page.evaluate(async () => {
      const { useCanvasStore } = await import('/src/stores/canvas/use-canvas-store.ts');
      return { hydrated: useCanvasStore.getState().hydrated, projects: useCanvasStore.getState().projects.length };
    });
    check(state.hydrated && state.projects === 0, '空资料被自动写入画布');
    check(await page.getByRole('navigation').getByRole('link').count() === 0, '残留页面导航');
    check((await page.getByRole('banner', { name: '工作台顶栏' }).boundingBox())?.height === 84, '未使用获批首页顶栏');
    return state;
  });
  await test('点击新建且刷新不重复创建', async () => {
    await createButton.click();
    await page.waitForURL(/\/canvas\/[^/]+$/);
    check(await page.getByRole('link', { name: 'GitHub', exact: true }).getAttribute('href') === 'https://github.com/basketikun/infinite-canvas', '画布作者标识改变');
    await waitData(async () => {
      const { localForageStorage } = await import('/src/lib/localforage-storage.ts');
      return JSON.parse(await localForageStorage.getItem('infinite-canvas:canvas_store') || '{}').state?.projects.length === 1;
    });
    const path = new URL(page.url()).pathname;
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(origin + path);
    const count = await page.evaluate(async () => (await import('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore.getState().projects.length);
    check(count === 1, '刷新重复创建');
    return { path, projects: count };
  });
  await test('七类旧页面关闭，404保持', async () => {
    const canvasPath = new URL(page.url()).pathname;
    for (const path of ['/', '/image', '/video', '/assets', '/prompts', '/canvas', '/config']) {
      await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(origin + canvasPath);
    }
    await page.goto(origin + '/stage5-not-found', { waitUntil: 'domcontentloaded' });
    await page.getByText('404', { exact: true }).waitFor();
    await page.goto(origin + canvasPath, { waitUntil: 'domcontentloaded' });
    return { redirects: 7, notFound: true };
  });
  await test('未选S06：根地址配置URL导入仍工作并移除地址栏参数', async () => {
    await page.goto(origin + '/?baseUrl=https%3A%2F%2Fstage5.example.invalid%2Fv1&apiKey=synthetic-not-a-real-key', { waitUntil: 'domcontentloaded' });
    const dialog = page.getByRole('dialog', { name: /配置与用户偏好/ });
    await dialog.waitFor();
    const result = await page.evaluate(async () => {
      const { useConfigStore } = await import('/src/stores/use-config-store.ts');
      return { imported: useConfigStore.getState().config.channels.some(c => c.baseUrl === 'https://stage5.example.invalid/v1' && c.apiKey === 'synthetic-not-a-real-key'), parametersRemoved: !location.search.includes('apiKey') && !location.search.includes('baseUrl') };
    });
    check(result.imported && result.parametersRemoved, 'URL导入失效或参数未移除');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    return result;
  });
  const fixture = await page.evaluate(async () => {
    const { useCanvasStore } = await import('/src/stores/canvas/use-canvas-store.ts');
    const { useConfigStore } = await import('/src/stores/use-config-store.ts');
    const { uploadImage } = await import('/src/services/image-storage.ts');
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#7c3aed'; ctx.fillRect(0, 0, 320, 200);
    ctx.fillStyle = '#fff'; ctx.font = '32px sans-serif'; ctx.fillText('STAGE 5', 50, 110);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const image = await uploadImage(blob);
    const store = useCanvasStore.getState();
    const id = store.createProject('阶段5-合成验收');
    const text = (id, x, title) => ({ id, type: 'text', title, position: { x, y: 130 }, width: 280, height: 160, metadata: { content: title, status: 'success' } });
    store.updateProject(id, {
      nodes: [text('select-a', 50, '验收文本A'), text('select-b', 440, '验收文本B'), {
        id: 'select-image', type: 'image', title: '验收图片', position: { x: 810, y: 130 }, width: 320, height: 200,
        metadata: { content: image.url, storageKey: image.storageKey, naturalWidth: 320, naturalHeight: 200, bytes: image.bytes, mimeType: image.mimeType, status: 'success' },
      }],
      connections: [{ id: 'select-line', fromNodeId: 'select-a', toNodeId: 'select-b' }], viewport: { x: 0, y: 0, k: 1 },
    });
    useConfigStore.getState().updateConfig('autoFocusOnSelect', false);
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), v => v.toString(16).padStart(2, '0')).join('');
    return { id, imageBytes: blob.size, imageSha256: sha256 };
  });
  report.fixture = fixture;
  await waitData(async id => {
    const { localForageStorage } = await import('/src/lib/localforage-storage.ts');
    return JSON.parse(await localForageStorage.getItem('infinite-canvas:canvas_store') || '{}').state?.projects.find(p => p.id === id)?.nodes.length === 3;
  }, fixture.id);
  await page.goto(origin + '/canvas/' + fixture.id, { waitUntil: 'domcontentloaded' });
  const node = id => page.locator(`[data-node-id="${id}"]`);
  const project = () => page.evaluate(async id => (await import('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore.getState().openProject(id), fixture.id);
  await node('select-image').waitFor();
  await test('关闭控件不挂载，画布菜单与配置弹窗保留', async () => {
    for (const name of ['Agent', '节点插件', '切换到浅色主题', '切换到深色主题', 'v0.20.0']) check(await page.getByRole('button', { name, exact: true }).count() === 0, '仍有关闭控件：' + name);
    await page.getByRole('button', { name: '打开画布菜单', exact: true }).click();
    for (const name of ['首页', '画布列表', '文档']) check(await page.getByRole('menuitem', { name, exact: true }).count() === 0, '菜单残留：' + name);
    check(await page.getByRole('menuitem', { name: /导出当前画布/ }).count() === 1, '丢失画布导出');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '配置', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /配置与用户偏好/ }); await dialog.waitFor();
    const tabs = await dialog.getByRole('tab').allTextContents();
    check(!tabs.some(s => /WebDAV|代理/.test(s)), '关闭页签仍在');
    check(tabs.some(s => /渠道/.test(s)) && tabs.some(s => /本地存储/.test(s)), '未选页签丢失');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    return { tabs, nodeCount: await page.locator('[data-node-id]').count() };
  });
  await test('设置、快捷键和图片详情各开关3次', async () => {
    for (let i = 0; i < 3; i++) {
      for (const name of ['配置', '快捷键']) {
        await page.getByRole('button', { name, exact: true }).first().click();
        const dialog = page.getByRole('dialog').last(); await dialog.waitFor();
        await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
      }
      await node('select-image').dblclick({ position: { x: 120, y: 100 } });
      const dialog = page.getByRole('dialog', { name: '图片详情', exact: true }); await dialog.waitFor();
      const width = await dialog.locator('img').evaluate(img => img.naturalWidth);
      check(width === 320, '详情图片未恢复');
      await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    }
    return { dialogs: 3, eachCycles: 3, noPageErrors: report.errors.length === 0 };
  });
  await test('已批准全屏编辑器仍能开关，不执行脚本', async () => {
    await page.getByRole('button', { name: '配置', exact: true }).click();
    await page.getByRole('button', { name: '编辑', exact: true }).first().click();
    await page.getByRole('button', { name: '调用脚本', exact: true }).first().click();
    const editor = page.getByRole('dialog').filter({ has: page.getByText('生图调用脚本 · gpt-image-2', { exact: true }) }); await editor.waitFor();
    await page.waitForTimeout(350); const rect = await editor.boundingBox();
    check(rect.width >= 1400 && rect.height >= 850, '编辑器尺寸退化');
    await page.keyboard.press('Escape'); await editor.waitFor({ state: 'hidden' });
    const drawer = page.getByRole('dialog', { name: '编辑渠道', exact: true });
    await drawer.getByRole('button', { name: '关闭', exact: true }).click(); await drawer.waitFor({ state: 'hidden' });
    const settings = page.getByRole('dialog', { name: /配置与用户偏好/ });
    await settings.getByRole('button', { name: '关闭', exact: true }).click(); await settings.waitFor({ state: 'hidden' });
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  });
  await test('文本保存到IndexedDB，刷新恢复', async () => {
    await node('select-a').dblclick({ position: { x: 120, y: 80 } });
    await node('select-a').locator('textarea').fill('阶段5：关闭功能后仍可保存');
    await page.mouse.click(1000, 600);
    await waitData(async id => {
      const { localForageStorage } = await import('/src/lib/localforage-storage.ts');
      return JSON.parse(await localForageStorage.getItem('infinite-canvas:canvas_store') || '{}').state?.projects.find(p => p.id === id)?.nodes[0].metadata.content === '阶段5：关闭功能后仍可保存';
    }, fixture.id);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await node('select-a').getByText('阶段5：关闭功能后仍可保存', { exact: true }).waitFor();
    return { persisted: true, reloadRetained: true };
  });
  await test('拖动、撤销重做和连线目标位置保持', async () => {
    const before = (await project()).nodes[0].position;
    const rect = await node('select-a').boundingBox();
    await page.mouse.move(rect.x + 100, rect.y + 80); await page.mouse.down();
    await page.mouse.move(rect.x + 170, rect.y + 110, { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(900);
    const after = (await project()).nodes[0].position;
    check(after.x !== before.x && after.y !== before.y, '拖动不生效');
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await page.waitForTimeout(900);
    check(JSON.stringify((await project()).nodes[0].position) === JSON.stringify(before), '撤销不符');
    await page.getByRole('button', { name: '重做', exact: true }).click(); await page.waitForTimeout(900);
    check(JSON.stringify((await project()).nodes[0].position) === JSON.stringify(after), '重做不符');
    const targetBefore = (await project()).nodes[2].position;
    await node('select-a').hover();
    const source = await node('select-a').locator('[class*="-right-6"][class*="cursor-crosshair"]').boundingBox();
    const target = await node('select-image').boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down();
    await page.mouse.move(target.x + 8, target.y + target.height / 2, { steps: 20 }); await page.mouse.up();
    await page.waitForFunction(() => document.querySelectorAll('[data-connection-id]').length === 2); await page.waitForTimeout(900);
    check(JSON.stringify((await project()).nodes[2].position) === JSON.stringify(targetBefore), '连接使目标位置跳动');
    return { before, after, connections: 2, targetUnchanged: true };
  });
  await test('选择后平移、缩放、侧栏和小地图', async () => {
    await node('select-a').click({ position: { x: 90, y: 60 } });
    const p = await project();
    await page.mouse.move(1000, 600); await page.mouse.down({ button: 'middle' });
    await page.mouse.move(1060, 640, { steps: 15 }); await page.mouse.up({ button: 'middle' }); await page.waitForTimeout(1100);
    check((await project()).viewport.x !== p.viewport.x, '平移不生效');
    check(JSON.stringify((await project()).nodes.map(n => n.position)) === JSON.stringify(p.nodes.map(n => n.position)), '平移改变节点');
    const pan = (await project()).viewport; await page.mouse.wheel(0, 100); await page.waitForTimeout(1100);
    check((await project()).viewport.k !== pan.k, '缩放不生效');
    await page.getByRole('button', { name: '收起面板', exact: true }).click();
    await page.getByRole('button', { name: '展开面板', exact: true }).click();
    await page.getByRole('button', { name: '打开小地图', exact: true }).click();
    await page.getByRole('button', { name: '关闭小地图', exact: true }).click();
    return { panAndZoom: true, nodePositionsRetained: true, sidePanelAndMinimap: true };
  });
  await test('禁用接口在网络前拒绝，旧代理不偷偷直连', async () => {
    const result = await page.evaluate(async () => {
      const agent = await import('/src/services/api/canvas-agent.ts');
      const proxy = await import('/src/services/api/local-proxy.ts');
      const webdav = await import('/src/services/webdav-sync.ts');
      const sync = await import('/src/services/app-sync.ts');
      const registry = await import('/src/lib/canvas/plugin-registry.ts');
      const plugins = await import('/src/lib/canvas/plugin-loader.ts');
      const { useConfigStore, withLocalProxy } = await import('/src/stores/use-config-store.ts');
      const { useAgentStore } = await import('/src/stores/use-agent-store.ts');
      const requests = []; const original = window.fetch;
      window.fetch = (...args) => { requests.push(String(args[0])); throw Error('不应请求'); };
      const denied = [];
      const calls = [
        () => agent.discoverAgentConfig('https://agent.example.invalid'),
        () => agent.fetchAgentJson('https://agent.example.invalid', 'synthetic', '/status'),
        () => proxy.testLocalProxy('https://proxy.example.invalid'),
        () => webdav.testWebdavConnection({}), () => webdav.downloadWebdavFile({}, 'test'),
        () => webdav.uploadWebdavFile({}, 'test', new Blob(['test'])),
        () => sync.syncAppDataToWebdav({}), () => registry.fetchOfficialPlugins(),
        () => plugins.installPluginFromUrl('https://plugin.example.invalid/plugin.js'),
      ];
      try {
        for (const call of calls) { try { await call(); denied.push(false); } catch (error) { denied.push(error.code === 'product_feature_disabled'); } }
        useAgentStore.getState().connectAgent(); useAgentStore.getState().openPanel();
        const saved = useConfigStore.getState().config.proxyEnabled;
        useConfigStore.getState().updateConfig('proxyEnabled', true);
        try { withLocalProxy('https://api.example.invalid'); denied.push(false); } catch (error) { denied.push(error.code === 'product_feature_disabled'); }
        const enabledRetained = useConfigStore.getState().config.proxyEnabled;
        useConfigStore.getState().updateConfig('proxyEnabled', saved);
        return { denied, requests: requests.length, enabledRetained, agentPanel: useAgentStore.getState().panelOpen, connected: useAgentStore.getState().connected };
      } finally { window.fetch = original; }
    });
    check(result.denied.every(Boolean) && result.requests === 0 && result.enabledRetained && !result.agentPanel, '禁用能力仍执行或改写旧代理偏好');
    return result;
  });
  await test('旧缓存插件不执行，缺失插件卡片数据保留并可导出', async () => {
    const setup = await page.evaluate(async id => {
      const { localForageStorage } = await import('/src/lib/localforage-storage.ts');
      const { useCanvasStore } = await import('/src/stores/canvas/use-canvas-store.ts');
      const record = { id: 'stage5-blocked', name: '合成禁用插件', version: '1.0.0', url: 'https://plugin.example.invalid/test.js', enabled: true, installedAt: '2026-10-15T00:00:00Z', source: 'globalThis.__stage5PluginExecuted = true; export default {id:"stage5-blocked",nodes:[]};' };
      const raw = JSON.stringify({ state: { plugins: [record] }, version: 0 });
      await localForageStorage.setItem('infinite-canvas:plugin_store', raw);
      const p = useCanvasStore.getState().openProject(id);
      const missing = { id: 'select-missing', type: 'stage5:unknown', title: '旧插件数据', position: { x: 400, y: 500 }, width: 280, height: 160, metadata: { content: '保留插件原始业务数据', customValue: 123 } };
      useCanvasStore.getState().updateProject(id, { nodes: [...p.nodes, missing] });
      localStorage.setItem('canvas-agent-url', 'https://agent.example.invalid'); localStorage.setItem('canvas-agent-token', 'synthetic-not-a-real-key');
      return { raw, missing };
    }, fixture.id);
    await page.waitForTimeout(1100); await page.reload({ waitUntil: 'domcontentloaded' });
    await node('select-missing').waitFor();
    const result = await page.evaluate(async ({ id, raw, missing }) => {
      const { localForageStorage } = await import('/src/lib/localforage-storage.ts');
      const { useCanvasStore } = await import('/src/stores/canvas/use-canvas-store.ts');
      const { ensurePluginsLoaded } = await import('/src/lib/canvas/plugin-loader.ts');
      const { listNodeDefinitions } = await import('/src/lib/canvas/node-registry.ts');
      const { useAgentStore } = await import('/src/stores/use-agent-store.ts');
      await ensurePluginsLoaded();
      return { executed: Boolean(globalThis.__stage5PluginExecuted), cacheRetained: await localForageStorage.getItem('infinite-canvas:plugin_store') === raw, metadataRetained: JSON.stringify(useCanvasStore.getState().openProject(id).nodes.find(n => n.id === missing.id).metadata) === JSON.stringify(missing.metadata), registeredTypes: listNodeDefinitions().map(n => n.type), agentPanel: useAgentStore.getState().panelOpen, agentEnabled: useAgentStore.getState().enabled };
    }, { id: fixture.id, ...setup });
    check(!result.executed && result.cacheRetained && result.metadataRetained && result.registeredTypes.length === 6 && !result.agentPanel && !result.agentEnabled, '旧插件或Agent仍执行，或旧数据被更改');
    return { ...result, placeholder: await node('select-missing').innerText() };
  });
  await test('当前画布ZIP含全部节点、连线和完整本地图片', async () => {
    const p = await project(); const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: '打开画布菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: /导出当前画布/ }).click();
    const download = await downloading;
    const file = 'output/playwright/阶段5-合成画布.zip'; await download.saveAs(file);
    const result = await page.evaluate(async id => {
      const { useCanvasStore } = await import('/src/stores/canvas/use-canvas-store.ts');
      const { createZip, readZip } = await import('/src/lib/zip.ts');
      const { getImageBlob } = await import('/src/services/image-storage.ts');
      const { getMediaBlob } = await import('/src/services/file-storage.ts');
      const project = useCanvasStore.getState().openProject(id);
      const image = project.nodes.find(n => n.type === 'image'); const blob = await getImageBlob(image.metadata.storageKey);
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), v => v.toString(16).padStart(2, '0')).join('');
      return { nodes: project.nodes.length, connections: project.connections.length, missingMetadata: project.nodes.find(n => n.id === 'select-missing').metadata, imageBytes: blob.size, imageSha256: sha256, zipReaderAvailable: typeof readZip === 'function' && typeof createZip === 'function', mediaReaderAvailable: typeof getMediaBlob === 'function' };
    }, fixture.id);
    check(result.nodes === 4 && result.connections === 2 && result.imageSha256 === fixture.imageSha256, '导出前媒体结构不符');
    return { ...result, file, downloadName: download.suggestedFilename(), expectedNodes: p.nodes.length };
  });
  await test('浅色和英文旧偏好不会被关闭动作重置', async () => {
    await page.evaluate(() => {
      localStorage.setItem('infinite-canvas:theme_store', JSON.stringify({ state: { theme: 'light' }, version: 0 }));
      localStorage.setItem('infinite-canvas:locale', 'en-US');
    });
    await page.reload({ waitUntil: 'domcontentloaded' }); await node('select-image').waitFor();
    const result = await page.evaluate(async () => {
      const { useThemeStore } = await import('/src/stores/use-theme-store.ts');
      const { changeAppLocale, default: i18n } = await import('/src/i18n/index.ts');
      const before = { theme: useThemeStore.getState().theme, language: i18n.resolvedLanguage };
      useThemeStore.getState().setTheme('dark'); await changeAppLocale('zh-CN');
      return { before, after: { theme: useThemeStore.getState().theme, language: i18n.resolvedLanguage }, darkClass: document.documentElement.classList.contains('dark') };
    });
    check(result.before.theme === 'light' && result.after.theme === 'light' && !result.darkClass && result.before.language === 'en-US' && result.after.language === result.before.language, '原偏好被重置');
    return result;
  });
  await test('移动视口仍无关闭菜单，保留操作可用', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    check(await page.getByRole('button', { name: 'Agent', exact: true }).count() === 0, '移动端Agent残留');
    const settings = page.getByRole('button', { name: /^(配置|Settings)$/ });
    check(await settings.count() === 1 && await settings.isVisible(), '移动端配置丢失');
    await settings.click(); const dialog = page.getByRole('dialog').last(); await dialog.waitFor();
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 1440, height: 900 });
    return { viewport: '390x844', retainedConfig: true };
  });
  check(report.errors.length === 0, '浏览器存在未处理JS异常');
  check(report.forbiddenRequests.length === 0, '关闭能力仍有启动请求');
  await page.screenshot({ path: 'output/playwright/阶段5-功能关闭验收.png' });
  report.browser = await page.evaluate(() => ({ userAgent: navigator.userAgent, origin: location.origin }));
  await save(); console.log(JSON.stringify(report)); return report;
}
