import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { 创建有界运行日志 } from '../扩展功能/本机服务/有界运行日志.mjs';
import { 确保桌面启动助手 } from './桌面启动助手.mjs';

async function waitForFile(path, { timeoutMs, childState }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    if (childState.failed) return false;
    await delay(50);
  }
  return existsSync(path);
}

export async function 创建桌面启动反馈({
  runtime,
  logo,
  log,
  launch = spawn,
  ensureAssistant = 确保桌面启动助手,
  visibleTimeoutMs = 5000,
  closeTimeoutMs = 5000,
} = {}) {
  let directory, child, closed = false;
  const recordFailure = message => {
    try {
      创建有界运行日志(log, { maxBytes: 128 * 1024, files: 2 })
        .write(new Date().toISOString() + ' 桌面启动窗口异常：' + message + '\n');
    } catch {}
  };
  const noop = () => ({ update() {}, async close() {}, async waitUntilClosed() {} });

  try {
    mkdirSync(runtime, { recursive: true, mode: 0o700 });
    const assistant = await ensureAssistant(runtime, logo);
    directory = mkdtempSync(join(runtime, '启动反馈-'));
    const state = join(directory, '状态.json');
    const shown = join(directory, '窗口已显示');
    const done = join(directory, '窗口已关闭');
    const childState = { failed: false, output: '' };

    const update = (phase, message) => {
      if (closed) return;
      try {
        const temporary = state + '.tmp';
        writeFileSync(temporary, JSON.stringify({ phase, message }), { mode: 0o600 });
        renameSync(temporary, state);
      } catch (error) {
        childState.failed = true;
        recordFailure('启动状态写入失败：' + error.message);
      }
    };

    update('waiting', '正在检查本机服务...');
    child = launch('/usr/bin/open', ['-n', '-a', assistant, '--args',
      state, String(process.pid), logo, log, shown, done], { stdio: ['ignore', 'pipe', 'pipe'] });
    const collect = chunk => { childState.output = (childState.output + chunk.toString('utf8')).slice(-4096); };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.once('error', error => {
      childState.failed = true;
      childState.output = error.message;
      recordFailure('启动LaunchServices助手失败：' + error.message);
    });
    child.once('exit', (code, signal) => {
      if (code !== 0 || signal) {
        childState.failed = true;
        childState.output ||= `${signal || code}`;
        recordFailure('LaunchServices未启动助手：' + childState.output);
      }
    });
    child.once('error', error => {
      childState.failed = true;
      childState.output = error.message;
    });
    child.once('exit', (code, signal) => {
      if (code !== 0 || signal) {
        childState.failed = true;
        childState.output ||= `${signal || code}`;
      }
    });

    if (!await waitForFile(shown, { timeoutMs: visibleTimeoutMs, childState })) {
      recordFailure('原生助手未确认窗口已显示' + (childState.output ? ': ' + childState.output : ''));
      closed = true;
      rmSync(directory, { recursive: true, force: true });
      return noop();
    }

    return {
      update,
      async waitUntilClosed() {
        await waitForFile(done, { timeoutMs: 300000, childState });
      },
      async close() {
        if (closed) return;
        update('done', '');
        const acknowledged = await waitForFile(done, { timeoutMs: closeTimeoutMs, childState });
        if (!acknowledged) {
          recordFailure('原生助手未确认正常关闭' + (childState.output ? ': ' + childState.output : ''));
        }
        closed = true;
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    recordFailure(error.message);
    child?.kill();
    if (directory) rmSync(directory, { recursive: true, force: true });
    return noop();
  }
}
