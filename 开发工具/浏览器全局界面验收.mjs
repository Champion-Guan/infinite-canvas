async (page) => {
  const origin = 'http://localhost:3100';
  const report = { origin, results: [], pageErrors: [], unexpectedRequests: [], sourceRequests: 0 };
  if (page.url() !== 'about:blank' && new URL(page.url()).origin !== origin) throw Error('只允许3100独立测试资料');
  const check = (value, message) => { if (!value) throw Error(message); };
  page.on('pageerror', error => report.pageErrors.push(error.message));
  let offline = false;
  await page.context().route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.href === 'https://source.example.invalid/prompts.json') {
      report.sourceRequests++;
      return route.fulfill({ status: offline ? 503 : 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify([{ id: 'fixture-prompt', title: '合成尺寸展示', prompt: '展示产品尺寸，保持比例', tags: ['尺寸'] }]) });
    }
    report.unexpectedRequests.push(url.origin + url.pathname);
    return route.abort();
  });
  await page.addInitScript(() => {
    window.__sourceTimers = [];
    const interval = window.setInterval, clear = window.clearInterval;
    window.setInterval = function (callback, delay, ...args) {
      const id = interval.call(this, callback, delay, ...args);
      if ((new Error().stack || '').includes('use-prompt-source-scheduler')) window.__sourceTimers.push({ id, delay, callback });
      return id;
    };
    window.clearInterval = function (id) {
      window.__sourceTimers = window.__sourceTimers.filter(timer => timer.id !== id);
      return clear.call(this, id);
    };
    // 仅此独立浏览器的合成配置。既不清空存储，也不触碰用户Chrome。
    if (!sessionStorage.getItem('guan-global-fixture')) {
      const ids = ['banana-prompt-quicker', 'davidwu-gpt-image2-prompts', 'freestylefly-gpt-image-2', 'awesome-gpt-image', 'awesome-gpt4o-image-prompts', 'youmind-gpt-image-2', 'youmind-nano-banana-pro'];
      localStorage.setItem('infinite-canvas:prompt_source_store_v2', JSON.stringify({ state: { sources: ids.map(id => ({ id, builtIn: true, enabled: false })), schedule: { intervalMinutes: 0, lastFetchedAt: '' } }, version: 0 }));
      localStorage.setItem('infinite-canvas:theme_store', JSON.stringify({ state: { theme: 'dark' }, version: 0 }));
      sessionStorage.setItem('guan-global-fixture', '1');
    }
  });
  const test = async (name, run) => {
    try { report.results.push({ name, passed: true, evidence: await run() }); }
    catch (error) { report.results.push({ name, passed: false, error: error.message }); throw error; }
    finally { await page.evaluate(value => { window.__guanGlobalAcceptance = value; }, report); }
  };
  const header = () => page.getByRole('banner', { name: '工作台顶栏', exact: true });
  const settings = () => page.getByRole('dialog', { name: /配置与用户偏好/ });
  const openSettings = async () => { await page.getByRole('button', { name: '画布设置', exact: true }).click(); await settings().waitFor(); };
  const closeSettings = async () => { await settings().getByRole('button', { name: '关闭', exact: true }).click(); await settings().waitFor({ state: 'hidden' }); };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await header().waitFor();
  await test('初始HTML和React标题、原始紫色G资源一致；首页84px顶栏', async () => {
    check(await page.title() === 'AI生图工作台', 'React标题不一致');
    const data = await page.evaluate(async () => {
      const link = document.querySelector('link[rel="icon"]');
      const response = await fetch(link.href);
      const bytes = await response.arrayBuffer();
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
      return { href: link.getAttribute('href'), status: response.status, sha, title: document.title };
    });
    check(data.status === 200 && data.sha === 'ddd8aa5c975adde30e628b8a3c12cab92f5e0ae108785bad96bda8d48baab432', '图标资源不是原紫色G');
    const bounds = await header().boundingBox();
    check(bounds.y === 0 && bounds.height === 84, '顶栏尺寸改变');
    check(await header().count() === 1, '重复顶栏');
    await page.screenshot({ path: '__ARTIFACT_DIR__/首页深色.png' });
    return { ...data, bounds };
  });
  await test('主题按钮切换首页/Logo/AntD设置；刷新后保持，不重复挂载弹窗', async () => {
    await page.getByRole('button', { name: '切换浅色主题', exact: true }).click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark') && !document.documentElement.dataset.magicuiThemeVt);
    await openSettings();
    check(await settings().count() === 1 && await settings().isVisible(), '设置重复挂载或未打开');
    await closeSettings();
    await page.reload({ waitUntil: 'domcontentloaded' }); await header().waitFor();
    check(await header().getAttribute('data-theme') === 'light', '刷新后主题未保留');
    const filter = await header().locator('img').evaluate(el => getComputedStyle(el).filter);
    check(filter === 'none', '浅色Logo滤镜错误');
    await page.screenshot({ path: '__ARTIFACT_DIR__/首页浅色.png' });
    return { theme: 'light', logoFilter: filter, reloadRetained: true, singleSettings: true };
  });
  const fixture = await page.evaluate(async () => {
    const { useCanvasStore } = await window.__guanImport('/src/stores/canvas/use-canvas-store.ts');
    const id = useCanvasStore.getState().createProject('全局顶栏合成验收');
    useCanvasStore.getState().updateProject(id, { nodes: [{ id: 'global-node', type: 'text', title: '全局验证节点', position: { x: 180, y: 220 }, width: 280, height: 180, metadata: { content: '顶栏加入后仍可操作', status: 'success' } }], connections: [], viewport: { x: 0, y: 0, k: 1 } });
    return { id };
  });
  await page.waitForTimeout(1200);
  await page.goto(origin + '/canvas/' + fixture.id, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-node-id="global-node"]').waitFor();
  await test('画布页保留同一84px顶栏、主题、单份设置，卡片拖动与缩放坐标正常', async () => {
    const bounds = await header().boundingBox();
    const main = await page.locator('main').boundingBox();
    check(bounds.height === 84 && main.y === 84 && main.height === 816, '画布可用高度不正确');
    await openSettings(); check(await settings().count() === 1, '画布重复设置弹窗'); await closeSettings();
    const node = page.locator('[data-node-id="global-node"]');
    const old = await node.boundingBox();
    await page.mouse.move(old.x + 100, old.y + 18); await page.mouse.down();
    await page.mouse.move(old.x + 180, old.y + 58, { steps: 10 }); await page.mouse.up();
    await page.waitForTimeout(600);
    const moved = await node.boundingBox();
    check(Math.abs(moved.x - old.x - 80) < 3 && Math.abs(moved.y - old.y - 40) < 3, '卡片拖动未跟随正确坐标');
    await page.mouse.move(main.x + main.width - 160, main.y + main.height - 100);
    await page.mouse.wheel(0, -180);
    await page.waitForTimeout(500);
    const zoomed = await node.boundingBox();
    check(Math.abs(zoomed.width - moved.width) > 1, '画布缩放未生效');
    await page.getByRole('button', { name: '切换深色主题', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.classList.contains('dark') && !document.documentElement.dataset.magicuiThemeVt);
    check(await header().getAttribute('data-theme') === 'dark', '画布顶栏主题不同步');
    await page.screenshot({ path: '__ARTIFACT_DIR__/画布深色顶栏.png' });
    return { bounds, main, drag: { x: moved.x - old.x, y: moved.y - old.y }, zoomChanged: true };
  });
  await openSettings();
  await test('提示词来源页签恢复，新增/编辑是真实来源管理，S03入口仍关闭', async () => {
    const tabs = await settings().getByRole('tab').allTextContents();
    check(JSON.stringify(tabs) === JSON.stringify(['渠道', '偏好设置', '提示词来源', '本地存储']), '页签不符合恢复范围');
    await settings().getByRole('tab', { name: '提示词来源', exact: true }).click();
    await settings().getByRole('button', { name: '新增来源', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '新增提示词来源', exact: true }); await drawer.waitFor();
    await drawer.getByLabel('来源名称', { exact: true }).fill('合成提示词来源');
    await drawer.getByLabel('JSON URL', { exact: true }).fill('https://source.example.invalid/prompts.json');
    await drawer.getByRole('button', { name: /^保\s*存$/ }).click(); await drawer.waitFor({ state: 'hidden' });
    await settings().getByText('合成提示词来源', { exact: true }).waitFor();
    check(await page.locator('.cm-editor').count() === 0, '自定义脚本编辑器被恢复');
    const state = await page.evaluate(async () => {
      const { usePromptSourceStore } = await window.__guanImport('/src/stores/use-prompt-source-store.ts');
      return usePromptSourceStore.getState().sources.find(s => s.name === '合成提示词来源');
    });
    report.sourceId = state.id;
    check(state.url === 'https://source.example.invalid/prompts.json' && state.enabled, '来源未真正保存');
    return { tabs, savedSource: state };
  });
  const sourceRow = () => settings().locator('.rounded-lg.border').filter({ has: page.getByText('合成提示词来源', { exact: true }) });
  await test('手动刷新经JSON响应更新本地缓存，UI显示条数和内容', async () => {
    await sourceRow().getByRole('button', { name: '立即拉取', exact: true }).click();
    await sourceRow().getByText('1 条', { exact: true }).waitFor();
    check(report.sourceRequests >= 1, '没有实际进入来源请求边界');
    await sourceRow().getByRole('button', { name: '查看内容', exact: true }).click();
    const modal = page.getByRole('dialog', { name: /合成提示词来源 · 提示词内容/ }); await modal.waitFor();
    await modal.getByText('合成尺寸展示', { exact: true }).waitFor();
    await page.keyboard.press('Escape'); await modal.waitFor({ state: 'hidden' });
    await page.screenshot({ path: '__ARTIFACT_DIR__/提示词来源设置.png' });
    return { sourceRequests: report.sourceRequests, visibleCount: 1, visibleContent: true };
  });
  await test('自动刷新沿用周期，注册一次计时器，到期调度请求并更新缓存', async () => {
    await page.evaluate(async sourceId => {
      const localforage = (await window.__guanImport('/node_modules/.vite/deps/localforage.js')).default;
      const cache = localforage.createInstance({ name: 'infinite-canvas', storeName: 'prompt_cache' });
      const value = await cache.getItem('prompt-source:' + sourceId);
      await cache.setItem('prompt-source:' + sourceId, { ...value, lastSuccessAt: '2020-01-01T00:00:00Z' });
    }, report.sourceId);
    const before = report.sourceRequests;
    const intervalSelector = settings().getByRole('combobox').last();
    await intervalSelector.click();
    // AntD 的 role=option 是隐藏的无障碍镜像；用真实键盘操作选择下一项。
    await intervalSelector.press('ArrowDown');
    await intervalSelector.press('Enter');
    check(await page.evaluate(async () => (await window.__guanImport('/src/stores/use-prompt-source-store.ts')).usePromptSourceStore.getState().schedule.intervalMinutes) === 30, 'UI未选择30分钟');
    await page.waitForFunction(() => window.__sourceTimers.length === 1);
    await page.waitForFunction(async sourceId => (await window.__guanImport('/src/services/api/prompts.ts')).fetchPromptSourceStatuses().then(states => states[sourceId].lastSuccessAt > '2020-01-01'), report.sourceId);
    check(report.sourceRequests > before, '启用自动刷新后未拉取到期来源');
    const timers = await page.evaluate(() => window.__sourceTimers.map(({ delay }) => ({ delay })));
    check(timers.length === 1 && timers[0].delay === 60_000, '自动调度计时器重复或周期错误');
    // 显式触发捕获的真实调度回调，模拟下一分钟，不篡改业务代码或等待真实30分钟。
    await page.evaluate(async sourceId => {
      const localforage = (await window.__guanImport('/node_modules/.vite/deps/localforage.js')).default;
      const cache = localforage.createInstance({ name: 'infinite-canvas', storeName: 'prompt_cache' });
      const value = await cache.getItem('prompt-source:' + sourceId);
      await cache.setItem('prompt-source:' + sourceId, { ...value, lastSuccessAt: '2020-01-01T00:00:00Z' });
      await window.__sourceTimers[0].callback();
    }, report.sourceId);
    // 原调度回调是 () => void tick()，不能把回调返回当成异步请求已完成。
    await page.waitForFunction(async sourceId => (await window.__guanImport('/src/services/api/prompts.ts')).fetchPromptSourceStatuses().then(states => states[sourceId].lastSuccessAt > '2020-01-01'), report.sourceId);
    check(report.sourceRequests >= before + 2, '下一次到期检查未刷新');
    return { timers, simulatedNextTick: true, sourceRequests: report.sourceRequests };
  });
  await test('失败保留缓存；关闭定时立即卸载调度，不放开自定义模型脚本', async () => {
    offline = true;
    await sourceRow().getByRole('button', { name: '立即拉取', exact: true }).click();
    await sourceRow().getByText('失败', { exact: true }).waitFor();
    const result = await page.evaluate(async sourceId => {
      const prompts = await window.__guanImport('/src/services/api/prompts.ts');
      const cached = await prompts.fetchSourcePrompts(sourceId);
      const { runModelPlugin } = await window.__guanImport('/src/services/api/model-plugin.ts');
      let rejected = false;
      try { await runModelPlugin({ capability: 'image', script: 'window.__shouldNotRun=true;return []', config: {} }); }
      catch (error) { rejected = error.code === 'product_feature_disabled'; }
      return { count: cached.length, prompt: cached[0].prompt, rejected, scriptExecuted: Boolean(window.__shouldNotRun) };
    }, report.sourceId);
    check(result.count === 1 && result.prompt === '展示产品尺寸，保持比例' && result.rejected && !result.scriptExecuted, '缓存保留或脚本禁用不正确');
    const intervalSelector = settings().getByRole('combobox').last();
    await intervalSelector.click();
    await intervalSelector.press('ArrowUp');
    await intervalSelector.press('Enter');
    await page.waitForFunction(() => window.__sourceTimers.length === 0);
    offline = false;
    await closeSettings();
    return { ...result, timersRemoved: true };
  });
  await test('刷新保留来源/主题/画布，404和窄屏仍显示全局顶栏', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' }); await header().waitFor();
    await page.locator('[data-node-id="global-node"]').waitFor();
    const state = await page.evaluate(async sourceId => {
      const { usePromptSourceStore } = await window.__guanImport('/src/stores/use-prompt-source-store.ts');
      return { sourceRetained: usePromptSourceStore.getState().sources.some(s => s.id === sourceId), interval: usePromptSourceStore.getState().schedule.intervalMinutes, theme: document.documentElement.classList.contains('dark') };
    }, report.sourceId);
    check(state.sourceRetained && state.interval === 0 && state.theme, '刷新丢失配置');
    await page.goto(origin + '/synthetic-not-found', { waitUntil: 'domcontentloaded' }); await header().waitFor();
    await page.getByText('404', { exact: true }).waitFor();
    check((await page.locator('main').boundingBox()).y === 84, '404页面未预留顶栏');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '画布设置', exact: true }).click(); await settings().waitFor(); await closeSettings();
    check(report.pageErrors.length === 0 && report.unexpectedRequests.length === 0, '出现页面错误或非预期联网');
    return { ...state, notFoundHeader: true, narrowSettings: true };
  });
  report.passed = true;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(origin, { waitUntil: 'domcontentloaded' }); await header().waitFor();
  await page.evaluate(value => { window.__guanGlobalAcceptance = value; }, report);
  console.log(JSON.stringify(report));
}
