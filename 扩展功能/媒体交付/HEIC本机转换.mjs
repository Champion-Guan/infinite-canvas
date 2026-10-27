import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, lstat, rm, readFile, writeFile, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageError, requireValue } from '../本机存储/协议.mjs';
import { HEIC_MAX_BYTES, heicMime } from './HEIC格式识别.mjs';

const run = promisify(execFile), prefix = 'ai-workbench-heic-', MAX_PIXELS = 80_000_000;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
const fail = () => new StorageError('heic_decode_failed', '无法读取这张 HEIC/HEIF 图片，请确认原文件完整后重试。其他保存不受影响。');

// 不接收用户路径或命令；系统临时目录中最多处理一张，其余请求在内存中有界排队。
export function createHeicConverter({ directory = tmpdir(), platform = process.platform, execute = run, inspectDisk = statfs } = {}) {
  let tail = Promise.resolve(), pending = 0;
  const cleanup = (async () => {
    for (const name of await readdir(directory)) {
      const match = name.match(/^ai-workbench-heic-(\d+)-[A-Za-z0-9]+$/);
      if (!match || alive(Number(match[1]))) continue;
      const path = join(directory, name), stat = await lstat(path).catch(() => null);
      if (stat?.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.()) await rm(path, { recursive: true, force: true });
    }
  })();
  async function convert(bytes, { signal } = {}) {
    requireValue(platform === 'darwin', 'heic_unavailable', '当前系统尚未提供 HEIC 转换服务，请在 macOS 工作台中导入。', 501);
    requireValue(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= HEIC_MAX_BYTES && heicMime(bytes.subarray(0, 4096)), 'invalid_heic', 'HEIC/HEIF 文件格式不正确、为空或超过 32MB。');
    signal?.throwIfAborted();
    await cleanup;
    const disk = await inspectDisk(directory);
    requireValue(disk.bavail * disk.bsize >= 1024 ** 3 + 2 * HEIC_MAX_BYTES, 'heic_disk_full', '磁盘空间不足，无法转换 HEIC。请释放空间后重试；原文件未修改。', 507);
    const temporary = await mkdtemp(join(directory, prefix + process.pid + '-'));
    const source = join(temporary, '原图.heic'), output = join(temporary, '兼容图片.jpg');
    try {
      await writeFile(source, bytes, { mode: 0o600, flag: 'wx', signal });
      const probe = await execute('/usr/bin/sips', ['-g', 'format', '-g', 'pixelWidth', '-g', 'pixelHeight', source], { signal, timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 8192 });
      const format = probe.stdout.match(/\bformat:\s*(\w+)/)?.[1];
      const width = Number(probe.stdout.match(/\bpixelWidth:\s*(\d+)/)?.[1]), height = Number(probe.stdout.match(/\bpixelHeight:\s*(\d+)/)?.[1]);
      requireValue(['heic', 'heif'].includes(format) && width > 0 && height > 0 && width * height <= MAX_PIXELS, 'heic_dimensions_invalid', 'HEIC 图片无法解码或像素数超过 8000 万，请使用较小的原图。');
      const guard = new AbortController();
      const timer = setInterval(async () => {
        const stat = await lstat(output).catch(() => null);
        if (stat && stat.size > HEIC_MAX_BYTES) guard.abort();
      }, 100);
      timer.unref();
      try {
        await execute('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '95', source, '--out', output], { signal: AbortSignal.any([guard.signal, ...(signal ? [signal] : [])]), timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 8192 });
      } finally { clearInterval(timer); }
      const stat = await lstat(output);
      requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= HEIC_MAX_BYTES, 'heic_result_large', 'HEIC 转换结果超过 32MB，请使用较小的原图。');
      const result = await readFile(output, { signal });
      requireValue(result[0] === 0xff && result[1] === 0xd8 && result[2] === 0xff, 'heic_result_invalid', 'HEIC 转换没有返回有效的 JPEG 图片。');
      signal?.throwIfAborted();
      return result;
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof StorageError) throw error;
      throw fail();
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }
  return Object.freeze({
    convert(bytes, options = {}) {
      requireValue(pending < 4, 'heic_busy', '正在处理多张 HEIC 图片，请稍后再上传。', 503);
      pending++;
      const task = tail.then(() => convert(bytes, options)).finally(() => { pending--; });
      tail = task.catch(() => {});
      return task;
    },
    async close() { await tail; },
  });
}
