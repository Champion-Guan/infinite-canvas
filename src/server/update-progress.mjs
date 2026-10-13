import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fork } from 'node:child_process';
import { join } from 'node:path';
import { UpdateError } from './update-auth.mjs';
import { parseVersion } from './stable-version.mjs';

export function progressSnapshot(target, status, ready) {
  const relevant = status.targetVersion === target;
  // Global barriers remain informative after a daemon restart, even when its
  // in-memory target identity is absent. Terminal success stays target-bound.
  const barrier = ['unavailable', 'blocked', 'awaiting-browser-exit', 'confirmation-required', 'deferred', 'recovery-required', 'activation-required'].includes(status.state);
  let state = relevant || barrier ? status.state : 'preparing';
  // A committed journal alone does not prove the service activated successfully.
  if (state === 'committed') state = ready?.owned === true && ready.currentVersion === target ? 'success' : 'starting';
  if (state === 'rolled-back' && !(ready?.owned === true && ready.currentVersion === status.currentVersion)) state = 'recovery-required';
  return { target, state, reason: relevant || barrier ? status.reason : null };
}

const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI-Workbench 更新进度</title><link rel="stylesheet" href="./style.css"><main><h1>工作台更新进度</h1><p id="version"></p><ol><li>下载与签名验证已完成</li><li>保存并关闭工作台页面</li><li>准备与安装新版本</li><li>启动服务并检查健康状态</li><li>完成更新</li></ol><h2 id="state" role="status">正在连接独立更新器…</h2><p id="detail"></p><p id="time"></p><p>此窗口可保持打开，不会阻止安装。其他网站和应用无需退出。</p><a href="http://127.0.0.1:8888" target="_blank" rel="noopener" id="return" hidden>打开工作台</a><p id="hint">安装成功后会自动打开工作台。安装前请关闭所有 8888 工作台页面。</p></main><script src="./app.js"></script></html>`;
const css = `li[data-complete],h2[data-state=success]{color:#16a34a}h2[data-state=failed],h2[data-state=blocked],h2[data-state=rolled-back],h2[data-state=recovery-required]{color:#ef4444}:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0;background:#f5f5f4;color:#292524}main{max-width:650px;margin:40px auto;padding:28px;background:white;border-radius:18px}h1{font-size:24px}h2{font-size:20px}p,li{line-height:1.8}ol{padding-left:24px}li[data-active]{color:#2563eb;font-weight:600}a{display:inline-block;padding:10px 18px;background:#2563eb;color:white;border-radius:8px;text-decoration:none}a[hidden]{display:none}@media(prefers-color-scheme:dark){body{background:#111;color:#e7e5e4}main{background:#222}li[data-active]{color:#93c5fd}}`;
const js = `const labels={preparing:['正在准备安装','正在解包和复核签名，请保持此窗口打开。'],staged:['等待安装确认','回到工作台完成本次安装确认后，关闭工作台页面。'],idle:['等待安装确认','回到工作台确认本次更新。'], 'awaiting-browser-exit':['等待工作台页面关闭','请关闭所有 8888 工作台标签页及窗口；不要关闭此进度窗口。'],prepared:['正在准备版本切换','已建立版本事务，私人数据保留。'],stopping:['正在停止旧版服务','正在等待工作台服务安全退出。'],switching:['正在安装新版本','正在切换到已验证的版本目录。'],starting:['正在启动并验证新版','只有服务健康且版本一致后才显示更新成功。'],success:['更新成功','新版本服务已启动并通过健康与归属检查。'], 'rolling-back':['更新失败，正在恢复旧版','请等待恢复完成，避免重复启动服务。'], 'rolled-back':['已恢复旧版','旧版本服务已恢复；可回到工作台查看原因并重新确认更新。'], 'recovery-required':['需要安全恢复','更新器未能确认恢复结果。数据未被清空，请保留现场并联系维护人员。'], 'activation-required':['等待确认服务启动','版本已切换，但尚未确认服务激活，不代表更新成功。'],blocked:['安装暂未继续','安全检查未通过。可回到工作台查看原因，不要强杀服务。'],unavailable:['暂时无法连接更新器','正在重试。此状态不代表更新成功或数据丢失。'],deferred:['已暂缓安装','回到工作台重新确认后才会安装。'], 'confirmation-required':['需要重新确认','确认已失效，请回到工作台保存并重新确认。'],failed:['安装准备未完成','回到工作台查看错误并重试；此窗口不会再次发起安装。']};const started=Date.now();let last='',stepStarted=started;const reasons={install_browsers_running:'还有工作台页面打开，请保存并关闭。',install_page_inventory_unavailable:'无法核实页面关闭状态，请检查浏览器自动化授权。',install_operator_confirmation_required:'本次确认已失效，请重新确认。',install_backend_not_idle:'服务仍有活动，请等待任务完成。',service_port_occupied:'8888 端口被占用，请勿强杀未知进程。',service_health_invalid:'新版本健康检查未通过。',update_failed_rolled_back:'更新失败，旧版本已恢复。',update_rollback_failed:'自动恢复未完成，请联系维护人员。',update_storage_invalid:'更新记录异常，已停止安装并保留原数据。',service_ownership_lost:'服务归属未确认，已停止切换。'};async function poll(){try{const r=await fetch('./status',{cache:'no-store',signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error();const s=await r.json();if(last!==s.state)stepStarted=Date.now();const pair=labels[s.state]||['等待更新器确认','正在读取安装状态，请保持此窗口打开。'];document.getElementById('version').textContent='目标版本：v'+s.target;document.getElementById('state').textContent=pair[0];document.getElementById('state').dataset.state=s.state;document.getElementById('detail').textContent=pair[1]+(s.reason?' '+(reasons[s.reason]||'安全条件尚未满足，请回到工作台查看详情。')+'（'+s.reason+'）':'');document.getElementById('time').textContent='此窗口已等待 '+Math.floor((Date.now()-started)/1000)+' 秒 · 当前步骤 '+Math.floor((Date.now()-stepStarted)/1000)+' 秒 · '+new Date().toLocaleTimeString()+' 状态已刷新';document.getElementById('return').hidden=!['success','rolled-back','failed','blocked','deferred','confirmation-required','recovery-required','unavailable','staged','idle'].includes(s.state);const step=s.state==='success'?4:s.state==='starting'?3:['preparing','prepared','stopping','switching','rolling-back','rolled-back'].includes(s.state)?2:1;document.querySelectorAll('li').forEach((li,i)=>{li.toggleAttribute('data-active',i===step&&!['blocked','rolled-back','failed','recovery-required','unavailable'].includes(s.state));li.toggleAttribute('data-complete',s.state==='success'||i<step&&!['blocked','rolled-back','failed','recovery-required','unavailable'].includes(s.state));});document.getElementById('hint').textContent=s.state==='success'?'可以关闭此进度窗口，继续使用工作台。':s.state==='rolled-back'?'旧版已恢复；重新尝试更新时仍需保存并确认。':'安装成功后会自动打开工作台。安装前请关闭所有 8888 工作台页面。';last=s.state;}catch{document.getElementById('state').textContent='状态连接中断，正在重试';document.getElementById('detail').textContent='最后状态：'+(labels[last]?.[0]||'尚未确认')+'。没有收到成功证明，请勿重复安装。';}setTimeout(poll,2000)}poll();`;

export async function serveUpdateProgress({ target, readStatus, lifetimeMs = 60 * 60 * 1000 }) {
  const parsed = parseVersion(target);
  if (!parsed || parsed.pre.length) throw Error('progress_target_invalid');
  const capability = randomBytes(24).toString('hex');
  let host;
  const server = createServer(async (req, res) => {
    const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" };
    const send = (code, type, body) => { res.writeHead(code, { ...headers, 'content-type': type }); res.end(body); };
    if (req.headers.host !== host || req.method !== 'GET' || req.headers.origin && req.headers.origin !== `http://${host}`) return send(403, 'text/plain', 'Forbidden');
    const route = req.url;
    if (route === `/${capability}/`) return send(200, 'text/html; charset=utf-8', page);
    if (route === `/${capability}/app.js`) return send(200, 'text/javascript; charset=utf-8', js);
    if (route === `/${capability}/style.css`) return send(200, 'text/css; charset=utf-8', css);
    if (route === `/${capability}/status`) {
      try { return send(200, 'application/json', JSON.stringify(await readStatus())); }
      catch { return send(200, 'application/json', JSON.stringify({ target, state: 'unavailable', reason: null })); }
    }
    send(404, 'text/plain', 'Not found');
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.maxConnections = 16;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  host = `127.0.0.1:${server.address().port}`;
  const timer = setTimeout(() => { server.close(); server.closeAllConnections(); }, lifetimeMs);
  timer.unref(); server.once('close', () => clearTimeout(timer));
  return { url: `http://${host}/${capability}/`, close: () => { server.close(); server.closeAllConnections(); } };
}

export class UpdateProgressLauncher {
  constructor({ projectRoot, privateRoot }) { this.projectRoot = projectRoot; this.privateRoot = privateRoot; this.current = null; this.pending = null; }
  async open(target) {
    if (this.pending) return this.pending;
    this.pending = this.launch(target).finally(() => { this.pending = null; });
    return this.pending;
  }
  async launch(target) {
    if (this.current?.target === target && this.current.child.exitCode === null && !this.current.child.killed) return { url: this.current.url };
    if (this.current) throw new UpdateError('update_progress_already_open');
    const child = fork(join(this.projectRoot, 'scripts/run-update-progress.mjs'), [target], {
      detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { GUAN_WORKBENCH_DATA_DIR: this.privateRoot, ...(process.env.HOME ? { HOME: process.env.HOME } : {}) },
    });
    try {
      const url = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new UpdateError('update_progress_unavailable')), 10000);
        child.once('error', () => { clearTimeout(timer); reject(new UpdateError('update_progress_unavailable')); });
        child.once('exit', () => { clearTimeout(timer); reject(new UpdateError('update_progress_unavailable')); });
        child.once('message', value => {
          clearTimeout(timer);
          if (!value || typeof value.url !== 'string' || !/^http:\/\/127\.0\.0\.1:\d{1,5}\/[a-f0-9]{48}\/$/.test(value.url)) reject(new UpdateError('update_progress_unavailable'));
          else resolve(value.url);
        });
      });
      this.current = { child, target, url };
      child.once('exit', () => { this.current = null; });
      child.unref(); child.channel?.unref();
      return { url };
    } catch (e) { child.kill(); throw e; }
  }
  failed() { if (this.current?.child.connected) this.current.child.send({ state: 'failed' }, () => {}); }
}
