#!/usr/bin/env python3
"""仅回退本次连线代码。默认预览；有后续变更时整体拒绝，不触碰业务数据。"""
from pathlib import Path
import argparse
import hashlib
import json
import zipfile


def sha(data):
    return hashlib.sha256(data).hexdigest()


def scoped(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError(f"路径超出项目：{relative}")
    return path


def plan_rollback(root, manifest):
    writes, deletes, conflicts = {}, [], []
    with zipfile.ZipFile(scoped(root, manifest['回退包'])) as archive:
        if sha(scoped(root, manifest['回退包']).read_bytes()) != manifest['回退包SHA256']:
            raise ValueError('回退包校验失败')
        for item in manifest['已有文件']:
            path = scoped(root, item['路径'])
            before = archive.read(item['路径'])
            if sha(before) != item['前态SHA256']:
                conflicts.append(item['路径'] + '：前态校验失败')
            elif not path.is_file() or sha(path.read_bytes()) != item['后态SHA256']:
                conflicts.append(item['路径'] + '：已有后续修改或缺失')
            else:
                writes[path] = before
        for item in manifest['新增文件']:
            path = scoped(root, item['路径'])
            if not path.is_file() or sha(path.read_bytes()) != item['SHA256']:
                conflicts.append(item['路径'] + '：已有后续修改或缺失')
            else:
                deletes.append(path)
    mapping_path = scoped(root, manifest['映射路径'])
    mapping = json.loads(mapping_path.read_text())
    for item in manifest['映射逆向条目']:
        rows = mapping[item['类别']]
        keys = item['键']
        indices = [i for i, row in enumerate(rows) if [row.get(key) for key in keys] == item['标识']]
        if len(indices) != 1 or rows[indices[0]] != item['后态']:
            conflicts.append('映射条目已有后续修改：' + ' → '.join(item['标识']))
        elif item['前态'] is None:
            rows.pop(indices[0])
        else:
            rows[indices[0]] = item['前态']
    writes[mapping_path] = (json.dumps(mapping, ensure_ascii=False, indent=2) + '\n').encode()
    if conflicts:
        raise ValueError('回退未执行：\n' + '\n'.join(conflicts))
    return writes, deletes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--执行', action='store_true', help='哈希检查通过后恢复本次代码')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / '开发文档/连线系统迁移20261026/回退清单.json').read_text())
    try:
        writes, deletes = plan_rollback(root, manifest)
    except (ValueError, OSError, KeyError, zipfile.BadZipFile) as error:
        parser.exit(1, str(error) + '\n')
    print(json.dumps({'模式': '执行' if args.执行 else '只预览', '恢复文件': [str(p.relative_to(root)) for p in writes], '移除本次新增代码': [str(p.relative_to(root)) for p in deletes], '业务数据': '不操作', '源码映射': '仅逆向本次条目，保留其他条目'}, ensure_ascii=False, indent=2))
    if not args.执行:
        return
    # 所有冲突已在写入前检查；不回滚整个工作区或整个映射。
    for path, data in writes.items():
        path.write_bytes(data)
    for path in deletes:
        path.unlink()
    print('已恢复本次连线迁移前代码；请运行 npm run dev:assemble 与 npm run dev:check-source。')


if __name__ == '__main__':
    main()
