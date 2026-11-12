#!/bin/zsh
# 在 Mac mini 上双击：把数据放到位，再把大地工作台装成开机自启的后台服务。已经有数据就不覆盖。
cd "$(dirname "$0")" || exit 1
DATA="$HOME/Library/Application Support/dadi-workbench"
if [[ -d "$DATA/brain" ]]; then echo "这台机器上已经有协作数据，没有覆盖：$DATA/brain"
else mkdir -p "$DATA" && cp -R data/brain "$DATA/" && { [[ -f data/templates.json ]] && cp data/templates.json "$DATA/"; true; } && chmod -R go-rwx "$DATA" && echo "数据已放到：$DATA"; fi
DEST="$HOME/大地工作台"
if [[ ! -d "$DEST" ]]; then cp -R 大地工作台 "$DEST" && echo "程序已放到：$DEST"; else echo "程序文件夹已经在：$DEST（没有覆盖；要更新就先把它改名再双击）"; fi
exec /bin/zsh "$DEST/安装后台服务.command"
