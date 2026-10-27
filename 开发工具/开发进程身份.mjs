import { execFileSync } from 'node:child_process';

// Finder通常没有UTF-8语言环境；固定ps输出，避免中文路径被M-转义后误判身份。
export function 读取开发进程身份(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw Error('开发进程PID无效');
  const read = field => execFileSync('/bin/ps', ['-p', String(pid), '-o', field + '='], {
    encoding: 'utf8', env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } }).trim();
  return { command: read('command'), started: read('lstart') };
}
