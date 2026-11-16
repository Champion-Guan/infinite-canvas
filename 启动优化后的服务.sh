#!/bin/bash

# 优化后的工作台服务启动脚本
# 此脚本启动修改后的存储层代码

cd /Users/guanchengbin/CodexProjects/生图工作台/Guan二次开发

echo "========================================="
echo "生图工作台 - 优化版本"
echo "========================================="
echo ""
echo "修改项："
echo "✅ 取消 400ms 延迟 → 即时保存"
echo "✅ 禁用分片机制 → 1GB 文档支持"
echo "✅ 移除队列限制 → 无限并发"
echo "✅ 自动重试机制 → 失败自动恢复"
echo ""
echo "========================================="
echo ""

# 尝试使用现有的运行包启动
if [ -d ".运行/SQLite日常准备-UWriM2" ]; then
    echo "检测到运行包：.运行/SQLite日常准备-UWriM2"
    echo ""
    echo "启动服务..."
    echo ""

    # 以后台模式运行，输出到日志
    nohup node 开发工具/日常工作台命令.mjs \
        --启动 \
        --运行包=.运行/SQLite日常准备-UWriM2/准备清单.json \
        --清单指纹=a44877449e31671952933ddd7a1b5e1f3acaa12aa7479a6395d4aa94d104b1ed \
        --已保存并关闭 \
        > .运行/启动服务.log 2>&1 &

    PID=$!
    echo "服务进程 PID: $PID"
    echo ""
    echo "等待服务启动..."
    sleep 3

    # 检查服务是否运行
    if ps -p $PID > /dev/null; then
        echo "✅ 服务已启动"
        echo ""
        echo "访问地址: http://localhost:3100"
        echo "日志文件: .运行/启动服务.log"
        echo ""
        echo "查看实时日志: tail -f .运行/启动服务.log"
    else
        echo "❌ 服务启动失败"
        echo ""
        echo "检查日志："
        tail -50 .运行/启动服务.log
        exit 1
    fi
else
    echo "❌ 找不到运行包"
    echo "需要先准备运行包："
    echo "  node 开发工具/日常工作台命令.mjs --准备"
    exit 1
fi
