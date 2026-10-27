import { 检查目录容量 } from './目录容量限制.mjs';

// 子进程持续写入时重复检查；越限只通知一次，调用方停止自己拥有的写入进程。
export function 开始目录写入监测(directory, options, onExceeded, intervalMs = 1000) {
  if (typeof onExceeded !== 'function' || !Number.isInteger(intervalMs) || intervalMs < 20) throw Error('目录监测参数异常');
  let failure = null;
  const check = () => { if (failure) throw failure; return 检查目录容量(directory, options); };
  check();
  const timer = setInterval(() => {
    try { check(); } catch (error) { if (!failure) { failure = error; onExceeded(error); } }
  }, intervalMs);
  timer.unref();
  return { check, stop() { clearInterval(timer); } };
}
