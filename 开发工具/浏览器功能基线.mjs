async (page) => {
  if (page.url() !== 'about:blank' && new URL(page.url()).origin !== 'http://localhost:3100') throw Error('只允许隔离测试 Origin。');
  const report = { origin: 'http://localhost:3100', results: [], errors: [], blockedOrigins: [] };
  page.on('pageerror', error => report.errors.push(error.message));
  await page.context().route('**/*', route => {
    const origin = new URL(route.request().url()).origin;
    if (origin === report.origin) return route.continue();
    if (!report.blockedOrigins.includes(origin)) report.blockedOrigins.push(origin);
    return route.abort();
  });
  const check = (ok, reason) => { if (!ok) throw Error(reason); };
  // 当前 CLI 的 waitForFunction 不等待异步 predicate；显式 await evaluate 结果。
  const waitData = async (predicate, arg) => {
    const start = Date.now();
    while (!(await page.evaluate(predicate, arg))) {
      if (Date.now() - start > 30000) throw Error('异步存储检查未在测试等待窗口内满足。');
      await page.waitForTimeout(100);
    }
  };
  const test = async (name, run) => {
    const start = Date.now();
    try {
      const evidence = await run();
      report.results.push({ name, passed: true, ms: Date.now() - start, evidence });
    } catch (error) {
      report.results.push({ name, passed: false, ms: Date.now() - start, error: error.message });
      await page.evaluate(value => { window.__guanFunctionalBaseline = value; }, report);
      console.log(JSON.stringify(report));
      throw error;
    }
    await page.evaluate(value => { window.__guanFunctionalBaseline = value; }, report);
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:3100/canvas');
  await page.getByRole('button', { name: '新建画布', exact: true }).first().waitFor();
  await waitData(async () => {
    const { useCanvasStore } = await import('/src/stores/canvas/use-canvas-store.ts');
    return useCanvasStore.getState().hydrated;
  });
  const fixture = await page.evaluate(async () => {
    const { useCanvasStore } = await import('/src/stores/canvas/use-canvas-store.ts');
    const { useConfigStore } = await import('/src/stores/use-config-store.ts');
    const { uploadImage } = await import('/src/services/image-storage.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 200;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#7c3aed'; ctx.fillRect(0, 0, 320, 200);
    ctx.fillStyle = '#fff'; ctx.font = '32px sans-serif'; ctx.fillText('BASELINE', 40, 112);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const image = await uploadImage(blob);
    const store = useCanvasStore.getState();
    const id = store.createProject('阶段4-功能基线');
    const text = (id, x, title) => ({ id, type: 'text', title, position: { x, y: 130 }, width: 280, height: 160, metadata: { content: title, status: 'success' } });
    store.updateProject(id, {
      nodes: [text('base-text-a', 50, '基线文本A'), text('base-text-b', 440, '基线文本B'), {
        id: 'base-image', type: 'image', title: '基线图片', position: { x: 810, y: 130 }, width: 320, height: 200,
        metadata: { content: image.url, storageKey: image.storageKey, naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType, status: 'success' },
      }],
      connections: [{ id: 'base-line', fromNodeId: 'base-text-a', toNodeId: 'base-text-b' }],
      viewport: { x: 0, y: 0, k: 1 },
    });
    useConfigStore.getState().updateConfig('autoFocusOnSelect', false);
    const imageSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
    return { id, imageBytes: blob.size, imageKey: image.storageKey, imageSha256 };
  });
  report.fixture = fixture;
  await page.evaluate(value => { window.__guanFunctionalBaseline = value; }, report);
  await waitData(async id => {
    const { localForageStorage } = await import('/src/lib/localforage-storage.ts');
    const raw = await localForageStorage.getItem('infinite-canvas:canvas_store');
    return raw && JSON.parse(raw).state.projects.find(p => p.id === id)?.nodes.length === 3;
  }, fixture.id);
  // 原版 store 异步恢复完成后再造数据，且等写入完成才跨文档导航。
  await page.waitForTimeout(500);
  await page.goto('http://localhost:3100/canvas/' + fixture.id);
  const node = id => page.locator('[data-node-id="' + id + '"]');
  const project = () => page.evaluate(async id => {
    const { useCanvasStore } = await import('/src/stores/canvas/use-canvas-store.ts');
    return useCanvasStore.getState().openProject(id);
  }, fixture.id);
  await node('base-image').waitFor();
  await test('固定画布加载', async () => {
    check(await page.locator('[data-node-id]').count() === 3, '节点数量不符');
    check(await page.locator('[data-connection-id]').count() === 1, '连线数量不符');
    return { nodes: 3, connections: 1, localImage: true, autoFocusOnSelect: false };
  });
  await test('设置反复打开关闭', async () => {
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: '配置', exact: true }).click();
      const dialog = page.getByRole('dialog').last();
      await dialog.waitFor();
      if (i % 2) await dialog.getByRole('button', { name: '关闭', exact: true }).click();
      else await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    }
    return { cycles: 3, closeButtonAndEscape: true };
  });
  await test('批准适配的全屏脚本编辑器', async () => {
    await page.getByRole('button', { name: '配置', exact: true }).click();
    await page.getByRole('button', { name: '编辑', exact: true }).first().click();
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: '调用脚本', exact: true }).first().click();
      // 原版 Modal title=null，正文标题不会成为 dialog 的无障碍名称。
      const editor = page.getByRole('dialog').filter({ has: page.getByText('生图调用脚本 · gpt-image-2', { exact: true }) });
      await editor.waitFor();
      // 避免把 AntD 入场缩放的中间帧误当作最终尺寸。
      await page.waitForTimeout(350);
      const rect = await editor.boundingBox();
      check(rect.height >= 850 && rect.width >= 1400, '编辑器没有铺满测试视口');
      await page.keyboard.press('Escape');
      await editor.waitFor({ state: 'hidden' });
    }
    const drawer = page.getByRole('dialog', { name: '编辑渠道', exact: true });
    await drawer.getByRole('button', { name: '关闭', exact: true }).click();
    await drawer.waitFor({ state: 'hidden' });
    const settings = page.getByRole('dialog', { name: /配置与用户偏好/ });
    await settings.getByRole('button', { name: '关闭', exact: true }).click();
    await settings.waitFor({ state: 'hidden' });
    return { cycles: 2, fullViewport: true, scriptNotExecuted: true };
  });
  await test('版本与快捷键弹窗', async () => {
    for (const name of ['v0.20.0', '快捷键']) {
      for (let i = 0; i < 3; i++) {
        await page.getByRole('button', { name, exact: true }).first().click();
        const dialog = page.getByRole('dialog').last();
        await dialog.waitFor();
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
      }
    }
    return { eachCycles: 3 };
  });
  await test('文本编辑保存与刷新', async () => {
    await node('base-text-a').dblclick({ position: { x: 120, y: 80 } });
    await node('base-text-a').locator('textarea').fill('阶段4：编辑后保存恢复');
    await page.mouse.click(1000, 600);
    await waitData(async id => {
      const { localForageStorage } = await import('/src/lib/localforage-storage.ts');
      const raw = await localForageStorage.getItem('infinite-canvas:canvas_store');
      return raw && JSON.parse(raw).state.projects.find(p => p.id === id)?.nodes[0].metadata.content === '阶段4：编辑后保存恢复';
    }, fixture.id);
    await page.reload();
    await node('base-text-a').getByText('阶段4：编辑后保存恢复', { exact: true }).waitFor();
    return { persistedVia: 'IndexedDB/localForage', reloadRetained: true };
  });
  await test('节点拖动、撤销与重做', async () => {
    const before = (await project()).nodes[0].position;
    const rect = await node('base-text-a').boundingBox();
    await page.mouse.move(rect.x + 100, rect.y + 80);
    await page.mouse.down();
    await page.mouse.move(rect.x + 170, rect.y + 110, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(800);
    const after = (await project()).nodes[0].position;
    check(after.x !== before.x && after.y !== before.y, '节点没有移动');
    await page.getByRole('button', { name: '撤销', exact: true }).click();
    await page.waitForTimeout(800);
    check(JSON.stringify((await project()).nodes[0].position) === JSON.stringify(before), '撤销位置不符');
    await page.getByRole('button', { name: '重做', exact: true }).click();
    await page.waitForTimeout(800);
    check(JSON.stringify((await project()).nodes[0].position) === JSON.stringify(after), '重做位置不符');
    return { before, after };
  });
  await test('连线创建与目标位置保持', async () => {
    const before = (await project()).nodes.find(n => n.id === 'base-image').position;
    await node('base-text-a').hover();
    const source = await node('base-text-a').locator('[class*="-right-6"][class*="cursor-crosshair"]').boundingBox();
    const target = await node('base-image').boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + 8, target.y + target.height / 2, { steps: 20 });
    await page.mouse.up();
    await page.waitForFunction(() => document.querySelectorAll('[data-connection-id]').length === 2);
    await page.waitForTimeout(800);
    check(JSON.stringify((await project()).nodes.find(n => n.id === 'base-image').position) === JSON.stringify(before), '目标卡片在连接时跳动');
    return { connections: 2, targetUnchanged: true };
  });
  await test('画布平移、缩放、选择后平移', async () => {
    const before = (await project()).viewport;
    await page.mouse.move(1000, 600); await page.mouse.down({ button: 'middle' });
    await page.mouse.move(1060, 640, { steps: 15 }); await page.mouse.up({ button: 'middle' });
    await page.waitForTimeout(900);
    const pan = (await project()).viewport;
    check(pan.x !== before.x && pan.y !== before.y, '平移未改变视口');
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(900);
    check((await project()).viewport.k !== pan.k, '滚轮未改变比例');
    await node('base-text-a').click({ position: { x: 90, y: 60 } });
    const positions = (await project()).nodes.map(n => n.position);
    await page.mouse.move(1000, 600); await page.mouse.down({ button: 'middle' });
    await page.mouse.move(1030, 600, { steps: 10 }); await page.mouse.up({ button: 'middle' });
    await page.waitForTimeout(900);
    check(JSON.stringify((await project()).nodes.map(n => n.position)) === JSON.stringify(positions), '平移误移动选中节点');
    return { pan, zoom: (await project()).viewport.k, selectedNodePositionsUnchanged: true };
  });
  await test('图片详情反复打开关闭', async () => {
    for (let i = 0; i < 3; i++) {
      await node('base-image').dblclick({ position: { x: 120, y: 100 } });
      const dialog = page.getByRole('dialog', { name: '图片详情', exact: true });
      await dialog.waitFor();
      const pixels = await dialog.locator('img').evaluate(img => ({ width: img.naturalWidth, height: img.naturalHeight }));
      check(pixels.width === 320 && pixels.height === 200, '详情图片像素不符');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    }
    return { cycles: 3, pixels: '320x200' };
  });
  await test('主题、侧栏和小地图', async () => {
    await page.getByRole('button', { name: '切换到浅色主题', exact: true }).click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark'));
    await page.getByRole('button', { name: '切换到深色主题', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
    await page.getByRole('button', { name: '收起面板', exact: true }).click();
    await page.getByRole('button', { name: '展开面板', exact: true }).click();
    await page.getByRole('button', { name: '打开小地图', exact: true }).click();
    await page.getByRole('button', { name: '关闭小地图', exact: true }).click();
    return { lightAndDark: true, sidePanelAndMinimap: true };
  });
  await test('ZIP导出与导入', async () => {
    const before = await project();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: '打开画布菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: /导出当前画布/ }).click();
    const download = await downloading;
    const file = 'output/playwright/阶段4-功能画布.zip';
    await download.saveAs(file);
    await page.goto('http://localhost:3100/canvas');
    // CLI 遇原生文件选择窗会暂停脚本；通过真实 input 触发原版 onChange。
    await page.locator('input[type="file"][accept*=".zip"]').setInputFiles(file);
    // 原版导入留在画布库，不自动打开；等待真实 store 导入，再经卡片进入。
    await waitData(async originalId => {
      const { useCanvasStore } = await import('/src/stores/canvas/use-canvas-store.ts');
      return useCanvasStore.getState().projects.some(p => p.id !== originalId && p.title === '阶段4-功能基线' && p.nodes[0]?.metadata.content === '阶段4：编辑后保存恢复');
    }, fixture.id);
    await page.getByRole('button', { name: /阶段4-功能基线.*3 个节点/ }).first().click();
    await page.waitForURL(/\/canvas\/[^/]+$/);
    await page.locator('[data-node-id]').first().waitFor();
    const imported = await page.evaluate(async () => {
      const { useCanvasStore } = await import('/src/stores/canvas/use-canvas-store.ts');
      const { getImageBlob } = await import('/src/services/image-storage.ts');
      const p = useCanvasStore.getState().openProject(location.pathname.split('/').pop());
      const image = p.nodes.find(n => n.type === 'image');
      const blob = await getImageBlob(image.metadata.storageKey);
      const imageSha256 = blob ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('') : null;
      return { id: p.id, nodes: p.nodes.length, connections: p.connections.length, text: p.nodes[0].metadata.content, imageBytes: blob?.size, imageSha256 };
    });
    check(imported.id !== before.id && imported.nodes === before.nodes.length && imported.connections === before.connections.length, '导入结构不符');
    check(imported.text === before.nodes[0].metadata.content && imported.imageBytes === fixture.imageBytes && imported.imageSha256 === fixture.imageSha256, '文本或媒体不完整');
    return { imported, downloadName: download.suggestedFilename() };
  });
  await page.screenshot({ path: 'output/playwright/阶段4-功能基线.png' });
  report.browser = await page.evaluate(() => ({ userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight], devicePixelRatio, origin: location.origin }));
  await page.evaluate(value => { window.__guanFunctionalBaseline = value; }, report);
  console.log(JSON.stringify(report));
  return report;
}
