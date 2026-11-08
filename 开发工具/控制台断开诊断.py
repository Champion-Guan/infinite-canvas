"""仅合成HTTP服务：复现PTY断开写EIO，比较原会话与输出防护。不打开工作区/Keychain。"""
import fcntl
import json
import os
import pty
import signal
import subprocess
import termios
import time


def check(guarded):
    master, slave = pty.openpty()
    diagnostic_read, diagnostic_write = os.pipe()
    code = r"""
import { createServer } from 'node:http';
import { writeSync } from 'node:fs';
import { 管理日常会话 } from './开发工具/日常命令行会话.mjs';
const fd = Number(process.argv[1]);
const record = event => writeSync(fd, JSON.stringify(event) + '\n');
const guarded = process.argv[2] === 'guarded';
if (guarded) for (const stream of [process.stdout, process.stderr])
  stream.on('error', error => record({ event: 'terminal-output-error', code: error.code }));
process.on('uncaughtExceptionMonitor', error => record({ event: 'uncaught', code: error.code, stack: error.stack }));
process.on('exit', code => record({ event: 'exit', code }));
const server = createServer((request, response) => response.end('synthetic'));
server.listen(0, '127.0.0.1', () => record({ event: 'ready', pid: process.pid }));
// 专用于本诊断的正常收尾，不是正式服务控制接口。
process.on('SIGUSR1', () => { record({ event: 'synthetic-cleanup' }); server.close(() => process.exit(0)); });
管理日常会话({ close: () => new Promise(resolve => server.close(resolve)) }, {
  input: process.stdin, emit: event => { record({ event: 'cli', phase: event.phase }); console.log(JSON.stringify(event)); },
});
"""

    def session():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

    child = subprocess.Popen(
        ['/opt/homebrew/bin/node', '--input-type=module', '-e', code,
         str(diagnostic_write), 'guarded' if guarded else 'original'],
        stdin=slave, stdout=slave, stderr=slave, pass_fds=(diagnostic_write,),
        preexec_fn=session, cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    )
    os.close(slave)
    os.close(diagnostic_write)
    events = os.read(diagnostic_read, 8192).decode()
    assert 'ready' in events
    os.close(master)
    time.sleep(3)
    survived = child.poll() is None
    if survived:
        child.send_signal(signal.SIGUSR1)
    code = child.wait(timeout=5)
    events += os.read(diagnostic_read, 16384).decode()
    os.close(diagnostic_read)
    values = [json.loads(line) for line in events.splitlines()]
    return dict(guarded=guarded, survivedThreeSeconds=survived, exitCode=code, events=values)


results = [check(False), check(True)]
assert results[0]['exitCode'] == 1
assert any(event.get('code') == 'EIO' and event['event'] == 'uncaught' for event in results[0]['events'])
assert results[1]['exitCode'] == 0
assert not any(event['event'] == 'uncaught' for event in results[1]['events'])
assert any(event.get('code') == 'EIO' and event['event'] == 'terminal-output-error' for event in results[1]['events'])
print(json.dumps(dict(passed=True, syntheticOnly=True, openedWorkspace=False, accessedKeychain=False,
                     historicalPIDCauseProven=False, results=results), ensure_ascii=False))
