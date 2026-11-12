#!/usr/bin/env node
// 打包给 Mac mini：把「公司用的那部分」做成一个 zip——程序＋协作数据（任务・经验・小结・报告・对话・各人的备份）＋模版。
// 不带走个人的东西：config.json 里你的 Slack／邮件设置、后台登录、Slack・邮件缓存、ask ala 的对话。Mac mini 上后台要重新登录一次。
// 用法：node tools/pack-mini.mjs   （或双击「打包给MacMini.command」）。DADI_PACK_OUT＝输出到哪个文件夹（默认桌面）。
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = process.env.DADI_DATA || path.join(os.homedir(), 'Library', 'Application Support', 'dadi-workbench');
const d = new Date(), day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const OUTDIR = process.env.DADI_PACK_OUT || path.join(os.homedir(), 'Desktop'), NAME = `大地工作台_MacMini包_${day}`, STAGE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dadi-pack-')), NAME);
if (!fs.existsSync(path.join(DATA, 'brain', 'people.json'))) { console.error('找不到协作数据：' + path.join(DATA, 'brain')); process.exit(1); }
const SKIP = new Set(['config.json', '.DS_Store', 'node_modules', '.git', 'build']);
fs.mkdirSync(STAGE, { recursive: true });
fs.cpSync(ROOT, path.join(STAGE, '大地工作台'), { recursive: true, filter: src => !SKIP.has(path.basename(src)) });
fs.writeFileSync(path.join(STAGE, '大地工作台', 'config.json'), JSON.stringify({ port: 8850, workdir: '~/Desktop', chrome: false, listen: [] }, null, 2) + '\n');
fs.mkdirSync(path.join(STAGE, 'data'), { recursive: true });
fs.cpSync(path.join(DATA, 'brain'), path.join(STAGE, 'data', 'brain'), { recursive: true, filter: src => path.basename(src) !== '.DS_Store' });
if (fs.existsSync(path.join(DATA, 'templates.json'))) fs.copyFileSync(path.join(DATA, 'templates.json'), path.join(STAGE, 'data', 'templates.json'));
fs.writeFileSync(path.join(STAGE, '在MacMini上第一次安装.command'), `#!/bin/zsh
# 在 Mac mini 上双击：把数据放到位，再把大地工作台装成开机自启的后台服务。已经有数据就不覆盖。
cd "$(dirname "$0")" || exit 1
DATA="$HOME/Library/Application Support/dadi-workbench"
if [[ -d "$DATA/brain" ]]; then echo "这台机器上已经有协作数据，没有覆盖：$DATA/brain"
else mkdir -p "$DATA" && cp -R data/brain "$DATA/" && { [[ -f data/templates.json ]] && cp data/templates.json "$DATA/"; true; } && chmod -R go-rwx "$DATA" && echo "数据已放到：$DATA"; fi
DEST="$HOME/大地工作台"
if [[ ! -d "$DEST" ]]; then cp -R 大地工作台 "$DEST" && echo "程序已放到：$DEST"; else echo "程序文件夹已经在：$DEST（没有覆盖；要更新就先把它改名再双击）"; fi
exec /bin/zsh "$DEST/安装后台服务.command"
`, { mode: 0o755 });
fs.writeFileSync(path.join(STAGE, 'MacMini搬家说明.md'), `# 大地工作台搬到 Mac mini

这个包里有：程序、协作数据（任务・经验・小结・交接报告・精简对话・各人的备份・每个人的钥匙）、模版。
**没有**：你个人的 Slack／邮件设置、网站后台的登录、ask ala。包里有钥匙和同事的资料：用 U 盘或隔空投送传给 Mac mini，传完把 zip 删掉。

## 在 Mac mini 上（一次）
1. 装 Node（https://nodejs.org 的 LTS 安装包）和 Tailscale（App Store），Tailscale 用公司账号登录。
2. 解压这个包，双击「在MacMini上第一次安装.command」。它把数据放到位、程序放到 ~/大地工作台、装成开机自启的后台服务。
3. 系统设置：电池／节能里关掉自动睡眠，打开「断电后自动启动」；用户与群组里设自动登录（后台服务要登录后才跑）。
4. 浏览器开 http://127.0.0.1:8850 → 菜单 → 后台 → 登录网站后台（规则要读后台数据）。
5. 让同事能连进来：Tailscale 里看这台的地址（100.x.x.x），写进 ~/大地工作台/config.json 的 "listen": ["100.x.x.x"]，再双击一次「安装后台服务.command」。
   只开放带钥匙的那几条路（任务・清单・交资料）；管理页面仍然只能在 Mac mini 本机打开。不要写 0.0.0.0。

## 每个人的电脑（各一次）
1. 装 Tailscale，用公司账号登录；装 Node；装 Claude Code 并登录（终端里 claude auth login）。
2. 在 Mac mini 的管理页「任务 → 管理 → 成员・分工」给他生成钥匙，页面上会给一行安装命令，把里面的 127.0.0.1 换成 Mac mini 的 Tailscale 地址，让他在终端里跑。
   已经接入过的人（比如你自己）：同样用新地址再跑一次那行命令，钥匙不变。
3. 装好后右上角出现「大地 N」。

## 你自己怎么看管理页
管理页只认 Mac mini 本机。两种办法：用「屏幕共享」连到 Mac mini；或在你的 Mac 终端里跑
\`ssh -L 8850:127.0.0.1:8850 <Mac mini 的用户名>@<Tailscale 地址>\`，然后浏览器开 http://127.0.0.1:8850（要先把你这台的工作台停掉，或者换个端口：-L 8851:127.0.0.1:8850）。

## 搬完以后
- 你这台 Mac 上的工作台可以继续开着给你自己用（ask ala、Slack、邮件），但任务和资料以 Mac mini 为准：你这台的「接入」要用 Mac mini 的地址重装一次。
- Mac mini 上的派活智能体、每周自动写改进清单要用公司的 API key，不能用个人订阅。没配之前，这两件由你对自己的 Claude 说一句来做。
- 备份：Mac mini 接一块外接硬盘开「时间机器」；数据在 ~/Library/Application Support/dadi-workbench。
`);
const zip = path.join(OUTDIR, NAME + '.zip'); fs.rmSync(zip, { force: true });
execFileSync('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--keepParent', STAGE, zip]);
const n = j => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'brain', j + '.json'), 'utf8')).length; } catch { return 0; } };
console.log(`打好了：${zip}（${(fs.statSync(zip).size / 1048576).toFixed(1)} MB）\n带走的：成员 ${n('people')} 人・任务 ${n('tasks')} 个・经验 ${n('notes')} 条・小结 ${n('digests')} 份・交接报告 ${n('reports')} 份・对话 ${n('talks')} 段，加各人的备份和模版。\n没带走：你的 Slack／邮件设置、后台登录、ask ala。\n包里有钥匙和同事的资料：用 U 盘或隔空投送传，传完删掉。解压后先看「MacMini搬家说明.md」。`);
fs.rmSync(path.dirname(STAGE), { recursive: true, force: true });
