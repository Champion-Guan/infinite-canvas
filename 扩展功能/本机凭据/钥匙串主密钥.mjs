import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { StorageError, requireValue, validHash, validUUID } from '../本机存储/协议.mjs';

function checkedHelper(path, expected) {
  requireValue(typeof path === 'string' && isAbsolute(path) && validHash(expected), 'invalid_keychain_helper', '必须提供已核验的本机凭据助手。');
  const stat = lstatSync(path), parent = lstatSync(dirname(path));
  requireValue(!stat.isSymbolicLink() && stat.isFile() && stat.nlink === 1 && stat.uid === process.getuid() && (stat.mode & 0o022) === 0 && (stat.mode & 0o100) &&
    !parent.isSymbolicLink() && parent.isDirectory() && parent.uid === process.getuid() && (parent.mode & 0o022) === 0, 'invalid_keychain_helper', '凭据助手或目录权限不安全。');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const current = fstatSync(fd);
    requireValue(current.ino === stat.ino && current.dev === stat.dev && current.size <= 16 * 1024 * 1024 &&
      createHash('sha256').update(readFileSync(fd)).digest('hex') === expected, 'invalid_keychain_helper', '凭据助手指纹不匹配。');
  } finally { closeSync(fd); }
  return realpathSync(path);
}

// 仅通过stdin/stdout传递内部材料，不把密钥放argv、环境变量、文件、日志或shell命令。
// 不调用security命令，不列举现有Keychain；助手只能读取本工作区的固定service/account。
export function createMacOSMasterKeyProvider({ helperPath, helperSHA256, spawnImpl = spawn } = {}) {
  requireValue(process.platform === 'darwin' && typeof spawnImpl === 'function', 'keychain_unavailable', '本凭据端口仅支持macOS。', 503);
  let flight = null;
  async function request(operation, workspaceId) {
    requireValue(validUUID(workspaceId), 'invalid_credential_config', '凭据工作区身份无效。');
    requireValue(!flight, 'keychain_busy', '系统凭据操作尚未结束。', 409);
    let executable;
    try { executable = checkedHelper(helperPath, helperSHA256); }
    catch { throw new StorageError('invalid_keychain_helper', '凭据助手缺失、权限或指纹不匹配；没有执行。', 503); }
    const task = new Promise((resolve, reject) => {
      let child, timer, size = 0, done = false; const chunks = [];
      const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); for (const chunk of chunks) chunk.fill(0); if (error) reject(error); else resolve(value); };
      const fail = () => {
        try { if (!done) child?.kill(); } catch { /* 子进程已结束同样拒绝，不回显系统错误。 */ }
        finish(new StorageError('keychain_unavailable', '系统钥匙串不可用、已锁定或拒绝访问；没有重新生成或明文降级。', 503));
      };
      try {
        child = spawnImpl(executable, [], { stdio: ['pipe', 'pipe', 'ignore'], env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' }, shell: false });
        timer = setTimeout(() => { child.kill(); fail(); }, 8000);
        child.on('error', fail); child.stdin.on('error', fail); child.stdout.on('error', fail);
        child.stdout.on('data', bytes => { size += bytes.length; if (size > 1024) { child.kill(); fail(); } else chunks.push(bytes); });
        child.on('close', code => {
          if (done) return;
          if (code !== 0) { fail(); return; }
          let value;
          const output = Buffer.concat(chunks);
          try { value = JSON.parse(output.toString('utf8')); } catch { fail(); return; }
          finally { output.fill(0); }
          if (Object.keys(value ?? {}).sort().join(',') !== 'material,protocol,workspaceId' || value.protocol !== 'guan-keychain-master.v1' || value.workspaceId !== workspaceId ||
            typeof value.material !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value.material)) { fail(); return; }
          const material = Buffer.from(value.material, 'base64');
          if (material.length !== 32 || material.toString('base64') !== value.material) { material.fill(0); fail(); return; }
          value.material = ''; finish(null, material);
        });
        child.stdin.end(JSON.stringify({ protocol: 'guan-keychain-master.v1', operation, workspaceId }));
      } catch { child?.kill(); fail(); }
    });
    flight = task;
    try { return await task; } finally { flight = null; }
  }
  return Object.freeze({ read: workspaceId => request('read', workspaceId), create: workspaceId => request('create', workspaceId) });
}
