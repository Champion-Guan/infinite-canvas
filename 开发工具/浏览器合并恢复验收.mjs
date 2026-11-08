async (page) => {
  const origin = 'http://localhost:3100';
  const report = { origin, results: [], errors: [], unexpectedRequests: [], sourceRequests: 0, mediaRequests: [] };
  if (page.url() !== 'about:blank') throw Error('只能使用全新隔离测试浏览器');
  const check = (value, message) => { if (!value) throw Error(message); };
  page.on('pageerror', error => report.errors.push(error.message));
  let sourceOffline = false, mediaFail = false, audioBody, videoBody, videoSequence = 0;
  await page.context().route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin) return route.continue();
    const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
    if (['https://source.example.invalid', 'https://media.example.invalid'].includes(url.origin) && request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.href === 'https://source.example.invalid/prompts.json' && request.method() === 'GET') {
      report.sourceRequests++;
      return route.fulfill({ status: sourceOffline ? 503 : 200, headers, contentType: 'application/json', body: JSON.stringify([{ id: 'synthetic-dimensions', title: '合成尺寸展示', prompt: '长度 宽度 高度，保持比例', tags: ['尺寸'], coverUrl: '/cover.png', referenceImageUrls: ['/ref.png'] }]) });
    }
    if (url.origin === 'https://source.example.invalid' && ['/cover.png', '/ref.png'].includes(url.pathname) && request.method() === 'GET') return route.fulfill({ status: 200, headers, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="#7c3aed"/></svg>' });
    if (url.origin === 'https://media.example.invalid' && request.method() === 'POST' && ['/v1/audio/speech', '/v1/videos'].includes(url.pathname)) {
      report.mediaRequests.push({ method: request.method(), path: url.pathname, failed: mediaFail });
      if (mediaFail) return route.fulfill({ status: 503, headers, contentType: 'application/json', body: JSON.stringify({ error: { message: '合成媒体服务暂不可用' } }) });
      if (url.pathname.endsWith('/speech')) return route.fulfill({ status: 200, headers, contentType: 'audio/wav', body: audioBody });
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ id: 'synthetic-created-' + (++videoSequence), status: 'queued' }) });
    }
    if (url.origin === 'https://media.example.invalid' && request.method() === 'GET' && /^\/v1\/videos\/synthetic-created-\d+(\/content)?$/.test(url.pathname)) {
      report.mediaRequests.push({ method: 'GET', path: url.pathname });
      return route.fulfill({ status: 200, headers, contentType: url.pathname.endsWith('/content') ? 'video/webm' : 'application/json', body: url.pathname.endsWith('/content') ? videoBody : JSON.stringify({ status: 'completed' }) });
    }
    report.unexpectedRequests.push({ method: request.method(), url: url.origin + url.pathname }); return route.abort();
  });
  await page.addInitScript(() => {
    window.__sourceTimers = [];
    const interval = window.setInterval, clear = window.clearInterval;
    window.setInterval = function (callback, delay, ...args) {
      const id = interval.call(this, callback, delay, ...args);
      if ((new Error().stack || '').includes('use-prompt-source-scheduler')) window.__sourceTimers.push({ id, delay, callback });
      return id;
    };
    window.clearInterval = function (id) { window.__sourceTimers = window.__sourceTimers.filter(timer => timer.id !== id); return clear.call(this, id); };
    if (!sessionStorage.getItem('guan-restored-fixture')) {
      const ids = ['banana-prompt-quicker', 'davidwu-gpt-image2-prompts', 'freestylefly-gpt-image-2', 'awesome-gpt-image', 'awesome-gpt4o-image-prompts', 'youmind-gpt-image-2', 'youmind-nano-banana-pro'];
      localStorage.setItem('infinite-canvas:prompt_source_store_v2', JSON.stringify({ state: { sources: ids.map(id => ({ id, builtIn: true, enabled: false })), schedule: { intervalMinutes: 0, lastFetchedAt: '' } }, version: 0 }));
      sessionStorage.setItem('guan-restored-fixture', '1');
    }
  });
  const test = async (name, run) => {
    try { report.results.push({ name, passed: true, evidence: await run() }); }
    catch (error) { report.results.push({ name, passed: false, error: error.message }); throw error; }
    finally { await page.evaluate(value => { window.__guanRestoredAcceptance = value; }, report); }
  };
  const header = () => page.getByRole('banner', { name: '工作台顶栏', exact: true });
  const settings = () => page.getByRole('dialog', { name: /配置与用户偏好/ });
  const openSettings = async () => { await page.getByRole('button', { name: '画布设置', exact: true }).click(); await settings().waitFor(); await page.locator('body').evaluate(() => {}); };
  const closeSettings = async () => { await settings().getByRole('button', { name: '关闭', exact: true }).click(); await settings().waitFor({ state: 'hidden' }); };
  const snapshot = async () => { report.lastSnapshot = (await page.locator('body').ariaSnapshot()).slice(0, 16000); };
  const capture = async name => {
    // 等原版弹窗/下拉过渡结束后取证，避免把入场中间帧当成稳定界面。
    await page.waitForTimeout(450);
    await page.screenshot({ path: '__ARTIFACT_DIR__/' + name + '.png' });
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(origin, { waitUntil: 'domcontentloaded' }); await header().waitFor(); await snapshot();

  await test('三态主题保留；设置中四类默认模型及完整音视频默认参数恢复', async () => {
    await page.waitForFunction(() => document.documentElement.classList.contains('dark') && !document.documentElement.dataset.magicuiThemeVt);
    await openSettings(); await settings().getByRole('tab', { name: '偏好设置', exact: true }).click(); await snapshot();
    const labels = await page.evaluate(async () => {
      const i18n = (await window.__guanImport('/src/i18n/index.ts')).default;
      return ['videoResolution', 'audioVoice', 'audioFormat', 'audioSpeed', 'audioInstructions'].map(key => i18n.t('config.preferences.' + key));
    });
    for (const label of labels) await settings().getByText(label, { exact: true }).first().waitFor();
    const theme = settings().getByRole('combobox', { name: '界面主题', exact: true });
    for (const [label, value] of [['浅色', 'light'], ['深色', 'dark'], ['跟随系统', 'dark']]) {
      await theme.click(); await page.locator('.ant-select-dropdown:visible').getByText(label, { exact: true }).click();
      await page.waitForFunction(value => document.querySelector('[aria-label="工作台顶栏"]').getAttribute('data-theme') === value && !document.documentElement.dataset.magicuiThemeVt, value);
    }
    await page.locator('.ant-select-dropdown:visible').waitFor({ state: 'hidden' });
    await capture('恢复音视频默认参数'); await closeSettings();
    return { restoredParameterLabels: labels, themeModes: 3 };
  });

  const fixture = await page.evaluate(async () => {
    const { useCanvasStore } = await window.__guanImport('/src/stores/canvas/use-canvas-store.ts');
    const config = await window.__guanImport('/src/stores/use-config-store.ts');
    const { uploadImage } = await window.__guanImport('/src/services/image-storage.ts');
    const { uploadMediaFile } = await window.__guanImport('/src/services/file-storage.ts');
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#7c3aed'; ctx.fillRect(0, 0, 320, 200);
    const image = await uploadImage(await new Promise(resolve => canvas.toBlob(resolve, 'image/png')));
    const stream = canvas.captureStream(8), chunks = [], recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const recording = new Promise(resolve => { recorder.ondataavailable = event => chunks.push(event.data); recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' })); });
    recorder.start();
    for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#7c3aed' : '#4c1d95'; ctx.fillRect(0, 0, 320, 200); await new Promise(resolve => setTimeout(resolve, 80)); }
    recorder.stop(); const videoBlob = await recording; stream.getTracks().forEach(track => track.stop());
    const video = await uploadMediaFile(videoBlob, 'video');
    const wav = new ArrayBuffer(44 + 16000), view = new DataView(wav);
    const str = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
    str(0, 'RIFF'); view.setUint32(4, 16036, true); str(8, 'WAVE'); str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, 16000, true);
    const audioBlob = new Blob([wav], { type: 'audio/wav' }), audio = await uploadMediaFile(audioBlob, 'audio');
    const channel = config.createModelChannel({ id: 'synthetic-media-channel', name: '合成媒体渠道', baseUrl: 'https://media.example.invalid/v1', apiKey: 'synthetic-not-real', models: ['image', 'text', 'video', 'audio'].map(capability => ({ name: 'synthetic-' + capability, capability })) });
    const audioModel = config.encodeChannelModel(channel.id, 'synthetic-audio'), videoModel = config.encodeChannelModel(channel.id, 'synthetic-video');
    config.useConfigStore.setState(state => ({ config: { ...state.config, channels: [channel], models: config.modelOptionsFromChannels([channel]), audioModel, videoModel, audioFormat: 'wav', autoFocusOnSelect: false } }));
    const id = useCanvasStore.getState().createProject('音视频提示词节点信息恢复验收');
    const node = (id, type, title, x, y, width, height, metadata) => ({ id, type, title, position: { x, y }, width, height, metadata });
    useCanvasStore.getState().updateProject(id, { nodes: [
      node('restore-text', 'text', '保存回归文本', 70, 140, 280, 180, { content: '原文保留', status: 'success' }),
      node('restore-image', 'image', '节点信息图片', 430, 140, 320, 200, { ...image, content: image.url, naturalWidth: 320, naturalHeight: 200, status: 'success' }),
      node('restore-audio-config', 'config', '语音参数', 70, 440, 420, 300, { generationMode: 'audio', model: audioModel, composerContent: '合成语音朗读', audioVoice: 'alloy', audioFormat: 'wav', audioSpeed: '1', audioInstructions: '平稳清晰', status: 'idle' }),
      node('restore-video-config', 'config', '视频参数', 700, 440, 420, 300, { generationMode: 'video', model: videoModel, composerContent: '合成产品视频', seconds: '4', size: '16:9', vquality: '720p', videoMode: 'text', status: 'idle' }),
      node('restore-old-video', 'video', '已有视频保留', 1500, 140, 320, 200, { ...video, content: video.url, status: 'success' }),
      node('restore-old-audio', 'audio', '已有语音保留', 1500, 500, 300, 150, { ...audio, content: audio.url, status: 'success' }),
    ], connections: [{ id: 'restore-line', fromNodeId: 'restore-text', toNodeId: 'restore-image' }], viewport: { x: 0, y: 0, k: 1 } });
    const b64 = async blob => btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
    return { id, audio, video, audioBase64: await b64(audioBlob), videoBase64: await b64(videoBlob) };
  });
  audioBody = Buffer.from(fixture.audioBase64, 'base64'); videoBody = Buffer.from(fixture.videoBase64, 'base64');
  await page.waitForTimeout(1200); await page.goto(origin + '/canvas/' + fixture.id, { waitUntil: 'domcontentloaded' });
  const node = id => page.locator(`[data-node-id="${id}"]`);
  await node('restore-image').waitFor(); await snapshot();
  const focusFixtureNode = async nodeId => {
    const info = await page.evaluate(async ({ projectId, nodeId }) => {
      const nodes = (await window.__guanImport('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore.getState().openProject(projectId).nodes;
      const target = nodes.find(n => n.id === nodeId), matches = nodes.filter(n => n.title === target.title);
      return { title: target.title, index: matches.findIndex(n => n.id === nodeId) };
    }, { projectId: fixture.id, nodeId });
    const escaped = info.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await page.getByRole('complementary').getByRole('button', { name: new RegExp('^' + escaped + '(?: |$)') }).nth(info.index).click();
    await page.waitForTimeout(600);
  };
  const hoverNode = async id => {
    const bounds = await node(id).boundingBox();
    check(bounds && bounds.x + bounds.width > 300 && bounds.y + bounds.height > 160 && bounds.x < 1400 && bounds.y < 900, '目标节点不可见：' + JSON.stringify({ id, bounds }));
    const x = Math.max(310, Math.min(1390, bounds.x + bounds.width / 2)), y = Math.max(180, Math.min(880, bounds.y + bounds.height / 2));
    await page.mouse.move(x, y);
    // 原作者工具栏跟随单选，不由悬停开启；真实点击选中，不能仅hover断言。
    await page.mouse.click(x, y); await page.waitForTimeout(100);
  };

  await test('节点信息/JSON真实开关，设置/图片详情反复开关不阻塞；图片默认info恢复', async () => {
    const tool = page.locator('[data-node-toolbar="restore-image"]');
    for (let i = 0; i < 3; i++) {
      await hoverNode('restore-image'); await snapshot(); await tool.getByRole('button', { name: '查看节点信息', exact: true }).click();
      const info = page.getByRole('dialog', { name: /节点信息/ }); await info.waitFor(); await snapshot();
      await info.getByText('restore-image', { exact: true }).waitFor();
      await info.getByText('JSON', { exact: true }).click(); check((await info.locator('pre').innerText()).includes('restore-image'), 'JSON未显示真实节点');
      await info.getByRole('button', { name: '关闭', exact: true }).click(); await info.waitFor({ state: 'hidden' });
      await openSettings(); await closeSettings();
      await node('restore-image').dblclick({ position: { x: 100, y: 100 } });
      const details = page.getByRole('dialog', { name: '图片详情', exact: true }); await details.waitFor();
      await page.keyboard.press('Escape'); await details.waitFor({ state: 'hidden' });
    }
    await focusFixtureNode('restore-text'); await page.locator('[data-node-toolbar="restore-text"]').getByRole('button', { name: '查看节点信息', exact: true }).click();
    const info = page.getByRole('dialog', { name: /节点信息/ }); await info.waitFor();
    await info.getByText('restore-text', { exact: true }).waitFor(); await capture('节点信息恢复');
    await page.keyboard.press('Escape'); await info.waitFor({ state: 'hidden' });
    return { imageInfoAndJSONCycles: 3, textInfo: true, settingsCycles: 3, imageDetailsCycles: 3 };
  });

  await test('画布四种生成模式可选，语音/视频真实参数面板恢复', async () => {
    for (const id of ['restore-audio-config', 'restore-video-config']) {
      const modes = await node(id).locator('.ant-segmented-item-label').allTextContents();
      check(modes.length === 4, '生成模式不完整：' + modes);
      check(await node(id).getByRole('button', { name: '开始生成', exact: true }).isEnabled(), '恢复后仍不可生成');
    }
    await focusFixtureNode('restore-audio-config'); await node('restore-audio-config').getByRole('button', { name: /Alloy.*WAV/i }).click();
    const panel = page.locator('.canvas-image-settings-popover'); await panel.waitFor(); await snapshot();
    await panel.getByRole('button', { name: 'Nova', exact: true }).click(); await panel.getByRole('button', { name: '1.25x', exact: true }).click();
    await panel.locator('textarea').fill('合成清晰朗读');
    await page.getByRole('banner', { name: '工作台顶栏', exact: true }).click({ position: { x: 700, y: 20 } }); await panel.waitFor({ state: 'hidden' });
    await focusFixtureNode('restore-video-config'); await node('restore-video-config').locator('button').filter({ hasText: /720|1080|秒/ }).last().click();
    await panel.waitFor(); await snapshot(); check((await panel.innerText()).length > 50, '视频参数面板未完整渲染');
    await capture('画布视频参数恢复');
    await header().click({ position: { x: 700, y: 20 } }); await panel.waitFor({ state: 'hidden' });
    return { modes: 4, audioVoiceFormatSpeedInstructions: true, videoParametersVisible: true };
  });

  const waitNodeResult = async (mode, status) => {
    await page.waitForFunction(async ({ id, mode, status }) => {
      const project = (await window.__guanImport('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore.getState().openProject(id);
      return project.nodes.some(n => n.type === mode && n.metadata?.status === status && n.id !== 'restore-old-' + mode);
    }, { id: fixture.id, mode, status });
  };
  await test('语音/视频通过真实UI完成模拟请求、持久化结果、生成按钮收尾', async () => {
    const evidence = [];
    for (const [id, mode] of [['restore-audio-config', 'audio'], ['restore-video-config', 'video']]) {
      await focusFixtureNode(id);
      await node(id).getByRole('button', { name: '开始生成', exact: true }).click(); await waitNodeResult(mode, 'success');
      await node(id).getByRole('button', { name: '开始生成', exact: true }).waitFor();
      evidence.push(await page.evaluate(async ({ id, mode }) => {
        const project = (await window.__guanImport('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore.getState().openProject(id);
        const n = project.nodes.find(n => n.type === mode && n.metadata?.status === 'success' && n.id !== 'restore-old-' + mode);
        const blob = await (await window.__guanImport('/src/services/file-storage.ts')).getMediaBlob(n.metadata.storageKey);
        return { mode, id: n.id, bytes: blob.size, status: n.metadata.status };
      }, { id: fixture.id, mode }));
    }
    check(evidence.every(item => item.bytes > 0), '生成结果没有持久化');
    return { results: evidence, paidServicesCalled: false };
  });

  await test('模拟生成失败可收尾，任务不一直loading，可重试成功', async () => {
    mediaFail = true;
    for (const [id, mode] of [['restore-audio-config', 'audio'], ['restore-video-config', 'video']]) {
      await focusFixtureNode(id);
      await node(id).getByRole('button', { name: '开始生成', exact: true }).click(); await waitNodeResult(mode, 'error');
      await node(id).getByRole('button', { name: '开始生成', exact: true }).waitFor();
    }
    mediaFail = false;
    // 原作者错误卡片的重试入口直接验证，不改任务状态或绕过UI。
    await page.evaluate(async id => { window.__failedRestoreNodes = (await window.__guanImport('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore.getState().openProject(id).nodes.filter(n => n.metadata?.status === 'error' && ['audio', 'video'].includes(n.type)).map(n => n.id); }, fixture.id);
    const ids = await page.evaluate(() => window.__failedRestoreNodes);
    check(ids.length === 2, '缺少两个失败结果卡片');
    // 失败结果可能在可视区外，先用作者适应全部内容工具使其可操作。
    const fit = page.getByRole('button', { name: /适应.*内容|适应.*画布|适应全部/ }).first();
    if (await fit.count()) await fit.click();
    for (const id of ids) {
      await focusFixtureNode(id); await node(id).getByRole('button', { name: '重试', exact: true }).click();
      await page.waitForFunction(async ({ projectId, nodeId }) => (await window.__guanImport('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore.getState().openProject(projectId).nodes.find(n => n.id === nodeId)?.metadata?.status === 'success', { projectId: fixture.id, nodeId: id });
    }
    return { failedTasks: 2, retrySuccess: 2, buttonsReset: true };
  });

  await openSettings(); await settings().getByRole('tab', { name: '提示词来源', exact: true }).click(); await snapshot();
  const sourceRow = () => settings().locator('.rounded-lg.border').filter({ has: page.getByText('合成恢复来源', { exact: true }) });
  const selectInterval = async label => { await settings().getByRole('combobox').last().click(); await page.locator('.ant-select-dropdown:visible').getByText(label, { exact: true }).click(); };
  const stale = () => page.evaluate(async id => {
    const localforage = (await window.__guanImport('/node_modules/.vite/deps/localforage.js')).default;
    const cache = localforage.createInstance({ name: 'infinite-canvas', storeName: 'prompt_cache' }), key = 'prompt-source:' + id;
    const value = await cache.getItem(key); await cache.setItem(key, { ...value, lastSuccessAt: '2020-01-01T00:00:00Z' });
  }, report.sourceId);
  await test('R02来源新增编辑启停、手动和全部刷新、内容查看与远程封面恢复', async () => {
    await settings().getByRole('button', { name: '新增来源', exact: true }).click();
    let drawer = page.getByRole('dialog', { name: '新增提示词来源', exact: true }); await drawer.waitFor(); await snapshot();
    await drawer.getByLabel('来源名称', { exact: true }).fill('合成恢复来源'); await drawer.getByLabel('JSON URL', { exact: true }).fill('https://source.example.invalid/prompts.json');
    await drawer.getByRole('button', { name: /^保\s*存$/ }).click(); await drawer.waitFor({ state: 'hidden' });
    report.sourceId = await page.evaluate(async () => (await window.__guanImport('/src/stores/use-prompt-source-store.ts')).usePromptSourceStore.getState().sources.find(s => s.name === '合成恢复来源').id);
    await sourceRow().getByRole('button', { name: '编辑来源', exact: true }).click();
    drawer = page.getByRole('dialog', { name: /编辑提示词来源/ }); await drawer.waitFor();
    await drawer.getByLabel('来源主页（可选）', { exact: true }).fill('https://source.example.invalid');
    await drawer.getByRole('button', { name: /^保\s*存$/ }).click(); await drawer.waitFor({ state: 'hidden' });
    await sourceRow().getByRole('switch').click(); check(await sourceRow().getByRole('switch').getAttribute('aria-checked') === 'false', '来源未停用');
    await sourceRow().getByRole('switch').click();
    await sourceRow().getByRole('button', { name: '立即拉取', exact: true }).click(); await sourceRow().getByText('1 条', { exact: true }).waitFor();
    await settings().getByRole('button', { name: '全部立即拉取', exact: true }).click();
    await sourceRow().getByRole('button', { name: '查看内容', exact: true }).click();
    const content = page.getByRole('dialog', { name: /合成恢复来源 · 提示词内容/ }); await content.waitFor(); await snapshot();
    await content.getByText('合成尺寸展示', { exact: true }).waitFor();
    const before = report.sourceRequests; await content.getByRole('button', { name: '立即更新', exact: true }).click();
    await page.waitForTimeout(300); check(report.sourceRequests > before, '内容刷新没有联网');
    const rows = await page.evaluate(async id => (await window.__guanImport('/src/services/api/prompts.ts')).fetchSourcePrompts(id), report.sourceId);
    check(rows[0].coverUrl === 'https://source.example.invalid/cover.png' && rows[0].referenceImageUrls[0] === 'https://source.example.invalid/ref.png', '远程封面参考图被错误过滤');
    await capture('提示词来源内容恢复'); await page.keyboard.press('Escape'); await content.waitFor({ state: 'hidden' });
    return { sourceId: report.sourceId, sourceRequests: report.sourceRequests, remoteURLsRetained: true, addEditToggle: true };
  });

  await test('R03启动到期检查、分钟调度、间隔0清理，刷新失败保留旧内容', async () => {
    await stale(); const before = report.sourceRequests;
    await selectInterval('每 30 分钟'); await page.waitForFunction(() => window.__sourceTimers.length === 1);
    await page.waitForFunction(async id => (await (await window.__guanImport('/src/services/api/prompts.ts')).fetchPromptSourceStatuses())[id].lastSuccessAt > '2020-01-01', report.sourceId);
    check(report.sourceRequests > before, '启用定时没有执行启动到期检查');
    await stale(); await page.evaluate(() => window.__sourceTimers[0].callback());
    await page.waitForFunction(async id => (await (await window.__guanImport('/src/services/api/prompts.ts')).fetchPromptSourceStatuses())[id].lastSuccessAt > '2020-01-01', report.sourceId);
    check(report.sourceRequests >= before + 2, '真实定时回调没有拉取');
    await selectInterval('关闭定时'); await page.waitForFunction(() => window.__sourceTimers.length === 0);
    sourceOffline = true; await sourceRow().getByRole('button', { name: '立即拉取', exact: true }).click(); await sourceRow().getByText('失败', { exact: true }).waitFor();
    const count = await page.evaluate(async id => (await (await window.__guanImport('/src/services/api/prompts.ts')).fetchSourcePrompts(id)).length, report.sourceId);
    check(count === 1, '失败清除了旧缓存'); sourceOffline = false;
    await closeSettings(); return { initialDueCheck: true, timerCallback: true, intervalZeroCleansUp: true, failedRefreshPreservesCount: count };
  });

  await test('已有媒体仍可解码播放，生成结果刷新保留，其他关闭项未误开', async () => {
    const result = await page.evaluate(async fixture => {
      const media = await window.__guanImport('/src/services/file-storage.ts');
      const played = [];
      for (const [tag, item] of [['audio', fixture.audio], ['video', fixture.video]]) {
        const blob = await media.getMediaBlob(item.storageKey), el = document.createElement(tag); el.muted = true; el.src = await media.resolveMediaUrl(item.storageKey);
        await new Promise((resolve, reject) => { el.onloadeddata = resolve; el.onerror = () => reject(Error(tag + '解码失败')); }); await el.play();
        // 音频设备初始化不保证150ms内开始走时；以实际播放时间前进为准，最多等待3秒。
        for (let i = 0; i < 60 && el.currentTime === 0; i++) await new Promise(resolve => setTimeout(resolve, 50));
        const playing = el.currentTime > 0; el.pause(); played.push({ tag, bytes: blob.size, playing, currentTime: el.currentTime, duration: el.duration });
      }
      const policy = await window.__guanImport('/src/guan/精简与离线策略.ts'), scripts = await window.__guanImport('/src/guan/脚本与提示词来源.ts');
      let rejected = false; try { scripts.requireBusinessFeature('modelScripts'); } catch (error) { rejected = error.code === 'product_feature_disabled'; }
      return { played, rejected, closed: policy.closedFeatureIds, superResolve: policy.auxiliaryFeatures.superResolve };
    }, fixture);
    check(result.played.every(item => item.playing && item.bytes > 0) && result.rejected && result.superResolve === false, '媒体或门禁异常：' + JSON.stringify(result));
    await page.waitForTimeout(1200); await page.reload({ waitUntil: 'domcontentloaded' });
    await header().waitFor(); await focusFixtureNode('restore-text'); await node('restore-text').waitFor();
    const state = await page.evaluate(async id => {
      const p = (await window.__guanImport('/src/stores/canvas/use-canvas-store.ts')).useCanvasStore.getState().openProject(id);
      return { mediaCount: p.nodes.filter(n => ['audio', 'video'].includes(n.type) && n.metadata?.status === 'success').length, connections: p.connections.length };
    }, fixture.id);
    check(state.mediaCount >= 6 && state.connections > 1, '刷新丢失媒体或连线'); return { ...result, ...state };
  });

  await test('画布编辑、拖动、撤销重做、平移缩放和刷新保存仍正常', async () => {
    // 使用作者原有侧栏定位，不与当前画布的视口持久化防抖争写测试初始视口。
    await focusFixtureNode('restore-text'); const text = node('restore-text'); await text.waitFor();
    await text.dblclick({ position: { x: 180, y: 140 } }); await text.locator('textarea').fill('恢复后仍可编辑保存'); await text.locator('textarea').press('Escape'); await text.locator('textarea').waitFor({ state: 'hidden' });
    await page.waitForTimeout(1200); const old = await text.boundingBox();
    await page.mouse.move(old.x + 180, old.y + 140); await page.mouse.down(); await page.mouse.move(old.x + 240, old.y + 170, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(400);
    const moved = await text.boundingBox(); check(Math.abs(moved.x - old.x - 60) < 3, '卡片拖动失败');
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await page.waitForTimeout(300); check(Math.abs((await text.boundingBox()).x - old.x) < 3, '撤销失败');
    await page.getByRole('button', { name: '重做', exact: true }).click(); await page.waitForTimeout(300); check(Math.abs((await text.boundingBox()).x - moved.x) < 3, '重做失败');
    const blank = await page.evaluate(() => {
      const el = document.querySelector('.relative.h-full.w-full.select-none.overflow-hidden'), r = el.getBoundingClientRect();
      for (let y = r.top + 100; y < r.bottom - 100; y += 40) for (let x = r.left + 100; x < r.right - 100; x += 40) if ([0, .25, .5, .75, 1].every(t => document.elementFromPoint(x + t * 40, y + t * 30) === el)) return { x, y };
    });
    check(blank, '找不到空白平移落点'); await page.mouse.move(blank.x, blank.y); await page.mouse.down({ button: 'middle' }); await page.mouse.move(blank.x + 40, blank.y + 30, { steps: 8 }); await page.mouse.up({ button: 'middle' }); await page.waitForTimeout(400);
    check(Math.abs((await text.boundingBox()).x - moved.x) > 2, '画布平移失败'); await page.mouse.wheel(0, -100); await page.waitForTimeout(400); check(Math.abs((await text.boundingBox()).width - moved.width) > 1, '画布缩放失败');
    await page.waitForTimeout(1200); await page.reload({ waitUntil: 'domcontentloaded' }); await text.getByText('恢复后仍可编辑保存', { exact: true }).waitFor();
    await capture('恢复后画布回归'); return { editing: true, drag: true, undoRedo: true, panZoom: true, reload: true };
  });

  await test('来源删除真实生效，设置窄屏可关闭，无未处理异常或未声明外网', async () => {
    await openSettings(); await settings().getByRole('tab', { name: '提示词来源', exact: true }).click(); await sourceRow().getByRole('button', { name: '删除', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: /删除「合成恢复来源」/ }); await confirm.waitFor(); await confirm.getByRole('button', { name: /^删\s*除$/ }).click(); await confirm.waitFor({ state: 'hidden' });
    check(await sourceRow().count() === 0, '删除来源仍在列表'); await closeSettings();
    await page.setViewportSize({ width: 390, height: 844 }); await openSettings(); await settings().getByRole('tab', { name: '偏好设置', exact: true }).click();
    await settings().getByRole('combobox', { name: '界面主题', exact: true }).waitFor(); await capture('窄屏恢复设置'); await closeSettings();
    check(report.errors.length === 0 && report.unexpectedRequests.length === 0, '页面异常或未预期出网：' + JSON.stringify({ errors: report.errors, requests: report.unexpectedRequests }));
    return { deleteSource: true, narrowSettingsCloses: true, errors: 0, unexpectedRequests: 0 };
  });
  report.passed = true; await snapshot(); await page.evaluate(value => { window.__guanRestoredAcceptance = value; }, report);
  console.log(JSON.stringify(report));
}
