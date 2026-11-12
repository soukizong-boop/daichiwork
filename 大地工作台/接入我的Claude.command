#!/bin/zsh
# 双击：把这台电脑上你自己的 Claude Code 接到大地工作台。装四样：到工作台的连接、五个钩子（开对话・每句话前・每次答完・对话结束・压缩前）、后台定时（每分钟取提醒、每 15 分钟备份记忆和规则）、存档命令。
# 原来的 Claude 设置会先备份成 settings.json.before-dadi。再双击一次＝重装。卸载：在终端运行  node client/install.mjs --uninstall
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
PORT=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync("config.json","utf8")).port||8850)}catch(e){console.log(8850)}')
KEYFILE="$HOME/Library/Application Support/dadi-workbench/brain/owner.key"
if ! curl -sf -m 2 -o /dev/null "http://127.0.0.1:$PORT/"; then echo "大地工作台没有在运行。先双击「启动大地工作台.command」。"; read -k 1; exit 1; fi
if [[ ! -f "$KEYFILE" ]]; then echo "找不到你的钥匙：$KEYFILE（工作台启动一次后会自动生成）"; read -k 1; exit 1; fi
node client/install.mjs "http://127.0.0.1:$PORT" "$(cat "$KEYFILE")"
echo; print -r -- '按任意键关闭'; read -k 1
