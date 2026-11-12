#!/usr/bin/env node
// 把这台电脑的 Claude Code 接到大地工作台（主机）：  node install.mjs <地址，如 http://192.168.1.20:8850> <你的钥匙 dk_…> [--folder <要备份的工作文件夹>]…
// 做五件事：① 装小助手到 ~/.dadi-brain/（brain-hook.mjs、dadi 命令、config.json）② claude mcp add 加连接 ③ 在 Claude Code 的 settings.json 里加五个钩子（开对话、每句话前、每次答完、结束、压缩前）
//          ④ 装后台定时（launchd，每分钟一次）：取到点的提醒弹通知，每 15 分钟备份 ⑤ 试连一次。
// 卸载：node install.mjs --uninstall
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const HOME = process.env.DADI_BRAIN_HOME || path.join(os.homedir(), '.dadi-brain');
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const HOOK = path.join(HOME, 'brain-hook.mjs');
const EVENTS = { SessionStart: 'start', UserPromptSubmit: 'prompt', Stop: 'stop', SessionEnd: 'end', PreCompact: 'compact' };
const LABEL = 'ai.alaco.dadi-sync';
const AGENTS = process.env.DADI_LAUNCHD_DIR || path.join(os.homedir(), 'Library', 'LaunchAgents');
const PLIST = path.join(AGENTS, LABEL + '.plist');
const MLABEL = 'ai.alaco.dadi-menu', MPLIST = path.join(AGENTS, MLABEL + '.plist'), MAPP = path.join(HOME, 'DadiMenu.app');   /* 菜单栏小程序：「我的今天」清单 */
const NO_LAUNCHD = !!process.env.DADI_NO_LAUNCHD || process.platform !== 'darwin';
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const claude = [process.env.DADI_CLAUDE_BIN, path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].filter(Boolean).find(p => fs.existsSync(p)) || 'claude';
const strip = s => { for (const ev of Object.keys(EVENTS)) if (Array.isArray(s.hooks && s.hooks[ev])) { s.hooks[ev] = s.hooks[ev].filter(g => !JSON.stringify(g).includes('brain-hook.mjs')); if (!s.hooks[ev].length) delete s.hooks[ev]; } return s; };
const writeSettings = s => { if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, SETTINGS + '.before-dadi'); fs.mkdirSync(CLAUDE_DIR, { recursive: true }); fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n'); };
const launchctl = (...a) => { try { execFileSync('/bin/launchctl', a, { stdio: 'ignore' }); return true; } catch { return false; } };
const uid = () => String(process.getuid());
/* 重装：先停旧的再起新的。系统停旧的要一点时间，马上起会失败，所以等一下、试几次 */
const restart = (label, plist) => { launchctl('bootout', `gui/${uid()}/${label}`); for (let i = 0; i < 8; i++) { if (launchctl('bootstrap', `gui/${uid()}`, plist)) return true; try { execFileSync('/bin/sleep', ['0.6']); } catch {} } return false; };

