async (page) => {
  const origin = 'http://localhost:3100';
  const report = { origin, results: [], errors: [], externalRequests: [], mockVideoRequests: [] };
  if (page.url() !== 'about:blank') throw Error('只能使用全新隔离测试浏览器');
  const check = (value, message) => { if (!value) throw Error(message); };
  page.on('pageerror', error => report.errors.push(error.message));
  let videoBody;
  await page.context().route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    // 唯一模拟的联网场景：恢复已存在的视频任务，不创建新任务，不接触真实服务。
    if (url.origin === 'https://video.example.invalid' && request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET,OPTIONS' } });
    if (url.origin === 'https://video.example.invalid' && request.method() === 'GET' && ['/v1/videos/synthetic-existing', '/v1/videos/synthetic-existing/content'].includes(url.pathname)) {
      report.mockVideoRequests.push(url.pathname);
      const content = url.pathname.endsWith('/content');
      return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': origin }, contentType: content ? 'video/webm' : 'application/json', body: content ? videoBody : JSON.stringify({ id: 'synthetic-existing', status: 'completed' }) });
    }
    report.externalRequests.push({ method: request.method(), url: url.origin + url.pathname });
    return route.abort();
  });
  await page.addInitScript(() => {
    window.__sourceIntervals = [];
    const original = window.setInterval;
    window.setInterval = function (...args) {
      if ((new Error().stack || '').includes('use-prompt-source-scheduler')) window.__sourceIntervals.push(args[1]);
      return original.apply(this, args);
    };
  });
  const save = () => page.evaluate(value => { window.__guanOfflineAcceptance = value; }, report);
  const test = async (name, run) => {
    try { report.results.push({ name, passed: true, evidence: await run() }); }
    catch (error) { report.results.push({ name, passed: false, error: error.message }); throw error; }
    finally { await save(); }
  };
  const header = () => page.getByRole('banner', { name: '工作台顶栏', exact: true });
  const settings = () => page.getByRole('dialog', { name: /配置与用户偏好/ });
  const openSettings = async () => { await page.getByRole('button', { name: '画布设置', exact: true }).click(); await settings().waitFor(); };
  const closeSettings = async () => { await settings().getByRole('button', { name: '关闭', exact: true }).click(); await settings().waitFor({ state: 'hidden' }); };
  const waitTheme = async theme => page.waitForFunction(theme => document.querySelector('[aria-label="工作台顶栏"]').getAttribute('data-theme') === theme && !document.documentElement.dataset.magicuiThemeVt, theme);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(origin, { waitUntil: 'domcontentloaded' }); await header().waitFor();

  await test('新资料默认跟随系统；偏好UI三态切换、刷新持久化及顶栏手动切换', async () => {
    await waitTheme('dark');
    await page.emulateMedia({ colorScheme: 'light' }); await waitTheme('light');
    await openSettings(); await settings().getByRole('tab', { name: '偏好设置', exact: true }).click();
    const select = settings().getByRole('combobox', { name: '界面主题', exact: true });
    const choose = async label => { await select.click(); await page.locator('.ant-select-dropdown:visible').getByText(label, { exact: true }).click(); };
    await choose('深色'); await waitTheme('dark');
    await page.emulateMedia({ colorScheme: 'light' }); await waitTheme('dark');
    await choose('浅色'); await waitTheme('light');
    await page.emulateMedia({ colorScheme: 'dark' }); await waitTheme('light');
    await choose('跟随系统'); await waitTheme('dark');
    await page.screenshot({ path: '__ARTIFACT_DIR__/三态主题设置.png' });
    await closeSettings();
    await page.reload({ waitUntil: 'domcontentloaded' }); await header().waitFor(); await waitTheme('dark');
    await page.emulateMedia({ colorScheme: 'light' }); await waitTheme('light');
    await page.getByRole('button', { name: '切换深色主题', exact: true }).click(); await waitTheme('dark');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('infinite-canvas:theme_store')).state);
    check(saved.mode === 'dark' && !Object.hasOwn(saved, 'theme'), '主题偏好保存不符');
    await page.emulateMedia({ colorScheme: 'light' }); await waitTheme('dark');
    return { systemResponds: true, explicitChoicesRetained: true, reloadRetained: true, topToggleMode: saved.mode };
  });

  await test('旧浅/深偏好兼容；S06网址不导入，store直调也拒绝且不改渠道', async () => {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => localStorage.setItem('infinite-canvas:theme_store', JSON.stringify({ state: { theme }, version: 0 })), theme);
      await page.reload({ waitUntil: 'domcontentloaded' }); await header().waitFor(); await waitTheme(theme);
    }
    const before = await page.evaluate(async () => JSON.stringify((await window.__guanImport('/src/stores/use-config-store.ts')).useConfigStore.getState().config.channels));
    await page.goto(origin + '/?baseUrl=https%3A%2F%2Fsynthetic.example.invalid&apiKey=synthetic-not-real', { waitUntil: 'domcontentloaded' }); await header().waitFor();
    const result = await page.evaluate(async before => {
      const store = (await window.__guanImport('/src/stores/use-config-store.ts')).useConfigStore;
      let rejected = false;
      try { store.getState().importChannelCredentials({ baseUrl: 'https://synthetic.example.invalid', apiKey: 'synthetic-not-real' }); } catch (error) { rejected = error.code === 'product_feature_disabled'; }
      return { unchanged: JSON.stringify(store.getState().config.channels) === before, rejected };
    }, before);
    check(result.unchanged && result.rejected && await settings().count() === 0, '网址凭据门禁未生效');
    return { oldLightDarkCompatible: true, ...result };
  });

  const fixture = await page.evaluate(async () => {
    const { useCanvasStore } = await window.__guanImport('/src/stores/canvas/use-canvas-store.ts');
    const config = await window.__guanImport('/src/stores/use-config-store.ts');
    const { usePromptSourceStore } = await window.__guanImport('/src/stores/use-prompt-source-store.ts');
    const { uploadImage } = await window.__guanImport('/src/services/image-storage.ts');
    const { uploadMediaFile } = await window.__guanImport('/src/services/file-storage.ts');
    const localforage = (await window.__guanImport('/node_modules/.vite/deps/localforage.js')).default;
    const source = { id: 'synthetic-offline-source', name: '合成离线来源', url: 'https://source.example.invalid/prompts.json', homepage: 'https://source.example.invalid', enabled: true, builtIn: false };
    const cache = { sourceId: source.id, items: [{ id: 'offline-prompt', title: '缓存尺寸展示', prompt: '长度 宽度 高度，保持产品比例', tags: ['尺寸'], coverUrl: 'https://image.example.invalid/cover.png', referenceImageUrls: ['https://image.example.invalid/reference.png'], sourceUrl: 'https://source.example.invalid/item' }], count: 1, fetchedAt: 0, signature: 'stale', lastSuccessAt: '2020-01-01T00:00:00Z', lastError: '' };
    usePromptSourceStore.setState(state => ({ sources: [...state.sources.map(item => ({ ...item, enabled: false })), source], schedule: { intervalMinutes: 30, lastFetchedAt: '2020-01-01T00:00:00Z' } }));
    await localforage.createInstance({ name: 'infinite-canvas', storeName: 'prompt_cache' }).setItem('prompt-source:' + source.id, cache);
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#7c3aed'; ctx.fillRect(0, 0, 320, 200);
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const image = await uploadImage(png);
    const stream = canvas.captureStream(8), chunks = [], recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const recording = new Promise(resolve => { recorder.ondataavailable = event => chunks.push(event.data); recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' })); });
    recorder.start();
    // captureStream仅在画面变化时产生帧，不能把没有编码帧的空录制当成业务播放失败。
    for (let frame = 0; frame < 6; frame++) { ctx.fillStyle = frame % 2 ? '#7c3aed' : '#4c1d95'; ctx.fillRect(0, 0, 320, 200); await new Promise(resolve => setTimeout(resolve, 80)); }
    recorder.stop();
    const videoBlob = await recording; stream.getTracks().forEach(track => track.stop());
    const video = await uploadMediaFile(videoBlob, 'video');
    const wav = new ArrayBuffer(44 + 16000), view = new DataView(wav);
    const str = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    str(0, 'RIFF'); view.setUint32(4, 16036, true); str(8, 'WAVE'); str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, 16000, true);
    const audio = await uploadMediaFile(new Blob([wav], { type: 'audio/wav' }), 'audio');
    const channel = config.createModelChannel({ id: 'synthetic-video-channel', name: '合成视频恢复', baseUrl: 'https://video.example.invalid/v1', apiKey: 'synthetic-not-real', models: [{ name: 'synthetic-video', capability: 'video' }] });
    const model = config.encodeChannelModel(channel.id, 'synthetic-video');
    config.useConfigStore.setState(state => ({ config: { ...state.config, channels: [channel], models: config.modelOptionsFromChannels([channel]), videoModel: model, autoFocusOnSelect: false } }));
    const id = useCanvasStore.getState().createProject('精简离线三态合成验收');
    const node = (id, type, title, x, y, width, height, metadata) => ({ id, type, title, position: { x, y }, width, height, metadata });
    const oldParams = { generationMode: 'video', prompt: '原有参数保留', seconds: '8', vquality: '1080p', model, status: 'idle' };
    useCanvasStore.getState().updateProject(id, { nodes: [
      node('offline-text', 'text', '保存验收', 70, 140, 280, 170, { content: '原文保留', status: 'success' }),
      node('offline-image', 'image', '图片预览验收', 430, 140, 320, 200, { ...image, content: image.url, naturalWidth: 320, naturalHeight: 200, status: 'success' }),
      node('offline-config', 'config', '原视频参数', 840, 140, 420, 320, oldParams),
      node('offline-video', 'video', '本地视频', 70, 490, 320, 200, { ...video, content: video.url, status: 'success' }),
      node('offline-audio', 'audio', '本地音频', 460, 490, 300, 150, { ...audio, content: audio.url, status: 'success' }),
      node('offline-resume', 'video', '旧任务恢复', 850, 510, 320, 200, { generationMode: 'video', model, videoTaskId: 'synthetic-existing', videoTaskProvider: 'openai', status: 'loading' }),
    ], connections: [{ id: 'offline-line', fromNodeId: 'offline-text', toNodeId: 'offline-image' }], viewport: { x: 0, y: 0, k: 1 } });
    return { id, source, cache, oldParams, video, audio, videoBase64: btoa(String.fromCharCode(...new Uint8Array(await videoBlob.arrayBuffer()))) };
  });
  videoBody = Buffer.from(fixture.videoBase64, 'base64');
  await page.waitForTimeout(1200);
  await page.goto(origin + '/canvas/' + fixture.id, { waitUntil: 'domcontentloaded' });
  const node = id => page.locator(`[data-node-id="${id}"]`);
  await node('offline-image').waitFor();

  await test('离线来源有名称/条数/内容；重读本地、复制/保存素材，无远程封面请求', async () => {
    await openSettings(); await settings().getByRole('tab', { name: '提示词来源', exact: true }).click();
    await settings().getByText('提示词来源已切换为离线查看', { exact: true }).waitFor();
    check(await settings().getByRole('button', { name: /新增来源|立即拉取|全部拉取/ }).count() === 0, '联网来源操作仍显示');
    const row = settings().locator('.rounded-lg.border').filter({ has: page.getByText('合成离线来源', { exact: true }) });
    await row.getByText('本地缓存 1 条 · 侧栏显示', { exact: true }).waitFor();
    await row.getByRole('button', { name: '查看本地内容', exact: true }).click();
    const modal = page.getByRole('dialog', { name: /合成离线来源 · 提示词内容/ }); await modal.waitFor();
    await modal.getByText('缓存尺寸展示', { exact: true }).waitFor();
    await modal.getByRole('button', { name: '重新读取本地缓存', exact: true }).click();
    await modal.getByText('缓存尺寸展示', { exact: true }).waitFor();
    await modal.getByRole('button', { name: '复制', exact: true }).click();
    await modal.getByRole('button', { name: '加入我的资产', exact: true }).click();
    const saved = await page.evaluate(async () => (await window.__guanImport('/src/stores/use-asset-store.ts')).useAssetStore.getState().assets.some(item => item.title === '缓存尺寸展示'));
    check(saved, '离线提示词未保存到素材');
    await page.screenshot({ path: '__ARTIFACT_DIR__/离线提示词内容.png' });
    await page.keyboard.press('Escape'); await modal.waitFor({ state: 'hidden' }); await closeSettings();
    return { cachedCount: 1, localReread: true, copyClick: true, assetSaved: true };
  });

  await test('过期/缺失缓存和手动/定时/低层刷新均不联网；原配置和缓存逐字保留', async () => {
    const result = await page.evaluate(async fixture => {
      const api = await window.__guanImport('/src/services/api/prompts.ts');
      const runtime = await window.__guanImport('/src/services/api/prompt-source-runtime.ts');
      const sources = (await window.__guanImport('/src/stores/use-prompt-source-store.ts')).usePromptSourceStore.getState();
      const localforage = (await window.__guanImport('/node_modules/.vite/deps/localforage.js')).default;
      const cache = await localforage.createInstance({ name: 'infinite-canvas', storeName: 'prompt_cache' }).getItem('prompt-source:' + fixture.source.id);
      const rows = await api.fetchPrompts({ keyword: '长度' });
      const empty = await api.fetchSourcePrompts(sources.sources.find(item => item.builtIn).id);
      const denied = [];
      for (const call of [() => api.refreshSource(fixture.source.id), () => api.refreshAllSources(), () => api.refreshDueSources(1), () => runtime.runPromptSource(fixture.source)]) { try { await call(); denied.push(false); } catch (error) { denied.push(error.code === 'product_feature_disabled'); } }
      return { cacheUnchanged: JSON.stringify(cache) === JSON.stringify(fixture.cache), interval: sources.schedule.intervalMinutes, sourceUnchanged: JSON.stringify(sources.sources.find(item => item.id === fixture.source.id)) === JSON.stringify(fixture.source), matches: rows.total, missingCount: empty.length, remoteImagesStripped: rows.items.every(item => !item.coverUrl && !item.githubUrl && !item.sourceUrl && item.referenceImageUrls.length === 0), denied, timers: window.__sourceIntervals.length };
    }, fixture);
    check(result.cacheUnchanged && result.sourceUnchanged && result.interval === 30 && result.matches === 1 && result.missingCount === 0 && result.remoteImagesStripped && result.denied.every(Boolean) && result.timers === 0, '离线边界或数据保留不符');
    check(report.externalRequests.length === 0, '离线场景尝试请求外网');
    return result;
  });

  await test('视频/语音新生成和参数关闭，旧参数不改写；API直调在网络前拒绝', async () => {
    const configNode = node('offline-config');
    await configNode.getByText('此卡片的视频/语音生成已关闭，原参数保留；可切换图片或文本。', { exact: true }).waitFor();
    check(await configNode.getByRole('button', { name: '开始生成', exact: true }).isDisabled(), '旧视频模式仍可开始生成');
    const modes = await configNode.locator('.ant-segmented-item-label').allTextContents();
    check(modes.length === 2 && !modes.some(text => /视频|语音|音频/.test(text)), '关闭模式仍显示');
    const result = await page.evaluate(async fixture => {
      const audio = await window.__guanImport('/src/services/api/audio.ts'), video = await window.__guanImport('/src/services/api/video.ts');
      const { useConfigStore } = await window.__guanImport('/src/stores/use-config-store.ts');
      const p = (await window.__guanImport('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore.getState().openProject(fixture.id);
      const denied = [];
      for (const call of [() => audio.requestAudioGeneration(useConfigStore.getState().config, 'fixture'), () => video.createVideoGenerationTask(useConfigStore.getState().config, 'fixture')]) { try { await call(); denied.push(false); } catch (error) { denied.push(error.code === 'product_feature_disabled'); } }
      return { unchanged: JSON.stringify(p.nodes.find(item => item.id === 'offline-config').metadata) === JSON.stringify(fixture.oldParams), denied };
    }, fixture);
    check(result.unchanged && result.denied.every(Boolean), '生成门禁或旧参数保留失败');
    await openSettings(); await settings().getByRole('tab', { name: '偏好设置', exact: true }).click();
    check(await settings().getByText(/视频默认模型|语音默认模型|音频格式|语音音色|视频分辨率/).count() === 0, '已关闭默认参数仍显示');
    await closeSettings();
    return { modes, ...result };
  });

  await test('C15与超分占位无工具入口，本地插值保留；设置/图片预览重复开关可用', async () => {
    const tools = await page.evaluate(async () => (await window.__guanImport('/src/components/canvas/canvas-image-toolbar-tools.tsx')).imageToolDefinitions.map(item => item.id));
    check(!tools.includes('info') && !tools.includes('superResolve') && tools.includes('upscale'), '工具定义不符');
    await node('offline-image').hover();
    check(await page.getByRole('button', { name: /节点信息|AI 超分/ }).count() === 0, '关闭入口仍挂载');
    for (let i = 0; i < 3; i++) {
      await openSettings(); await closeSettings();
      await node('offline-image').dblclick({ position: { x: 100, y: 80 } });
      const modal = page.getByRole('dialog', { name: '图片详情', exact: true }); await modal.waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] img')].some(img => img.naturalWidth === 320));
      await page.keyboard.press('Escape'); await modal.waitFor({ state: 'hidden' });
    }
    return { imageDetailsCycles: 3, settingsCycles: 3, localUpscaleRetained: true };
  });

  await test('本地音视频可读取、播放、下载；已有视频任务仍可模拟恢复并保存结果', async () => {
    const result = await page.evaluate(async fixture => {
      const media = await window.__guanImport('/src/services/file-storage.ts');
      const results = [];
      for (const [tag, item] of [['video', fixture.video], ['audio', fixture.audio]]) {
        const url = await media.resolveMediaUrl(item.storageKey), blob = await media.getMediaBlob(item.storageKey);
        const el = document.createElement(tag); el.src = url; el.muted = true;
        await new Promise((resolve, reject) => { el.onloadeddata = resolve; el.onerror = () => reject(Error('合成' + tag + '媒体无法解码：' + blob.size + '字节')); });
        await el.play();
        for (let attempt = 0; attempt < 25 && el.currentTime <= 0; attempt++) await new Promise(resolve => setTimeout(resolve, 80));
        const playing = el.currentTime > 0; el.pause();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        results.push({ tag, bytes: bytes.length, playing, mimeType: blob.type, currentTime: el.currentTime, readyState: el.readyState });
      }
      window.__syntheticMediaDownload = async () => { const a = document.createElement('a'); a.href = await media.resolveMediaUrl(fixture.video.storageKey); a.download = '合成本地视频.webm'; a.click(); };
      return results;
    }, fixture);
    check(result.every(item => item.bytes > 0 && item.playing), '本地媒体播放/读取失败：' + JSON.stringify(result));
    const downloading = page.waitForEvent('download'); await page.evaluate(() => window.__syntheticMediaDownload());
    await (await downloading).saveAs('__ARTIFACT_DIR__/合成本地视频.webm');
    // 待恢复任务在首次进入画布前即已持久化，避免测试从外部store写入与当前画布本地保存竞争。
    await page.waitForTimeout(1200); await page.reload({ waitUntil: 'domcontentloaded' });
    let restored;
    for (let attempt = 0; attempt < 100; attempt++) {
      restored = await page.evaluate(async id => {
        const n = (await window.__guanImport('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore.getState().openProject(id)?.nodes.find(item => item.id === 'offline-resume');
        if (!n?.metadata?.storageKey || n.metadata.status !== 'success') return { status: n?.metadata?.status ?? 'hydrating' };
        const blob = await (await window.__guanImport('/src/services/file-storage.ts')).getMediaBlob(n.metadata.storageKey);
        return { status: n.metadata.status, bytes: blob?.size };
      }, fixture.id);
      if (restored.status === 'success' && restored.bytes) break;
      await page.waitForTimeout(100);
    }
    check(restored.bytes === videoBody.length && report.mockVideoRequests.length >= 2, '旧任务结果未正确保存：' + JSON.stringify({ restored, expectedBytes: videoBody.length, requests: report.mockVideoRequests, localMedia: result }));
    return { localMedia: result, mockRecovery: restored, onlyExistingTaskGET: true, download: true };
  });

  await test('文本编辑、拖动、撤销重做、平移缩放及刷新保存回归', async () => {
    // 顶边悬浮工具栏可能被边界约束在卡片内，正文下部才是稳定编辑落点。
    const textNode = node('offline-text'); await textNode.dblclick({ position: { x: 180, y: 140 } });
    await textNode.locator('textarea').fill('精简后仍可保存并恢复'); await textNode.locator('textarea').press('Escape');
    await textNode.locator('textarea').waitFor({ state: 'hidden' });
    await page.waitForTimeout(1200);
    const old = await textNode.boundingBox();
    await page.mouse.move(old.x + 180, old.y + 140); await page.mouse.down(); await page.mouse.move(old.x + 250, old.y + 180, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(600);
    const moved = await textNode.boundingBox(); check(Math.abs(moved.x - old.x - 70) < 3, '拖动坐标异常：' + JSON.stringify({ old, moved }));
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await page.waitForTimeout(500);
    check(Math.abs((await textNode.boundingBox()).x - old.x) < 3, '撤销不正确');
    await page.getByRole('button', { name: '重做', exact: true }).click(); await page.waitForTimeout(500);
    check(Math.abs((await textNode.boundingBox()).x - moved.x) < 3, '重做不正确');
    // 用命中测试找到整段空白路径，避免播放器、提示词面板或工具栏拦截手势。
    const blank = await page.evaluate(() => {
      const canvas = document.querySelector('.relative.h-full.w-full.select-none.overflow-hidden');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      for (let y = Math.max(rect.top + 100, 200); y < Math.min(rect.bottom - 90, innerHeight - 90); y += 40) {
        for (let x = Math.max(rect.left + 100, 100); x < Math.min(rect.right - 100, innerWidth - 100); x += 40) {
          if ([0, 0.25, 0.5, 0.75, 1].every(t => document.elementFromPoint(x + 40 * t, y + 30 * t) === canvas)) return { x, y };
        }
      }
      return null;
    });
    check(blank, '找不到未被面板遮挡的画布平移落点');
    await page.mouse.move(blank.x, blank.y); await page.mouse.down({ button: 'middle' }); await page.mouse.move(blank.x + 40, blank.y + 30, { steps: 10 }); await page.mouse.up({ button: 'middle' }); await page.waitForTimeout(600);
    const pan = await textNode.boundingBox(); check(Math.abs(pan.x - moved.x) > 2, '平移未生效');
    await page.mouse.move(blank.x, blank.y); await page.mouse.wheel(0, -100); await page.waitForTimeout(600);
    check(Math.abs((await textNode.boundingBox()).width - moved.width) > 1, '缩放未生效');
    await page.waitForTimeout(1200); await page.reload({ waitUntil: 'domcontentloaded' });
    await textNode.getByText('精简后仍可保存并恢复', { exact: true }).waitFor();
    await page.screenshot({ path: '__ARTIFACT_DIR__/画布精简验收.png' });
    return { drag: true, undoRedo: true, panZoom: true, blankGesturePoint: blank, reloadRetained: true };
  });

  await test('窄屏三态设置可开关，无未处理异常或未批准出网', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openSettings(); await settings().getByRole('tab', { name: '偏好设置', exact: true }).click();
    await settings().getByRole('combobox', { name: '界面主题', exact: true }).waitFor();
    await page.screenshot({ path: '__ARTIFACT_DIR__/窄屏主题设置.png' }); await closeSettings();
    check(report.errors.length === 0 && report.externalRequests.length === 0, '出现页面错误或非预期联网');
    return { viewport: '390x844', errors: 0, unexpectedRequests: 0 };
  });
  report.passed = true;
  await save();
  console.log(JSON.stringify(report));
}
