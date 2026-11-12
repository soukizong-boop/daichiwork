#!/bin/zsh
# 双击这个文件：停掉大地工作台的后台服务，并取消开机自启。
LABEL="ai.alaco.dadi-workbench"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null; then echo "后台服务已停止。"; else echo "后台服务本来就没在运行。"; fi
if [[ -f "$PLIST" ]]; then
  if rm -f "$PLIST"; then echo "已取消开机自启（删除了 $PLIST）。"; else echo "删不掉 $PLIST，请手动删除。"; fi
else
  echo "没有找到开机自启配置，可能已经卸载过了。"
fi
echo "卸载完成。要再用：双击「启动大地工作台.command」（手动开一次）或「安装后台服务.command」（重新装成后台服务）。"
print -r -- '按任意键关闭'; read -k 1
