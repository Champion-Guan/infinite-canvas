import { constants, closeSync, existsSync, fstatSync, ftruncateSync, lstatSync, openSync, readSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { Writable } from 'node:stream';

export const 日志限制 = Object.freeze({ maxBytes: 2 * 1024 * 1024, files: 3 });
function stat(file) {
  try {
    const value = lstatSync(file);
    if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1 || value.uid !== process.getuid()) throw Error('运行日志文件身份异常');
    return value;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// 只限制保留体积；写满即轮换，持续记录新日志。文件故障恢复后下次写入自动恢复。
export function 创建有界运行日志(file, { maxBytes = 日志限制.maxBytes, files = 日志限制.files } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(files) || files < 1 || files > 10) throw Error('日志限制无效');
  let disabled = false, dropped = 0;
  function normalize() {
    for (let i = 0; i < files; i++) {
      const name = i ? file + '.' + i : file, info = stat(name);
      if (info && info.size > maxBytes) {
        const fd = openSync(name, constants.O_RDWR | constants.O_NOFOLLOW);
        try {
          const opened = fstatSync(fd);
          if (opened.ino !== info.ino || opened.dev !== info.dev || opened.nlink !== 1) throw Error('日志身份变化');
          // 旧版超大日志也归限，同时保留最新尾部，方便排查此前故障。
          const tail = Buffer.alloc(maxBytes);
          const length = readSync(fd, tail, 0, maxBytes, opened.size - maxBytes);
          ftruncateSync(fd, 0); writeSync(fd, tail, 0, length, 0);
        } finally { closeSync(fd); }
      }
    }
  }
  try { normalize(); } catch { disabled = true; }
  function rotate() {
    for (let i = 0; i < files; i++) stat(i ? file + '.' + i : file);
    const oldest = files === 1 ? file : file + '.' + (files - 1);
    if (existsSync(oldest)) unlinkSync(oldest);
    for (let i = files - 2; i >= 0; i--) {
      const source = i ? file + '.' + i : file;
      if (existsSync(source)) renameSync(source, file + '.' + (i + 1));
    }
  }
  return Object.freeze({
    write(value) {
      let bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value)), offset = 0;
      // 单次超大输出也只需写入最后一个轮换窗口，最终保留内容与逐字轮换一致。
      if (bytes.length > maxBytes * files) { dropped += bytes.length - maxBytes * files; bytes = bytes.subarray(-maxBytes * files); }
      try {
        if (disabled) normalize();
        while (offset < bytes.length) {
          if ((stat(file)?.size ?? 0) >= maxBytes) rotate();
          const fd = openSync(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
          try {
            const info = fstatSync(fd);
            if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() || info.size >= maxBytes) throw Error('日志身份变化');
            const length = Math.min(bytes.length - offset, maxBytes - info.size);
            const count = writeSync(fd, bytes, offset, length);
            if (count < 1) throw Error('日志写入失败');
            offset += count;
          } finally { closeSync(fd); }
        }
        disabled = false;
      } catch { disabled = true; dropped += bytes.length - offset; }
    },
    getStatus: () => ({ disabled, droppedBytes: dropped, maxTotalBytes: maxBytes * files }),
  });
}

export function 创建有界日志流(file, options) {
  const log = 创建有界运行日志(file, options);
  return new Writable({ write(chunk, _encoding, done) { log.write(chunk); done(); } });
}
