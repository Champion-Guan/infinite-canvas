#!/bin/sh
set -eu
WORKBENCH_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
for WORKBENCH_NODE in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null || true)"; do
  if [ -x "$WORKBENCH_NODE" ] && "$WORKBENCH_NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' 2>/dev/null; then
    exec "$WORKBENCH_NODE" "$WORKBENCH_ROOT/开发工具/修复桌面入口.mjs"
  fi
done
printf '%s\n' '未找到Node.js 24或更新版本，桌面入口未修改。' >&2
exit 1
