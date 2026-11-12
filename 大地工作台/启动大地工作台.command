#!/bin/zsh
# 双击这个文件启动大地工作台。关掉弹出的终端窗口，工作台就停了。
# 如果已经装了后台服务（或别的窗口已经在跑），这里只打开页面，不再另起一个。
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
if ! command -v node >/dev/null; then echo "这台电脑上找不到 node，工作台启动不了。"; read -k 1; exit 1; fi
PORT="$(node -p 'try{Number(JSON.parse(require("fs").readFileSync("config.json","utf8")).port)||8850}catch(e){8850}' 2>/dev/null)"; [[ "$PORT" =~ ^[0-9]+$ ]] || PORT=8850   # 端口跟 config.json 走
URL="http://127.0.0.1:$PORT/"
if curl -sf -m 1 -o /dev/null "$URL"; then echo "工作台已经在运行，直接打开页面。"; open "$URL"; exit 0; fi
( sleep 1.5; open "$URL" ) &
exec node server.mjs
