"""只合并清单内完全相同文件的 APFS 数据块，不删除备份或使用硬链接。"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import time
import uuid


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def regular(path):
    info = path.lstat()
    assert stat.S_ISREG(info.st_mode) and info.st_nlink == 1
    assert info.st_uid == os.getuid() and info.st_mode & 0o022 == 0
    assert not getattr(info, 'st_flags', 0) & 0x40000000, '跳过尚未下载的文件'
    return info


def identity(info):
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns


def clone_replace(source, target, expected, clone):
    before = regular(target)
    assert digest(target) == expected, '目标摘要不符，未替换'
    source_before = regular(source)
    temporary = target.with_name('.去重暂存-' + str(uuid.uuid4()))
    try:
        result = clone(os.fsencode(source), os.fsencode(temporary), 0)
        if result != 0:
            raise OSError(ctypes.get_errno(), '文件系统克隆失败，原文件保留')
        copied = regular(temporary)
        assert copied.st_ino != source_before.st_ino
        assert digest(temporary) == expected, '克隆摘要不符，原文件保留'
        assert identity(regular(source)) == identity(source_before)
        assert identity(regular(target)) == identity(before)
        os.chmod(temporary, stat.S_IMODE(before.st_mode))
        os.utime(temporary, ns=(before.st_atime_ns, before.st_mtime_ns))
        with temporary.open('rb') as stream:
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        folder_fd = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(folder_fd)
        finally:
            os.close(folder_fd)
        assert regular(target).st_nlink == 1
    finally:
        if temporary.exists():
            temporary.unlink()


def collect(roots):
    groups, snapshots, workspace_id = {}, [], None
    for root in roots:
        assert root.is_absolute() and root.resolve() == root
        assert root.is_dir() and not root.is_symlink()
        marker = root / '.工作区.json'
        regular(marker)
        workspace = json.loads(marker.read_text())
        assert workspace['protocol'] == 'guan-local-data.v1'
        workspace_id = workspace_id or workspace['workspaceId']
        assert workspace['workspaceId'] == workspace_id, '不能跨工作区去重'
        folder = root / '备份'
        assert folder.is_dir() and not folder.is_symlink()
        for backup in sorted(folder.iterdir()):
            if not backup.is_dir() or backup.is_symlink():
                continue
            uuid.UUID(backup.name)
            manifest_path = backup / '清单.json'
            regular(manifest_path)
            manifest = json.loads(manifest_path.read_text())
            assert manifest['protocol'] == workspace['protocol']
            assert manifest['workspaceId'] == workspace_id and manifest['schemaVersion'] == 1
            paths = set()
            for item in manifest['files']:
                name, checksum, size = item['path'], item['hash'], item['size']
                assert name not in paths
                paths.add(name)
                assert len(checksum) == 64 and all(c in '0123456789abcdef' for c in checksum)
                assert name == '工作台.sqlite' or name == '媒体/' + checksum
                path = backup / name
                assert not path.parent.is_symlink()
                assert regular(path).st_size == size
                groups.setdefault((size, checksum), []).append(path)
            assert '工作台.sqlite' in paths
            snapshots.append((manifest_path, digest(manifest_path)))
    return groups, snapshots, workspace_id


def run(roots, apply=False, report=None):
    assert sys.platform == 'darwin', '仅在支持 clonefile 的 macOS 上执行'
    library = ctypes.CDLL('/usr/lib/libSystem.B.dylib', use_errno=True)
    clone = library.clonefile
    clone.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_int]
    clone.restype = ctypes.c_int
    groups, snapshots, workspace_id = collect(roots)
    before = os.statvfs(roots[0])
    result = {'at': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'workspaceId': workspace_id,
              'apply': apply, 'snapshots': len(snapshots), 'files': sum(map(len, groups.values())),
              'distinctContents': len(groups), 'replacedFiles': 0, 'verifiedFiles': 0,
              'roots': [str(p) for p in roots], 'groups': []}
    for (size, checksum), paths in groups.items():
        source = paths[0]
        original = regular(source)
        assert digest(source) == checksum, '源摘要不符，停止去重'
        assert identity(regular(source)) == identity(original)
        result['verifiedFiles'] += 1
        for target in paths[1:]:
            if apply:
                clone_replace(source, target, checksum, clone)
                result['replacedFiles'] += 1
            else:
                assert digest(target) == checksum, '摘要不符，停止检查'
            result['verifiedFiles'] += 1
        if len(paths) > 1:
            result['groups'].append({'hash': checksum, 'size': size, 'source': str(source),
                                     'copies': len(paths), 'targets': [str(p) for p in paths[1:]]})
        if result['verifiedFiles'] % 100 < len(paths):
            print(json.dumps({k: result[k] for k in ['verifiedFiles', 'replacedFiles', 'files']}, ensure_ascii=False), flush=True)
    for path, expected in snapshots:
        assert digest(path) == expected, '备份清单发生变化'
    after = os.statvfs(roots[0])
    result['freeBytesBefore'] = before.f_bavail * before.f_frsize
    result['freeBytesAfter'] = after.f_bavail * after.f_frsize
    result['freeBytesDelta'] = result['freeBytesAfter'] - result['freeBytesBefore']
    result['manifestsUnchanged'] = True
    if report:
        report.parent.mkdir(parents=True, exist_ok=True)
        with report.open('x') as stream:
            os.chmod(report, 0o600)
            json.dump(result, stream, ensure_ascii=False, indent=2)
    print(json.dumps({k: v for k, v in result.items() if k != 'groups'}, ensure_ascii=False, indent=2))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('roots', nargs='+', type=Path, help='含 .工作区.json 和备份目录的工作区')
    parser.add_argument('--执行', action='store_true')
    parser.add_argument('--报告', type=Path)
    args = parser.parse_args()
    run(args.roots, args.执行, args.报告)
