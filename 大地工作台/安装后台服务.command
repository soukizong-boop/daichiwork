#!/bin/zsh
# 双击这个文件：把大地工作台装成 macOS 后台服务（launchd 用户代理）。
# 装好以后开机自动启动、没有终端窗口、意外退出会自动拉起。再双击一次＝重装并重启。
# 要停掉／卸载，双击「卸载后台服务.command」。日志在 ~/Library/Application Support/dadi-workbench/log/service.log。
cd "$(dirname "$0")" || exit 1
APP="$PWD"
LABEL="ai.alaco.dadi-workbench"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DATA="$HOME/Library/Application Support/dadi-workbench"
LOG="$DATA/log/service.log"
PATHS="$HOME/.local/bin:$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
bye() { print -r -- '按任意键关闭'; read -k 1; exit "${1:-0}"; }

# 找 node：优先 ~/.local/node，其次 PATH 里的
export PATH="$PATHS:/usr/sbin:/sbin"
if [[ -x "$HOME/.local/node/bin/node" ]]; then NODE="$HOME/.local/node/bin/node"; else NODE="$(command -v node)"; fi
if [[ -z "$NODE" ]]; then echo "这台电脑上找不到 node，装不了后台服务。"; bye 1; fi
PORT="$("$NODE" -p 'try{Number(JSON.parse(require("fs").readFileSync("config.json","utf8")).port)||8850}catch(e){8850}' 2>/dev/null)"; [[ "$PORT" =~ ^[0-9]+$ ]] || PORT=8850   # 端口跟 config.json 走
URL="http://127.0.0.1:$PORT/"

# plist 是 XML：路径里要是有 & < > 得转义（中文不用）
esc() { local s="$1"; s="${s//\&/&amp;}"; s="${s//\</&lt;}"; s="${s//\>/&gt;}"; print -r -- "$s"; }
XML="<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
	<key>Label</key>
	<string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>$(esc "$NODE")</string>
		<string>$(esc "$APP/server.mjs")</string>
	</array>
	<key>WorkingDirectory</key>
	<string>$(esc "$APP")</string>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>$(esc "$PATHS")</string>
		<key>HOME</key>
		<string>$(esc "$HOME")</string>
		<key>LANG</key>
		<string>en_US.UTF-8</string>
	</dict>
	<key>StandardOutPath</key>
	<string>$(esc "$LOG")</string>
	<key>StandardErrorPath</key>
	<string>$(esc "$LOG")</string>
</dict>
</plist>"

# DADI_DRY_RUN=1：只把 plist 打印出来看，不写文件、不装服务
if [[ "$DADI_DRY_RUN" == "1" ]]; then print -r -- "$XML"; exit 0; fi

# 工作台正由双击打开的终端窗口在跑（不是后台服务）：先让他关掉，不然端口占着服务起不来
if curl -sf -m 1 -o /dev/null "${URL}" && ! launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  echo "工作台现在正由一个终端窗口在跑。请先关掉那个「启动大地工作台」的窗口，再双击本文件。"
  bye 1
fi

mkdir -p "$DATA/log" "$HOME/Library/LaunchAgents" && chmod 700 "$DATA" || { echo "建不了日志文件夹。"; bye 1; }
print -r -- "$XML" > "$PLIST" || { echo "写不了 $PLIST"; bye 1; }
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
for i in {1..20}; do curl -sf -m 1 -o /dev/null "$URL" || break; sleep 0.5; done   # 等旧进程把端口让出来，不然新进程一起来就撞上 EADDRINUSE
launchctl enable "gui/$(id -u)/$LABEL" 2>/dev/null   # 以前在「登录项」里被关掉过的话先重新启用，不然 bootstrap 报 119
if ! launchctl bootstrap "gui/$(id -u)" "$PLIST"; then echo "装不上后台服务（launchctl 报错，见上一行）。"; bye 1; fi

# 等它起来（最多 10 秒）
up=0
for i in {1..20}; do
  if curl -sf -m 1 -o /dev/null "${URL}"; then up=1; break; fi
  sleep 0.5
done
if (( up )); then
  echo "后台服务已启动：$URL"
  echo "以后开机会自动启动，不会弹终端窗口。要停掉／卸载，双击「卸载后台服务.command」。"
  open "$URL"
else
  echo "后台服务装上了，但 10 秒内没有响应。日志最后 20 行（$LOG）："
  echo "----------"
  last="$(tail -n 20 "$LOG" 2>/dev/null)"; print -r -- "${last:-（还没有日志）}"
  echo "----------"
  # 后台起的 node 没有终端的「桌面」访问授权，被 macOS 拦住时日志里是 EPERM
  if print -r -- "$last" | grep -qiE 'EPERM|not permitted'; then
    echo "看起来是 macOS 没让 node 读桌面上的文件：到 系统设置 > 隐私与安全性 > 文件和文件夹（或 完全磁盘访问权限）给 node 放行。放行后服务会自动重试，不用重装。"
  fi
fi
bye 0