if (process.argv[2] === '--uninstall') {
  const s = readJson(SETTINGS); if (s) writeSettings(strip(s));
  try { execFileSync(claude, ['mcp', 'remove', '--scope', 'user', 'dadi-brain'], { stdio: 'ignore' }); } catch {}
  if (!NO_LAUNCHD) { launchctl('bootout', `gui/${uid()}/${LABEL}`); launchctl('bootout', `gui/${uid()}/${MLABEL}`); } try { fs.rmSync(PLIST, { force: true }); fs.rmSync(MPLIST, { force: true }); } catch {}
  fs.rmSync(HOME, { recursive: true, force: true }); console.log('已卸载：钩子、连接、后台定时、菜单栏小程序和 ~/.dadi-brain 都拿掉了。主机上已经备份的东西不会删。'); process.exit(0);
}
const [url, key] = [String(process.argv[2] || '').replace(/\/+$/, ''), process.argv[3] || ''];
if (!/^https?:\/\//.test(url) || !/^dk_/.test(key)) { console.error('用法：node install.mjs <地址，如 http://192.168.1.20:8850> <你的钥匙 dk_…> [--folder <要备份的工作文件夹>]'); process.exit(1); }
const test = await fetch(url + '/hook/brief', { headers: { authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(5000) }).catch(e => ({ ok: false, status: e.message }));
if (!test.ok) { console.error(`连不上或钥匙不对（${test.status}）。检查地址、主机是否开着、是否在同一个网络或 Tailscale 里。`); process.exit(1); }
let cliNote = '';
try { const j = JSON.parse(execFileSync(claude, ['auth', 'status'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] })); if (!j.loggedIn) cliNote = '这台电脑的 claude 命令行还没登录：对话小结和交接报告会整理不了。在终端跑一次  claude auth login  （用平时用 Claude 的那个账号），再重装一次接入。'; }
catch (e) { cliNote = e && e.code === 'ENOENT' ? '这台电脑上没有 claude 命令行（只装了桌面 App）：任务和清单能用，但对话小结和交接报告整理不了。装 Claude Code 命令行后再跑一次接入：https://claude.com/claude-code' : ''; }
fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
const got = await fetch(url + '/client/brain-hook.mjs').catch(() => null); const src = got && got.ok ? await got.text() : '';
if (!/大地工作台・每个人电脑上的小助手/.test(src)) { console.error('从主机取小助手没取到，什么都没改。检查地址后再试。'); process.exit(1); }
fs.writeFileSync(HOOK, src, { mode: 0o755 });
const old = readJson(path.join(HOME, 'config.json')) || {};   /* 重装：原来指定的工作文件夹和开关留着 */
const folders = [...(old.folders || [])]; for (let i = 4; i < process.argv.length; i++) if (process.argv[i] === '--folder' && process.argv[i + 1]) { const d = path.resolve(process.argv[++i].replace(/^~(?=\/|$)/, os.homedir())); if (fs.existsSync(d) && !folders.includes(d)) folders.push(d); }
fs.writeFileSync(path.join(HOME, 'config.json'), JSON.stringify({ digest: 'auto', sync: 'on', syncMin: 15, ...old, url, key, folders }, null, 2) + '\n', { mode: 0o600 });
fs.writeFileSync(path.join(HOME, 'dadi'), `#!/bin/sh\nexec "${process.execPath}" "${HOOK}" "$@"\n`, { mode: 0o755 });
try { execFileSync(claude, ['mcp', 'remove', '--scope', 'user', 'dadi-brain'], { stdio: 'ignore' }); } catch {}
try { execFileSync(claude, ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'dadi-brain', url + '/mcp', '--header', 'Authorization: Bearer ' + key], { stdio: 'ignore' }); console.log('① 连接已加进 Claude Code（dadi-brain）。'); }
catch (e) { console.log('① 没能自动加连接（找不到 claude 命令？）。手动运行：claude mcp add --transport http --scope user dadi-brain ' + url + '/mcp --header "Authorization: Bearer 你的钥匙"'); }
const s = strip(readJson(SETTINGS) || {}); s.hooks = s.hooks || {};
for (const [ev, c] of Object.entries(EVENTS)) (s.hooks[ev] = s.hooks[ev] || []).push({ hooks: [{ type: 'command', command: `"${process.execPath}" "${HOOK}" ${c}`, timeout: 10 }] });
writeSettings(s);
console.log('② 钩子已装：开对话自动带入今天的任务和提醒；对话结束和压缩前自动交小结。（原来的设置备份在 settings.json.before-dadi）');
/* 后台定时：每分钟跑一次小助手的 tick（取提醒；到 15 分钟就备份）。登录后自动启动 */
const x = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
fs.mkdirSync(AGENTS, { recursive: true });
fs.writeFileSync(PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${x(process.execPath)}</string><string>${x(HOOK)}</string><string>tick</string></array>
  <key>StartInterval</key><integer>60</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>EnvironmentVariables</key><dict><key>DADI_BRAIN_HOME</key><string>${x(HOME)}</string><key>CLAUDE_CONFIG_DIR</key><string>${x(CLAUDE_DIR)}</string></dict>
  <key>StandardOutPath</key><string>${x(path.join(HOME, 'tick.log'))}</string>
  <key>StandardErrorPath</key><string>${x(path.join(HOME, 'tick.log'))}</string>
</dict></plist>
`);
if (NO_LAUNCHD) console.log('③ 后台定时的配置已写好（这台不是 Mac 或处于测试模式，没有启动）。');
else { console.log(restart(LABEL, PLIST) ? '③ 后台定时已启动：每分钟取一次到点的提醒（弹桌面通知），每 15 分钟备份一次；早上弹「昨天／今天／还差」，下班弹「今天做完・还差」＋发送资料。' : '③ 后台定时没启动成。手动运行：launchctl bootstrap gui/$(id -u) ' + PLIST); }
/* 菜单栏小程序：从主机取 zip → 解到 ~/.dadi-brain/DadiMenu.app → 登录后自动打开。取不到就跳过，早晚改用对话框提醒 */
let menuOk = false;
if (process.platform === 'darwin') {
  try {
    const z = await fetch(url + '/client/DadiMenu.zip', { signal: AbortSignal.timeout(20000) });
    if (z.ok) {
      const zip = path.join(HOME, 'DadiMenu.zip'); fs.writeFileSync(zip, Buffer.from(await z.arrayBuffer()));
      if (!NO_LAUNCHD) launchctl('bootout', `gui/${uid()}/${MLABEL}`);
      fs.rmSync(MAPP, { recursive: true, force: true }); execFileSync('/usr/bin/ditto', ['-x', '-k', zip, HOME], { stdio: 'ignore' }); fs.rmSync(zip, { force: true });
      fs.writeFileSync(MPLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${MLABEL}</string>
  <key>ProgramArguments</key><array><string>${x(path.join(MAPP, 'Contents', 'MacOS', 'DadiMenu'))}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Interactive</string>
  <key>EnvironmentVariables</key><dict><key>DADI_BRAIN_HOME</key><string>${x(HOME)}</string></dict>
</dict></plist>
`);
      menuOk = fs.existsSync(path.join(MAPP, 'Contents', 'MacOS', 'DadiMenu'));
      if (menuOk && !NO_LAUNCHD) menuOk = restart(MLABEL, MPLIST);
    }
  } catch {}
}
console.log(menuOk ? '④ 菜单栏小程序已装：屏幕右上角的「大地 3」（3＝没做完的件数），点开是「我的今天」清单，可以打勾、看已完成、发送资料。' : '④ 菜单栏小程序没装上（主机上没有，或这台不是 Mac）：早上、下班改用对话框提醒；清单也可以用浏览器开 ' + url + '/me');
console.log('⑤ 小助手在 ' + HOME + ' 。交今天的交接报告：~/.dadi-brain/dadi send；存档文件：~/.dadi-brain/dadi put <文件>；现在备份一次：~/.dadi-brain/dadi sync');
console.log(`
会自动传到公司主机的东西（只传这些）：
  · Claude 的记忆、规则（CLAUDE.md）、技能、命令${folders.length ? '\n  · 这些工作文件夹：' + folders.join('、') : '\n  · 工作文件夹：还没有指定。要加：~/.dadi-brain/dadi folder add <文件夹>'}
  · 每段对话结束时的一份小结（做完了什么、没做完什么；私事不收）
  · 用 Claude 的时间点（只有时间和所在文件夹，没有内容）
下班时你自己确认了才传的：
  · 当天的交接报告（先看全文，可以去掉几条）
  · 今天的对话精简版：你说的话和 Claude 回答的文字。不带文件内容、命令输出，密码遮掉；可以逐段点「这段不发」，发了也能撤回
不会传：对话里的文件内容和命令输出、登录凭证、钥匙、密码。
想停：把 ~/.dadi-brain/config.json 里的 sync（备份）、digest（小结）、talk（精简对话）或 prompt（桌面弹窗）改成 "off"。`);
console.log('\n' + (await test.text()).split('\n').slice(0, 6).join('\n'));
if (cliNote) console.log('\n【要处理】' + cliNote);
console.log('\n好了。新开一段 Claude Code 对话就生效。');
