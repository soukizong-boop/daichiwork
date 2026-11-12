#!/bin/zsh
# 双击运行：先跑纯函数单元测试，再用替身 Claude Code＋无头 Chrome 跑一遍页面主流程（约 30 秒）
cd "$(dirname "$0")"
export PATH="$HOME/.local/node/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
node --test --test-force-exit test/*.test.mjs
echo
echo "完成。关掉这个窗口即可。"
