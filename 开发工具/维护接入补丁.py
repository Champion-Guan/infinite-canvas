"""按清单重放接入；导出单一功能差异，不直接维护运行副本。"""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
MAPPING = ROOT / '上游适配/开发源码映射.json'
def sha(data):
    return hashlib.sha256(data).hexdigest()
def save(mapping):
    temporary = MAPPING.with_name(MAPPING.name + '.临时')
    temporary.write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(MAPPING)
def replay(directory, mapping):
    baseline = json.loads((ROOT / '上游基线.json').read_text())
    for item in mapping['接入差异']:
        file = directory / item['目标']
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(subprocess.check_output(['git', 'show', baseline['提交'] + ':' + item['目标']], cwd=ROOT / baseline['目录']))
    for item in mapping['接入补丁']:
        patch = ROOT / item['文件']
        if 'SHA256' in item:
            assert sha(patch.read_bytes()) == item['SHA256'], '补丁指纹不一致：' + str(patch)
        if '前态SHA256' in item:
            assert sha((directory / item['目标']).read_bytes()) == item['前态SHA256'], '补丁前态不符：' + str(patch)
        subprocess.run(['git', 'apply', '--check', str(patch)], cwd=directory, check=True)
        subprocess.run(['git', 'apply', str(patch)], cwd=directory, check=True)
        if '后态SHA256' in item:
            assert sha((directory / item['目标']).read_bytes()) == item['后态SHA256'], '补丁后态不符：' + str(patch)
def main():
    mapping = json.loads(MAPPING.read_text())
    mode = sys.argv[1]
    if mode == '提取':
        with tempfile.TemporaryDirectory(prefix='画布补丁读取-') as temp:
            directory = Path(temp)
            replay(directory, mapping)
            Path(sys.argv[3]).write_bytes((directory / sys.argv[2]).read_bytes())
    elif mode == '导出':
        target, source, name = sys.argv[2:5]
        assert Path(target).as_posix() in {item['目标'] for item in mapping['接入差异']}
        assert '/' not in name and '\\' not in name and '..' not in name
        file = ROOT / '上游适配' / (name + '.patch')
        assert not file.exists(), '功能补丁已存在，请在原功能边界内修改，或使用明确的新修订名称'
        with tempfile.TemporaryDirectory(prefix='画布补丁导出-') as temp:
            directory = Path(temp)
            replay(directory, mapping)
            before = (directory / target).read_bytes()
            after = Path(source).read_bytes()
            for side, data in [('a', before), ('b', after)]:
                path = directory / side / target
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            result = subprocess.run(['git', '-c', 'core.quotepath=false', 'diff', '--no-index', '--no-prefix', '--', 'a/' + target, 'b/' + target], cwd=directory, stdout=subprocess.PIPE)
            assert result.returncode == 1, '没有变化或生成补丁失败'
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(result.stdout)
        mapping['接入补丁'].append({'文件': file.relative_to(ROOT).as_posix(), '目标': target, '职责': name, 'SHA256': sha(result.stdout), '前态SHA256': sha(before), '后态SHA256': sha(after)})
        save(mapping)
        print(file.relative_to(ROOT))
    else:
        raise ValueError('支持：提取 目标 临时文件；导出 目标 临时文件 中文功能名')
if __name__ == '__main__':
    main()
