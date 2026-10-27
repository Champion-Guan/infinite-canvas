import { GENERATION_PROTOCOL, terminalState } from './生成协议.mjs';

// 复用原页面能力，只观察已有任务；观察断开不取消任务、不创建任何生成请求。
export async function observeTextProgress({ request, response, authorize, tasks, id }) {
  const controller = new AbortController(), abort = () => controller.abort();
  response.once('close', abort);
  response.once('error', abort);
  const signal = controller.signal;
  const pause = ms => new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms); signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
  async function write(value) {
    signal.throwIfAborted();
    if (response.write(JSON.stringify({ protocol: GENERATION_PROTOCOL, ...value }) + '\n')) return;
    await new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); response.removeListener('drain', drain); signal.removeEventListener('abort', cancel); };
      const drain = () => { cleanup(); resolve(); }, cancel = () => { cleanup(); reject(Error('observation_closed')); };
      const timer = setTimeout(cancel, 5000); response.once('drain', drain); signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }
  try {
    tasks.get(id); await authorize(request);
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Accel-Buffering': 'no' });
    response.flushHeaders?.();
    const began = Date.now();
    let revision = -1, state;
    while (!signal.aborted && Date.now() - began < 650_000) {
      await authorize(request);
      const snapshot = tasks.textProgress(id), done = terminalState(snapshot.job.state);
      if ((snapshot.progress?.revision || 0) !== revision || snapshot.job.state !== state || done) {
        revision = snapshot.progress?.revision || 0; state = snapshot.job.state;
        await write({ ...snapshot, done });
      } else await write({ heartbeat: true });
      if (done) { response.end(); return; }
      await pause(80); // 合并同一帧内的token，不为每个字创建响应或积压队列。
      if (!signal.aborted) await tasks.waitTextProgress(id, revision, signal);
    }
    if (!signal.aborted) response.end(JSON.stringify({ protocol: GENERATION_PROTOCOL, error: { code: 'generation_observation_ended' } }) + '\n');
  } catch {
    // 授权撤销后不继续交付缓存内容，页面稍后仍可查询原任务。
    response.destroy();
  } finally { controller.abort(); response.removeListener('close', abort); response.removeListener('error', abort); }
}
