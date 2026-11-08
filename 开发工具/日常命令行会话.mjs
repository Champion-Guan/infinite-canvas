import { createInterface } from 'node:readline';

export const 停止确认 = '已保存并关闭，停止';
export function 解析日常命令(args) {
  const modes = ['--帮助', '--准备', '--检查', '--安装助手', '--启动', '--隔离验收'];
  if (!args.length) return { mode: '--帮助' };
  const mode = args[0]; if (!modes.includes(mode)) throw Error('未知操作');
  const fields = new Map();
  for (const arg of args.slice(1)) {
    const index = arg.indexOf('='), key = index < 0 ? arg : arg.slice(0, index), value = index < 0 ? true : arg.slice(index + 1);
    if (fields.has(key) || value === '') throw Error('参数重复或为空'); fields.set(key, value);
  }
  const required = mode === '--准备' ? ['--日常记录', '--协调记录'] : mode === '--帮助' ? [] : ['--运行包', '--清单指纹'];
  const flags = mode === '--安装助手' ? ['--批准安装助手'] : mode === '--启动' ? ['--已保存并关闭', '--首次初始化'] : [];
  if ([...fields.keys()].some(key => ![...required, ...flags].includes(key)) || required.some(key => typeof fields.get(key) !== 'string') ||
    flags.some(key => fields.has(key) && fields.get(key) !== true) || mode === '--帮助' && fields.size ||
    mode === '--启动' && fields.get('--已保存并关闭') !== true || mode === '--安装助手' && fields.get('--批准安装助手') !== true) throw Error('参数范围不符或缺少明确确认');
  return { mode, fields };
}

// 只接收当前控制台明确的停止确认。信号和stdin EOF都不是“编辑已保存”的证据。
// 阶段10再装配后台管理；本阶段保持前台控制台，不静默脱离后失去维护入口。
export function 管理日常会话(app, { input, emit, signals = process }) {
  if (typeof app?.close !== 'function' || typeof emit !== 'function') throw Error('会话装配无效');
  const reader = createInterface({ input, terminal: false });
  let queue = Promise.resolve(), stopped = false, closing = false;
  const signal = () => emit({ phase: 'maintenance-required', message: '服务保持运行。请保存、结束任务、关闭页面后输入：' + 停止确认 });
  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) signals.on(name, signal);
  return new Promise(resolve => {
    reader.on('line', line => {
      queue = queue.then(async () => {
        if (stopped) return;
        if (line === '状态') { emit({ phase: closing ? 'stopping' : 'ready' }); return; }
        if (line !== 停止确认) { signal(); return; }
        closing = true; emit({ phase: 'stopping' });
        try {
          await app.close({ savedAndClosed: true }); stopped = true;
          for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) signals.removeListener(name, signal);
          reader.close(); emit({ phase: 'stopped' }); resolve();
        } catch {
          closing = false; emit({ phase: 'stop-failed', message: '停止未完全确认。请保留数据和锁，不要强杀或清理。' });
        }
      }).catch(() => emit({ phase: 'control-failed', message: '控制命令未完成，服务未自动关闭。' }));
    });
    reader.on('close', () => { if (!stopped) emit({ phase: 'control-input-closed', message: '控制台输入已关闭，但未收到保存关闭确认。服务和数据保留，不自动清锁。' }); });
    reader.on('error', () => signal());
  });
}
