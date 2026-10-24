"""按当前源码映射导出可审阅源码；不读取运行数据，不上传，不生成安装包。"""
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import subprocess
import tempfile
import zipfile

根 = Path(__file__).resolve().parent.parent


def 摘要(data):
    return hashlib.sha256(data).hexdigest()


def 安全路径(name):
    path = PurePosixPath(name)
    assert not path.is_absolute() and str(path) == name
    assert not any(p in ("..", ".运行", "node_modules", ".git", "验收记录") for p in path.parts)
    assert not any(p.startswith(".env") for p in path.parts)
    assert path.suffix.lower() not in (".sqlite", ".db", ".key", ".pem", ".xlsx", ".zip")
    return path


def 读取来源(name):
    path = 安全路径(name)
    file = 根
    for part in path.parts:
        file = file / part
        assert not file.is_symlink(), "源码候选禁止软链接：" + name
    assert file.is_file(), "缺少源码：" + name
    return file.read_bytes()


def 验证候选(file):
    with zipfile.ZipFile(file) as archive:
        names = archive.namelist()
        assert len(names) == len(set(names)), "候选包含重复文件"
        manifest = json.loads(archive.read("候选清单.json"))
        assert manifest["用途"] == "源码审阅" and manifest["允许自动安装"] is False
        expected = manifest["文件SHA256"]
        assert set(names) == set(expected) | {"候选清单.json"}, "候选文件库存不一致"
        for info in archive.infolist():
            安全路径(info.filename)
            assert not stat.S_ISLNK(info.external_attr >> 16), "候选包含软链接"
            if info.filename in expected:
                assert 摘要(archive.read(info)) == expected[info.filename], "候选文件摘要不一致"
        return manifest


def 准备候选():
    subprocess.run(["node", "开发工具/检查目录归并.mjs"], cwd=根, check=True, capture_output=True)
    mapping = json.loads(读取来源("上游适配/开发源码映射.json"))
    state = json.loads((根 / ".运行/开发版3100/源码装配.json").read_text())
    files = {}
    for item in mapping["文件"]:
        data = 读取来源(item["来源"])
        assert 摘要(data) == item["SHA256"], "来源与映射不一致：" + item["来源"]
        files[item["来源"]] = data
    for item in mapping["接入补丁"]:
        data = 读取来源(item["文件"])
        assert 摘要(data) == item["SHA256"], "接入补丁与映射不一致"
        files[item["文件"]] = data
    for name in ["上游适配/开发源码映射.json", "上游基线.json", "package.json", "pnpm-lock.yaml",
                 "开发工具/装配开发源码.mjs", "开发工具/检查目录归并.mjs", "开发工具/维护接入补丁.py",
                 "开发工具/准备Web源码候选.py", "开发文档/Web预发布推进.md",
                 "开发文档/目录归并与功能定位.md", "开发文档/Web客户安装与升级.md", "开发文档/Web发布版本.json",
                 "开发工具/构建Web客户包.mjs", "开发工具/签名Web客户包.mjs", "开发工具/发布Web预览版.mjs",
                 "开发工具/Web发布源码核对.mjs", "开发工具/Web客户更新边界.test.mjs", "开发工具/生成网关隔离夹具.mjs",
                 "开发工具/Web前端依赖.json", "开发工具/Web前端依赖锁.json", "开发工具/Web运行依赖.json", "开发工具/Web运行依赖锁.json"]:
        files[name] = 读取来源(name)
    # 只补充当前边界回归源码；不复制历史证据、工作簿、数据库或整个开发工具目录。
    package = json.loads(files["package.json"])
    for name in package["scripts"]["test:boundaries"].split()[2:]:
        assert name.startswith("开发工具/") and name.endswith(".test.mjs")
        files[name] = 读取来源(name)
    baseline = json.loads(files["上游基线.json"])
    assert mapping["基线"] == baseline["提交"]
    files["上游许可.txt"] = subprocess.check_output(
        ["git", "show", baseline["提交"] + ":LICENSE"], cwd=根 / baseline["目录"])
    files["候选说明.md"] = (
        "# Web工作台源码审阅候选\n\n"
        "这是当前根业务、单功能接入补丁及边界回归的源码清单，供GitHub迁入审阅。\n"
        "不包含私人运行数据、node_modules、官方Node运行时或已安装原生助手。\n"
        "不是可安装更新包。包含Web客户构建、锁定依赖和更新边界检查；根package.json是本机开发历史脚本，迁入时应合并Web专用入口，不覆盖旧Stable脚本。\n"
        "构建从锁定作者Git提交重放小补丁；运行要求和验证边界详见开发文档/Web客户安装与升级.md。\n"
        "本候选没有签名，不交给现有Stable安装器，不自动迁移旧数据。\n"
    ).encode()
    inventory = {name: 摘要(data) for name, data in sorted(files.items())}
    manifest = {
        "用途": "源码审阅", "允许自动安装": False, "已上传GitHub": False,
        "指定目标": "Champion-Guan/infinite-canvas",
        "作者基线": baseline["提交"], "作者仓库": baseline["仓库"],
        "源码装配指纹": state["指纹"], "独立根来源": len({i["来源"] for i in mapping["文件"]}),
        "顺序接入补丁": len(mapping["接入补丁"]), "文件SHA256": inventory,
    }
    files["候选清单.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode()
    parent = 根 / ".运行/发布候选"
    parent.mkdir(parents=True, exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix="Web源码-", dir=parent))
    source = output / "白名单源码"
    for name, data in files.items():
        path = source / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    archive_path = output / "Web工作台源码候选.zip"
    with zipfile.ZipFile(archive_path, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 23, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    验证候选(archive_path)
    receipt = {"源码目录": str(source.relative_to(根)), "压缩包": str(archive_path.relative_to(根)),
               "SHA256": 摘要(archive_path.read_bytes()), "文件": len(files),
               "源码装配指纹": state["指纹"], "可安装更新": False}
    (output / "准备结果.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    return receipt


if __name__ == "__main__":
    import sys
    assert len(sys.argv) == 1, "本工具只在本地准备源码候选，不接受远程发布参数"
    print(json.dumps(准备候选(), ensure_ascii=False, indent=2))
