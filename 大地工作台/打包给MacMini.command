#!/bin/zsh
# 双击：把公司用的那部分（程序＋协作数据＋模版）打成一个 zip 放到桌面，拿去 Mac mini 上装。个人的 Slack／邮件设置和后台登录不带走。
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.local/bin:$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
node tools/pack-mini.mjs
echo; echo 按任意键关闭; read -k 1
