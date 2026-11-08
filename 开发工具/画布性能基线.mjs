async (page) => {
  if (page.url() !== 'about:blank' && new URL(page.url()).origin !== 'http://localhost:3100') throw Error('只允许隔离测试 Origin。');
  await page.context().route('**/*', route => new URL(route.request().url()).origin === 'http://localhost:3100' ? route.continue() : route.abort());
  const waitData = async (predicate, arg) => {
    const start = Date.now();
    while (!(await page.evaluate(predicate, arg))) {
      if (Date.now() - start > 30000) throw Error('异步存储检查未在测试等待窗口内满足。');
      await page.waitForTimeout(100);
    }
  };
  await page.context().addInitScript(() => {
    let sample = null;
    const metrics = { commits: 0, performedWork: {}, frames: [], longTasks: [], writes: {} };
    const reset = () => { metrics.commits = 0; metrics.performedWork = {}; metrics.frames = []; metrics.longTasks = []; metrics.writes = {}; };
    let previous;
    const frame = time => { if (sample && previous !== undefined) metrics.frames.push(time - previous); previous = time; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    new PerformanceObserver(list => {
      if (sample) for (const entry of list.getEntries()) metrics.longTasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: false });
    const renderers = new Map();
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, renderers,
      inject: renderer => { const id = renderers.size + 1; renderers.set(id, renderer); return id; },
      onCommitFiberUnmount() {},
      onCommitFiberRoot(id, root) {
        if (!sample) return;
        metrics.commits++;
        const visit = fiber => {
          if (!fiber) return;
          const type = fiber.type;
          const name = type?.displayName || type?.name || type?.render?.name;
          if ((fiber.flags & 1) && name) metrics.performedWork[name] = (metrics.performedWork[name] || 0) + 1;
          visit(fiber.child); visit(fiber.sibling);
        };
        visit(root.current);
      },
    };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (sample) metrics.writes[this.name] = (metrics.writes[this.name] || 0) + 1;
      return put.apply(this, args);
    };
    window.__guanPerformance = {
      start() { reset(); previous = undefined; sample = performance.now(); },
      checkpoint() { return { duration: performance.now() - sample, ...structuredClone(metrics) }; },
      end() { const duration = performance.now() - sample; sample = null; return { duration, ...structuredClone(metrics) }; },
    };
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const percentile = (values, q) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(2)) : null; };
  const report = { mode: 'Vite development / React development', fixture: '文本节点，不含大图片', viewport: [1440, 900], repeats: 3, samples: [], datasets: [], errors: [] };
  page.on('pageerror', error => report.errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:3100/canvas');
  await page.getByRole('button', { name: '新建画布', exact: true }).first().waitFor();
  await waitData(async () => {
    const { useCanvasStore } = await import('/src/stores/canvas/use-canvas-store.ts');
    return useCanvasStore.getState().hydrated;
  });
  for (const [name, count, edges] of [['small', 20, 30], ['medium', 120, 240], ['dense', 360, 1080]]) {
    const id = await page.evaluate(async ({ name, count, edges }) => {
      const { useCanvasStore } = await import('/src/stores/canvas/use-canvas-store.ts');
      const { useConfigStore } = await import('/src/stores/use-config-store.ts');
      useConfigStore.getState().updateConfig('autoFocusOnSelect', false);
      const store = useCanvasStore.getState();
      const id = store.createProject('阶段4-性能-' + name);
      const nodes = Array.from({ length: count }, (_, i) => ({ id: 'perf-node-' + i, type: 'text', title: '节点' + i, position: { x: 50 + i % 12 * 210, y: 90 + Math.floor(i / 12) * 160 }, width: 180, height: 110, metadata: { content: '固定文本 ' + i, status: 'success' } }));
      const connections = [];
      const used = new Set();
      const add = (from, to) => { const key = from + ':' + to; if (from === to || used.has(key)) return; used.add(key); connections.push({ id: 'perf-line-' + connections.length, fromNodeId: nodes[from].id, toNodeId: nodes[to].id }); };
      for (let i = 1; i < Math.min(count, 81) && connections.length < edges; i++) add(0, i);
      for (let stride = 1; connections.length < edges && stride < count; stride++) for (let i = 0; i < count && connections.length < edges; i++) add(i, (i + stride) % count);
      store.updateProject(id, { nodes, connections, viewport: { x: 0, y: 0, k: 1 } });
      return id;
    }, { name, count, edges });
    await waitData(async id => {
      const { localForageStorage } = await import('/src/lib/localforage-storage.ts');
      const raw = await localForageStorage.getItem('infinite-canvas:canvas_store');
      return raw && JSON.parse(raw).state.projects.some(p => p.id === id && p.nodes.length);
    }, id);
    await page.waitForTimeout(500);
    const loadedAt = Date.now();
    await page.goto('http://localhost:3100/canvas/' + id);
    // 原版已有视口裁剪：固定数据总量并不等于挂载 DOM 数，不能关闭裁剪来造基线。
    await page.locator('[data-node-id="perf-node-0"]').waitFor();
    const loadMs = Date.now() - loadedAt;
    await page.waitForTimeout(700);
    const baseline = await metric();
    report.datasets.push({ name, id, nodes: count, edges, loadMs, heapBytes: baseline.JSHeapUsedSize, domNodes: baseline.Nodes,
      mountedNodes: await page.locator('[data-node-id]').count(), mountedEdges: await page.locator('[data-connection-id]').count() });
    for (let repeat = 0; repeat < report.repeats; repeat++) {
      for (const action of ['pan', 'selected-pan', 'zoom', 'dense-node-drag']) {
        // 使用原版公开配置与按钮复位，不替换渲染器或改变原作者交互实现。
        await page.getByRole('button', { name: '重置视图', exact: true }).click();
        // y=65 在所有固定节点上方、顶栏下方；不能点击节点后让其面板截获滚轮。
        await page.mouse.click(1000, 65);
        if (action === 'selected-pan') await page.locator('[data-node-id="perf-node-0"]').click({ position: { x: 80, y: 55 } });
        // viewport 的 500ms 防抖后还有 store 的 400ms，等待覆盖两个串联阶段。
        await page.waitForTimeout(1100);
        const viewportElement = page.locator('.absolute.origin-top-left');
        const initialTransform = await viewportElement.evaluate(el => el.style.transform);
        const initialNode = await page.locator('[data-node-id="perf-node-0"]').boundingBox();
        let observed;
        const first = await metric();
        await page.evaluate(() => window.__guanPerformance.start());
        if (action === 'zoom') {
          await page.mouse.move(1000, 65);
          for (let i = 0; i < 48; i++) {
            await page.mouse.wheel(0, i < 24 ? -8 : 8); await page.waitForTimeout(12);
            if (i === 23) observed = await viewportElement.evaluate(el => el.style.transform);
          }
        } else {
          let x = 1000, y = 65;
          const button = action === 'dense-node-drag' ? 'left' : 'middle';
          if (action === 'dense-node-drag') { const rect = await page.locator('[data-node-id="perf-node-0"]').boundingBox(); x = rect.x + 80; y = rect.y + 55; }
          await page.mouse.move(x, y); await page.mouse.down({ button });
          for (let i = 1; i <= 48; i++) {
            await page.mouse.move(x + 100 * Math.sin(i / 48 * Math.PI), y + 40 * Math.sin(i / 48 * Math.PI)); await page.waitForTimeout(12);
            if (i === 24) observed = action === 'dense-node-drag'
              ? await page.locator('[data-node-id="perf-node-0"]').boundingBox()
              : await viewportElement.evaluate(el => el.style.transform);
          }
          await page.mouse.up({ button });
        }
        const gesture = await page.evaluate(() => window.__guanPerformance.checkpoint());
        // 1100ms 排空作者的 500ms + 400ms 保存防抖，仅是测试等待，不改产品值。
        await page.waitForTimeout(1100);
        const raw = await page.evaluate(() => window.__guanPerformance.end());
        const last = await metric();
        const gestureVerified = action === 'dense-node-drag'
          ? Math.abs(observed.x - initialNode.x) > 50
          : observed !== initialTransform;
        report.samples.push({ name, nodes: count, edges, action, repeat: repeat + 1,
          gestureVerified, initialTransform, midpoint: observed,
          durationMs: Math.round(raw.duration), frames: raw.frames.length,
          gestureDurationMs: Math.round(gesture.duration), gestureFrames: gesture.frames.length,
          gestureFrameP95: percentile(gesture.frames, 0.95),
          frameP50: percentile(raw.frames, 0.5), frameP95: percentile(raw.frames, 0.95), frameMax: percentile(raw.frames, 1),
          longTasks: raw.longTasks.length, longTaskMs: raw.longTasks.reduce((a, b) => a + b, 0),
          reactCommits: raw.commits, performedWork: raw.performedWork, indexedDBPuts: raw.writes,
          heapBytes: last.JSHeapUsedSize, heapDelta: last.JSHeapUsedSize - first.JSHeapUsedSize,
          layouts: last.LayoutCount - first.LayoutCount, styleRecalculations: last.RecalcStyleCount - first.RecalcStyleCount,
          scriptMs: Math.round((last.ScriptDuration - first.ScriptDuration) * 1000), taskMs: Math.round((last.TaskDuration - first.TaskDuration) * 1000),
        });
        await page.evaluate(value => { window.__guanPerformanceBaseline = value; }, report);
        if (!gestureVerified) throw Error('测试手势没有实际作用于画布：' + name + '/' + action);
      }
    }
  }
  report.browser = await page.evaluate(() => ({ userAgent: navigator.userAgent, devicePixelRatio, origin: location.origin }));
  await cdp.detach();
  await page.screenshot({ path: 'output/playwright/阶段4-性能画布.png' });
  await page.evaluate(value => { window.__guanPerformanceBaseline = value; }, report);
  console.log(JSON.stringify({ datasets: report.datasets, samples: report.samples.length }));
  return { datasets: report.datasets, samples: report.samples.length };
}
