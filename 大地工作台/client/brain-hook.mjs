#!/usr/bin/env node
// 大地工作台・每个人电脑上的小助手（单文件、零依赖）。同事什么都不用做，三处自动跑：
//   ① Claude Code 的钩子：start（开对话：把今天的任务、提醒、新通知带给 Claude）／prompt（每句话前：有新通知就带上）／stop（每次答完）／end、compact（对话结束、压缩前：自动整理小结交到主机）。
//      每次都顺手报一声「我在」（只报时间和所在文件夹，不报说了什么）——主机靠它算在线状态和工作时间。
//   ② 后台定时（launchd 每分钟一次 tick）：取到点的提醒弹桌面通知；每 15 分钟把 Claude 的记忆・规则・技能和指定的工作文件夹备份到主机（只传有变化的）；
//      早上弹「昨天做完／今天要做／还差」，下班弹「今天做完 X 件・还差 Y 件」＋「发送资料」钮（时间由所有者在工作台「成员」里按人定；睡眠或关机错过的，醒来／开机后补弹）。
//      连不上主机时小结先存在 outbox/ 里，连上后补交。
//   ③ 命令：dadi send（现在交今天的交接报告：整理今天的对话→备份→存报告；加 --prepare 只整理不发，报告在清单上看过再发）｜dadi brief（看三段简报）｜dadi put/get（存档文件）｜dadi sync（现在备份一次）
//      ｜dadi talks [--skip 段,段]（上传今天的精简对话；平时由菜单栏小程序在确认发送时调）｜dadi folder add/list/remove（哪些工作文件夹要备份）｜dadi restore（换电脑、接手时取回）｜dadi status
// 设置在 ~/.dadi-brain/config.json：{ "url": "http://<主机>:8850", "key": "dk_…", "digest": "auto", "sync": "on", "prompt": "on", "folders": [] }。连不上时一律静悄悄退出，不耽误干活。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';

const HOME = process.env.DADI_BRAIN_HOME || path.join(os.homedir(), '.dadi-brain');
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const SELF = new URL(import.meta.url).pathname;
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const CFG_F = path.join(HOME, 'config.json');
const CFG = readJson(CFG_F) || {};
const STATE_F = path.join(HOME, 'state.json');
const state = readJson(STATE_F) || { sessions: {}, inboxAt: 0 };
const writeAtomic = (f, txt) => { const t = `${f}.${process.pid}.tmp`; fs.writeFileSync(t, txt); fs.renameSync(t, f); };   /* 先写临时文件再改名：几个进程同时写也不会读到半个文件 */
const patchState = (o, fn) => { try { const s = readJson(STATE_F) || { sessions: {}, inboxAt: 0 }; s.sessions = s.sessions || {}; Object.assign(s, o); if (fn) fn(s); const ids = Object.keys(s.sessions); for (const id of ids.slice(0, Math.max(0, ids.length - 200))) delete s.sessions[id]; writeAtomic(STATE_F, JSON.stringify(s)); } catch {} };   /* 后台定时和钩子可能同时写：现读现改，只改自己那一项 */
const cmd = process.argv[2] || '';
const arg = k => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] || '' : ''; };
const flag = k => process.argv.includes('--' + k);
const api = (p, opt = {}, ms = 2500) => fetch(CFG.url.replace(/\/+$/, '') + p, { ...opt, headers: { authorization: 'Bearer ' + CFG.key, ...(opt.headers || {}) }, signal: AbortSignal.timeout(ms) });
const stdin = () => new Promise(r => { if (process.stdin.isTTY) return r({}); let s = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', d => s += d); process.stdin.on('end', () => { try { r(JSON.parse(s)); } catch { r({}); } }); setTimeout(() => r({}), 1500); });
const quiet = () => process.exit(0);
const USER_CMDS = ['put', 'get', 'sync', 'restore', 'folder', 'status', 'send', 'brief', 'talks'];
const OUTBOX = path.join(HOME, 'outbox');   /* 连不上主机时，小结先放这里，tick 和 send 会补交 */
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const post = (p, body, ms = 8000) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, ms);
async function flushOutbox() { let files = []; try { files = fs.readdirSync(OUTBOX).filter(f => f.endsWith('.json')).sort(); } catch { return 0; } let n = 0; for (const f of files) { const abs = path.join(OUTBOX, f), b = readJson(abs); if (!b) { fs.rmSync(abs, { force: true }); continue; } try { const r = await post(b.path || '/hook/digest', b.body); if (r.status === 401 || r.ok) { fs.rmSync(abs, { force: true }); if (r.ok) n++; } else break; } catch { break; } } return n; }
if (!CFG.url || !CFG.key) { if (USER_CMDS.includes(cmd)) { console.error('还没接入：~/.dadi-brain/config.json 里没有 url 和 key'); process.exit(1); } quiet(); }
/* 报一声「我在」：另起一个进程去报，钩子自己不等它，不拖慢对话 */
const fireBeat = (ev, h) => { try { spawn(process.execPath, [SELF, 'beat', ev, String((h && h.session_id) || ''), String((h && h.cwd) || process.cwd())], { detached: true, stdio: 'ignore', env: { ...process.env, DADI_BRAIN_HOOK: '1' } }).unref(); } catch {} };

/* 把对话记录读成「谁说了什么」的短文本（只取文字，不取工具输出），from＝上次整理到第几行 */
function transcriptText(file, from) {
  let lines = []; try { lines = fs.readFileSync(file, 'utf8').split('\n'); } catch { return { text: '', users: 0, total: 0 }; }
  const out = []; let users = 0;
  for (const line of lines.slice(from)) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.isMeta || o.isSidechain || (o.type !== 'user' && o.type !== 'assistant')) continue;
    const c = o.message && o.message.content; const parts = typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter(b => b.type === 'text' && b.text).map(b => b.text) : [];
    for (const t of parts) { if (/^<(local-command|command-|system-reminder|task-notification)/.test(t.trim())) continue; if (o.type === 'user') users++; out.push(`${o.type === 'user' ? '【用户】' : '【助手】'}${t.trim().slice(0, o.type === 'user' ? 1200 : 700)}`); }
  }
  return { text: out.join('\n').slice(-60000), users, total: lines.length };
}
const findClaude = () => [process.env.DADI_CLAUDE_BIN, path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].filter(Boolean).find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || 'claude';

if (cmd === 'beat') { try { await api('/hook/beat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ev: process.argv[3], session: process.argv[4], cwd: process.argv[5] }) }, 4000); } catch {} quiet(); }
if (cmd === 'start') {   /* SessionStart：输出的字会进 Claude 的上下文 */
  if (process.env.DADI_BRAIN_HOOK) quiet();
  const h = await stdin(); fireBeat('start', h);
  try { const r = await api('/hook/start'); if (r.ok) { const t = await r.text(); if (t.trim()) console.log(t); } } catch {}
  patchState({ inboxAt: Date.now() }); quiet();
}
if (cmd === 'prompt') {   /* UserPromptSubmit：每句话报一声；通知最多一分钟查一次，有新的才出声 */
  if (process.env.DADI_BRAIN_HOOK) quiet();
  const h = await stdin(); fireBeat('prompt', h);
  if (Date.now() - (state.inboxAt || 0) < 60000) quiet();
  patchState({ inboxAt: Date.now() });
  try { const r = await api('/hook/inbox', {}, 1500); if (r.ok) { const t = await r.text(); if (t.trim()) console.log(t); } } catch {}
  quiet();
}
if (cmd === 'stop') { if (process.env.DADI_BRAIN_HOOK) quiet(); fireBeat('stop', await stdin()); quiet(); }   /* Stop：Claude 每次答完 */
if (cmd === 'end' || cmd === 'compact') {   /* SessionEnd／PreCompact：另起一个进程去整理小结，自己马上退出，不拖慢关闭 */
  if (process.env.DADI_BRAIN_HOOK) quiet();
  const h = await stdin(); fireBeat(cmd === 'end' ? 'end' : 'compact', h);
  if (CFG.digest === 'off' || !h.transcript_path || !h.session_id) quiet();
  const child = spawn(process.execPath, [SELF, 'summarize', h.transcript_path, h.session_id, h.cwd || ''], { detached: true, stdio: 'ignore', env: { ...process.env, DADI_BRAIN_HOOK: '1' } });
  child.unref(); quiet();
}
/* 小结没整理成：原因存进 state，桌面一天只提醒一次。登录过期是最常见的原因，提醒里直接给命令 */
const AUTHISH = /authenticate|oauth|login|logged|not authorized|401/i;
const fixHint = e => (AUTHISH.test(e) ? '这台电脑的 claude 命令行没登录或登录过期。在终端跑：claude auth login' : '原因：' + String(e).slice(0, 160));
function sumFail(e) { const d = ymd(); patchState({ sumError: { at: new Date().toISOString(), text: String(e).slice(0, 300) } }); const s = readJson(STATE_F) || {}; if (s.sumWarnDay !== d) { patchState({ sumWarnDay: d }); desktopNotify('自动小结没整理成。' + fixHint(e)); } }
/* 用一个便宜的模型把这段对话整理成小结（做完的／学到的／没做完的），只收公司的事。回 sent＝交了、queued＝连不上先存 outbox、skip＝没新内容、fail＝模型没跑成 */
async function summarizeFile(file, session, cwd) {
  const lock = path.join(HOME, `sum-${String(session).replace(/[^\w-]/g, '_').slice(0, 60)}.lock`);   /* 同一段对话一次只整理一份：压缩时那份还没交完，结束时这份就等它 */
  let mine = false;
  for (let i = 0; i < 90; i++) { try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); mine = true; break; } catch { try { if (Date.now() - fs.statSync(lock).mtimeMs > 180000) { fs.rmSync(lock, { force: true }); continue; } } catch {} await new Promise(r => setTimeout(r, 2000)); } }
  const unlock = () => { try { if (mine && fs.readFileSync(lock, 'utf8') === String(process.pid)) fs.rmSync(lock, { force: true }); } catch {} };
  try {
  const from = ((readJson(STATE_F) || {}).sessions || {})[session] || 0;
  const { text, users, total } = transcriptText(file, from);
  if (process.env.DADI_DEBUG) console.error(`[debug] ${String(session).slice(0, 8)} from=${from} users=${users} text=${text.length} total=${total}`);
  if (users < 2 || text.length < 200) return 'skip';   /* 太短的对话不整理 */
  let prevPending = [], carry = false; try { const r = await api('/hook/pending?session=' + encodeURIComponent(session), {}, 4000); if (r.ok) { prevPending = (await r.json()).pending || []; carry = true; } } catch {}   /* 取不到（断网）：carry=false，主机把两份合起来，不会拿这一份把上一份的「没做完」冲掉 */   /* 这段对话上一次小结里「没做完的」 */
  const prompt = `下面是一位同事和 AI 助手的一段工作对话。把其中和「公司工作」有关的内容整理成小结，只输出一个 JSON 对象，不要别的字：
{"done":["做完了什么、解决了什么问题，一句一条，写清对象（款号、单号、文件名）"],"learned":[{"title":"一句话标题","text":"公司以后用得上的经验：做法、坑、对方口径","category":"采购单|商品页|訳文|订单发货|客服咨询|退换货退款|库存|税务行政|月结借入|渠道内容|店铺|其他"}],"unfinished":["没做完、没解决、下次要接着做的事"],"todo":[{"title":"对话里明确说了以后要做、但还没做的一件具体的事（一句话，写清对象）","who":"谁来做：我／同事的名字","due":"说了期限才写，格式 2026-11-20，没说就空","category":"同上面的类别"}],"gaps":["公司网站 alaco.ai 或它的管理后台里没有这个功能、只能手工做或绕着做的事，一句一条"]}
规矩：只收公司的事；私事、闲聊、健康和家庭的内容一律不收；密码、钥匙、令牌一律不写；learned 最多 3 条，只收确实得到验证的结论，没有就给空数组；todo 最多 5 条，只收用户自己说了要做、要别人做、或在等对方回复的事，助手自己提的建议不算，已经做完的不算，和 unfinished 重复的只写在 todo 里；gaps 最多 3 条，只收对话里在 alaco.ai 网站或它的管理后台上确实碰到的缺功能，别的软件、工具、大地工作台自己的问题不算，没有就给空数组；全部用中文；对话里没有公司工作就三个都给空数组。

${prevPending.length ? `【这段对话前半段留下的「没做完的」】（这次看到的是后半段：后半段里做完了的就不要再列；还没做完的，照原话继续列进 unfinished）\n${prevPending.map(x => '- ' + x).join('\n')}\n\n` : ''}【对话】
${text}`;
  const out = await new Promise(resolve => { let buf = ''; let ch; try { ch = spawn(findClaude(), ['-p', '--model', CFG.digestModel || 'haiku', '--output-format', 'json', '--max-turns', '1'], { cwd: HOME, env: { ...process.env, DADI_BRAIN_HOOK: '1' }, stdio: ['pipe', 'pipe', 'ignore'] });   /* 在小助手自己的文件夹里跑：这次调用的记录不会被当成同事的对话 */ } catch { return resolve(''); } const t = setTimeout(() => { try { ch.kill(); } catch {} }, 120000); ch.stdout.on('data', d => buf += d); ch.on('error', () => { clearTimeout(t); resolve(''); }); ch.on('close', () => { clearTimeout(t); resolve(buf); }); ch.stdin.end(prompt); });
  let d = null, err = ''; try { const r = JSON.parse(out.trim().split('\n').pop()); if (r.is_error) err = String(r.result || '模型没回答'); else { const m = /\{[\s\S]*\}/.exec(String(r.result || '')); d = m ? JSON.parse(m[0]) : null; } } catch { err = out ? '模型回的不是 JSON' : '找不到 claude 命令，或它没跑起来'; }
  if (process.env.DADI_DEBUG) console.error(`[debug] ${String(session).slice(0, 8)} claude 回了 ${out.length} 字，err=${err}，尾=${out.trim().slice(-200)}`);
  if (err) { sumFail(err); return 'fail'; }   /* 没整理成（多半是 claude 命令行没登录）：记下原因，一天提醒一次；下次再整理 */
  if (!d) return 'skip';
  const body = { session, cwd, date: ymd(), carry, done: d.done || [], learned: d.learned || [], unfinished: d.unfinished || [], todo: Array.isArray(d.todo) ? d.todo.slice(0, 5) : [], gaps: Array.isArray(d.gaps) ? d.gaps.slice(0, 3) : [] };
  patchState({ sumError: null }, s => { s.sessions[session] = total; });   /* 整理过的部分不再整理；交不上去的放 outbox 等补交。整理成了：上次的失败记录清掉 */
  try { const r = await post('/hook/digest', body); if (r.ok || r.status === 401) return 'sent'; } catch {}
  try { fs.mkdirSync(OUTBOX, { recursive: true, mode: 0o700 }); writeAtomic(path.join(OUTBOX, `dg-${Date.now()}-${String(session).replace(/[^\w-]/g, '_').slice(0, 20)}.json`), JSON.stringify({ path: '/hook/digest', body })); } catch {}
  return 'queued';
  } finally { unlock(); }
}
if (cmd === 'summarize') { await summarizeFile(process.argv[3], process.argv[4], process.argv[5] || ''); quiet(); }

/* ───── 备份：Claude 的记忆・规则・技能＋指定的工作文件夹 → 主机。只传有变化的；不传登录凭证、钥匙。对话记录文件（.jsonl）不在备份里：对话另走「精简对话」，本人确认后才发 ───── */
const SYNC_F = path.join(HOME, 'sync.json');
const SECRETISH = /(credential|secret|token|password|passwd|\.pem$|\.key$|\.p8$|\.p12$|\.pfx$|\.env($|\.)|id_rsa|id_ed25519|\.keychain)/i;
const SKIP_DIR = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', '.next', 'dist', 'build', '.cache', 'DerivedData', 'Pods']);
const rootName = p => 'work-' + (path.basename(p).replace(/[^\p{L}\p{N}_.\-]/gu, '_').slice(0, 50) || 'folder');
function walk(dir, rel, root, out, max, maxSize) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { out.errors.push(`读不了 ${dir}（${e.code || e.message}）`); return; }
  for (const e of ents) {
    if (out.files.length >= max) return;
    if (e.name.startsWith('.') || SECRETISH.test(e.name) || e.isSymbolicLink()) continue;
    const abs = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) walk(abs, r, root, out, max, maxSize); continue; }
    if (!e.isFile()) continue;
    let st; try { st = fs.statSync(abs); } catch { continue; }
    if (st.size > maxSize) { out.skipped++; continue; }
    out.files.push({ root, rel: r, abs, size: st.size, mtime: Math.floor(st.mtimeMs) });
  }
}
function collect() {
  const out = { files: [], errors: [], skipped: 0 };
  for (const f of ['CLAUDE.md', 'settings.json', 'keybindings.json']) { const abs = path.join(CLAUDE_DIR, f); try { const st = fs.statSync(abs); if (st.isFile()) out.files.push({ root: 'claude', rel: f, abs, size: st.size, mtime: Math.floor(st.mtimeMs), redact: f === 'settings.json' }); } catch {} }
  for (const d of ['skills', 'agents', 'commands', 'rules', 'output-styles']) { const abs = path.join(CLAUDE_DIR, d); if (fs.existsSync(abs)) walk(abs, d, 'claude', out, 4000, 5e6); }
  let projs = []; try { projs = fs.readdirSync(path.join(CLAUDE_DIR, 'projects'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name); } catch {}
  for (const pj of projs) { const abs = path.join(CLAUDE_DIR, 'projects', pj, 'memory'); if (fs.existsSync(abs)) walk(abs, `projects/${pj}/memory`, 'claude', out, 6000, 5e6); }   /* 每个项目的记忆。对话原文（.jsonl）不传 */
  const seen = new Set(['claude']);
  for (const dir of (CFG.folders || [])) { let root = rootName(dir); while (seen.has(root)) root += '_'; seen.add(root); if (!fs.existsSync(dir)) { out.errors.push(`文件夹不在了：${dir}`); continue; } const before = out.files.length; walk(dir, '', root, out, before + 3000, 20e6); }
  return out;
}
const KEYLIKE = /(sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9]{20,}|xox[abpors]-[A-Za-z0-9-]{8,}|dk_[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|(?<=Bearer\s)(?=[A-Za-z0-9._~+\/=-]*\d)[A-Za-z0-9._~+\/=-]{20,}|(?<=(?:password|passwd|secret|token|api[_-]?key)"?\s*[:=]\s*"?)[^\s"',]{8,})/gi;
const scrub = buf => { if (buf.length > 5e6 || buf.subarray(0, 8000).includes(0)) return buf; const t = buf.toString('utf8'); const u = t.replace(KEYLIKE, '（已隐藏）'); return u === t ? buf : Buffer.from(u); };   /* 文本里像钥匙、令牌、密码的一段换成「（已隐藏）」；图片等二进制原样 */
const redact = txt => { try { const j = JSON.parse(txt); if (j.env && typeof j.env === 'object') for (const k of Object.keys(j.env)) j.env[k] = '（已隐藏）'; for (const k of ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'otelHeadersHelper']) if (j[k]) j[k] = '（已隐藏）'; return JSON.stringify(j, null, 2); } catch { return '{}'; } };   /* 设置文件里的环境变量可能有钥匙：值不传 */
async function syncRun({ budgetMs = 45000, maxUp = 400 } = {}) {
  const man = readJson(SYNC_F) || { files: {} }, out = collect(); let up = 0, more = false, fail = ''; const t0 = Date.now(), names = [];
  for (const f of out.files) {
    const key = f.root + '/' + f.rel, old = man.files[key];
    if (old && old.size === f.size && old.mtime === f.mtime) continue;
    if (up >= maxUp || Date.now() - t0 > budgetMs) { more = true; break; }
    let buf; try { buf = scrub(f.redact ? Buffer.from(redact(fs.readFileSync(f.abs, 'utf8'))) : fs.readFileSync(f.abs)); } catch (e) { out.errors.push(`读不了 ${f.abs}（${e.code || e.message}）`); continue; }
    const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
    if (old && old.sha === sha) { man.files[key] = { size: f.size, mtime: f.mtime, sha }; continue; }
    try { const r = await api('/backup/file?' + new URLSearchParams({ root: f.root, path: f.rel }), { method: 'POST', body: buf, headers: { 'content-type': 'application/octet-stream' } }, 60000); if (!r.ok) { const j = await r.json().catch(() => ({})); out.errors.push(`${key}：${j.error || r.status}`); if (r.status === 401) { fail = '钥匙不对或已停用'; break; } continue; } }
    catch { fail = '连不上主机'; break; }
    man.files[key] = { size: f.size, mtime: f.mtime, sha }; up++; if (names.length < 30) names.push(key);
  }
  try { fs.writeFileSync(SYNC_F, JSON.stringify(man)); } catch {}
  if (!fail) { try { await api('/backup/done', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ host: os.hostname(), user: os.userInfo().username, home: os.homedir(), claudeDir: CLAUDE_DIR, folders: CFG.folders || [], count: out.files.length, uploaded: up, errors: out.errors.length, firstError: out.errors[0] || '' }) }, 8000); } catch {} }
  return { up, names, total: out.files.length, errors: out.errors, skipped: out.skipped, more, fail };
}
function desktopNotify(text) {
  try { fs.appendFileSync(path.join(HOME, 'notify.log'), `${new Date().toISOString()} ${text}\n`); } catch {}
  if (process.env.DADI_NO_NOTIFY || process.platform !== 'darwin') return;
  const esc = s => String(s).replace(/[\\"]/g, ' ').replace(/[\r\n]+/g, ' ').slice(0, 220);
  try { spawnSync('/usr/bin/osascript', ['-e', `display notification "${esc(text)}" with title "大地工作台" sound name "Glass"`], { timeout: 5000 }); } catch {}
}
/* Claude 正在干活吗：一分钟内有没有哪段对话记录在变（工作台和小助手自己起的 Claude 写在 dadi 开头的文件夹里，不算） */
function claudeBusy() { let pj = []; try { pj = fs.readdirSync(path.join(CLAUDE_DIR, 'projects'), { withFileTypes: true }).filter(e => e.isDirectory() && !/dadi-workbench|dadi-brain/.test(e.name)).map(e => e.name); } catch { return ''; }
  let best = 0, where = ''; for (const d of pj) { let fl = []; try { fl = fs.readdirSync(path.join(CLAUDE_DIR, 'projects', d)); } catch { continue; } for (const f of fl) { if (!f.endsWith('.jsonl')) continue; try { const m = fs.statSync(path.join(CLAUDE_DIR, 'projects', d, f)).mtimeMs; if (m > best) { best = m; where = d; } } catch {} } }
  return Date.now() - best < 70000 ? where : ''; }
if (cmd === 'tick') {   /* 后台每分钟一次：取到点的提醒和新通知弹出来；Claude 在干活就报一声；到时间了就备份 */
  const lock = path.join(HOME, 'tick.lock'); try { const st = fs.statSync(lock); if (Date.now() - st.mtimeMs < 10 * 60000) quiet(); } catch {}
  try { fs.writeFileSync(lock, String(process.pid)); } catch {}
  try {
    let pr = null;
    try { const se = ((readJson(STATE_F) || {}).sumError || {}).text || ''; const r = await api('/hook/tick' + (se ? '?se=' + encodeURIComponent(se.slice(0, 200)) : ''), {}, 4000); if (r.ok) { const j = await r.json(); for (const t of (j.notify || [])) desktopNotify(t); pr = j.prompt || null; } } catch {}
    if (pr) { patchState({ prompt: pr }); promptCheck(pr); }
    await flushOutbox();
    const busy = claudeBusy(); if (busy) { try { await api('/hook/beat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ev: 'work', cwd: busy.replace(/^-+/, '').split('-').pop() }) }, 4000); } catch {} }
    const every = Math.max(1, Number(CFG.syncMin) || 15) * 60000;
    if (CFG.sync !== 'off' && Date.now() - (state.syncAt || 0) >= every) { patchState({ syncAt: Date.now() }); const r = await syncRun(); if (r.more) patchState({ syncAt: 0 }); }   /* 一次没传完：下一分钟接着传 */
  } finally { try { fs.rmSync(lock, { force: true }); } catch {} }
  quiet();
}
/* ───── 桌面提示器：早上一次「昨天／今天／还差」，下班一次「今天做完・还差」＋发送资料。时间按人定（主机给）；错过的补弹；一天各弹一次 ───── */
function hmNow() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function hmOf(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? +m[1] * 60 + +m[2] : null; }
function promptCheck(pr) {
  if (CFG.prompt === 'off' || !pr || pr.on === false || process.platform !== 'darwin') return;
  if (!process.env.DADI_NO_NOTIFY && spawnSync('/usr/bin/pgrep', ['-f', 'DadiMenu.app/Contents/MacOS/DadiMenu'], { timeout: 3000 }).status === 0) return;   /* 菜单栏小程序开着：早晚由它自己弹出清单，这里不再弹对话框（它没开时这里兜底） */
  const s = readJson(STATE_F) || {}, d = ymd(), n = hmNow(), mo = hmOf(pr.morning), ev = hmOf(pr.evening);
  const fire = kind => { patchState({ [kind + 'Day']: d }); try { spawn(process.execPath, [SELF, 'popup', kind], { detached: true, stdio: 'ignore', env: { ...process.env, DADI_BRAIN_HOOK: '1' } }).unref(); } catch {} };
  if (mo != null && n >= mo && s.morningDay !== d && (ev == null || n < ev)) fire('morning');   /* 过了下班时间才开机：早上那条不补，晚上那条会说 */
  else if (ev != null && n >= ev && s.eveningDay !== d && Date.now() >= (s.snoozeUntil || 0)) fire('evening');
}
/* 弹一个对话框（Mac 自带的），回按了哪个按钮；超时没按算 gaveUp。文字经 argv 传，不用转义 */
function dialog(text, buttons, def, cancel, secs = 1800) {
  if (process.env.DADI_NO_NOTIFY) return { button: '', gaveUp: true, text };
  const btn = `{${buttons.map(b => JSON.stringify(b)).join(', ')}}`;
  const r = spawnSync('/usr/bin/osascript', ['-e', 'on run argv', '-e', `set r to display dialog (item 1 of argv) with title "大地工作台" buttons ${btn} default button ${JSON.stringify(def)}${cancel ? ' cancel button ' + JSON.stringify(cancel) : ''} giving up after ${secs}`, '-e', 'if gave up of r then return "gaveUp"', '-e', 'return button returned of r', '-e', 'end run', '--', text], { encoding: 'utf8', timeout: (secs + 30) * 1000 });
  const out = String(r.stdout || '').trim();
  return { button: out === 'gaveUp' ? '' : out, gaveUp: out === 'gaveUp' || r.status !== 0 };   /* 点了取消钮（cancel button）osascript 会报错退出：也算没按 */
}
function openClaude() { if (spawnSync('/usr/bin/open', ['-b', 'com.anthropic.claudefordesktop'], { timeout: 8000 }).status !== 0) spawnSync('/usr/bin/osascript', ['-e', 'tell application "Terminal" to do script "claude"', '-e', 'tell application "Terminal" to activate'], { timeout: 8000 }); }
if (cmd === 'popup') {
  const kind = process.argv[3] === 'evening' ? 'evening' : 'morning', d = ymd();
  let text = ''; try { const r = await api('/hook/brief?part=' + kind, {}, 6000); if (r.ok) text = (await r.text()).trim(); } catch {}
  if (!text) quiet();
  if (kind === 'morning') { const r = dialog(`${d} 早上好\n\n${text}`, ['知道了', '打开 Claude'], '打开 Claude', ''); if (process.env.DADI_NO_NOTIFY) console.log(r.text); if (r.button === '打开 Claude') openClaude(); quiet(); }
  const r = dialog(`${d} 今天的收尾\n\n${text}\n\n点「发送资料」：把今天的工作整理成交接报告，连记忆和规则一起交给公司 Mac mini。今天的对话不在这里发，要在菜单栏清单「交接报告」里逐段看过再发。`, ['今天不用', '稍后', '发送资料'], '发送资料', '');
  if (process.env.DADI_NO_NOTIFY) console.log(r.text);
  if (r.button === '发送资料') { await sendRun(); quiet(); }
  if (r.button === '今天不用') quiet();
  patchState({ eveningDay: '', snoozeUntil: Date.now() + 30 * 60000 });   /* 稍后／没按：30 分钟后再弹；过了零点就不弹了 */
  quiet();
}
/* 发送资料：①今天动过的对话先整理成小结 ②补交 outbox ③备份一次 ④让主机存一份当天的交接报告 ⑤弹「已收到」 */
function todaysTranscripts() {
  const out = [], lim = new Date(); lim.setHours(0, 0, 0, 0);
  let pj = []; try { pj = fs.readdirSync(path.join(CLAUDE_DIR, 'projects'), { withFileTypes: true }).filter(e => e.isDirectory() && !/dadi-workbench|dadi-brain/.test(e.name)).map(e => e.name); } catch { return out; }
  for (const dname of pj) { let fl = []; try { fl = fs.readdirSync(path.join(CLAUDE_DIR, 'projects', dname)); } catch { continue; } for (const f of fl) { if (!f.endsWith('.jsonl')) continue; const abs = path.join(CLAUDE_DIR, 'projects', dname, f); try { const st = fs.statSync(abs); if (st.mtimeMs >= lim.getTime() && st.size > 500) out.push({ file: abs, session: f.slice(0, -6), cwd: dname.replace(/^-+/, '').split('-').pop(), mtime: st.mtimeMs }); } catch {} } }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, 12);
}
/* ───── 精简对话：今天每段对话里「人说的话」和「Claude 回答的文字」。不带文件内容、命令输出、思考过程；像钥匙密码的一段遮掉。
   先在本机做好放 talks/日期/（prepare 时），本人在报告页看过、点了确认才上传（talksUpload）；可以逐段不发。
   config.json 里 talk:"off"＝不做；talkFolders:[…]＝只收在这些文件夹里开的对话 ───── */
const TALKS = path.join(HOME, 'talks');
const hmOfIso = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function talkOf(file) {
  let lines = []; try { lines = fs.readFileSync(file, 'utf8').split('\n'); } catch { return null; }
  const d = ymd(), out = []; let users = 0, title = '', cwd = '';
  for (const line of lines) {
    if (!line) continue; let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.isMeta || o.isSidechain || (o.type !== 'user' && o.type !== 'assistant') || !o.timestamp || ymd(new Date(o.timestamp)) !== d) continue;
    if (!cwd && o.cwd) cwd = String(o.cwd);
    const c = o.message && o.message.content; const parts = typeof c === 'string' ? [c] : Array.isArray(c) ? c.filter(b => b.type === 'text' && b.text).map(b => b.text) : [];
    for (const raw of parts) { const t = String(raw).trim(); if (!t || /^<(local-command|command-|system-reminder|task-notification|bash-)/.test(t) || /^\[SYSTEM NOTIFICATION/.test(t)) continue;
      if (o.type === 'user') { if (!users && /^下面是一位同事和 AI 助手的一段工作对话/.test(t)) return null;   /* 小助手自己做小结时的那次调用，不是人的对话 */
        users++; if (!title) title = t.replace(/\s+/g, ' ').slice(0, 40); }
      out.push(`【${o.type === 'user' ? '我' : 'Claude'} ${hmOfIso(o.timestamp)}】${t.slice(0, o.type === 'user' ? 6000 : 4000)}`); }
  }
  if (!users) return null;
  const only = (CFG.talkFolders || []).map(x => path.resolve(String(x).replace(/^~(?=\/|$)/, os.homedir()))); if (only.length && !only.some(f => cwd === f || cwd.startsWith(f + path.sep))) return null;
  let text = out.join('\n\n').replace(KEYLIKE, '（已隐藏）'); if (text.length > 600000) text = '（前面太长，只留后面的部分）\n' + text.slice(-600000);
  return { title: title || '（没有标题）', turns: users, chars: text.length, text };
}
function talksPrepare() {
  const d = ymd(), dir = path.join(TALKS, d), list = [];
  if (CFG.talk === 'off') return list;
  patchState({ talkDay: d });   /* 记下是哪天整理的：过了零点再点「确认发送」也上传这一天的 */
  try { fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); for (const old of fs.readdirSync(TALKS)) if (old < d) fs.rmSync(path.join(TALKS, old), { recursive: true, force: true }); } catch {}
  for (const t of todaysTranscripts()) { const k = talkOf(t.file); if (!k || (k.turns < 2 && k.chars < 200)) continue;   /* 只说了一句、又很短的，不算一段工作对话 */ const id = t.session.replace(/[^\w-]/g, '_').slice(0, 60);
    try { fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify({ session: id, title: k.title, turns: k.turns, chars: k.chars, text: k.text }), { mode: 0o600 }); list.push({ session: id, title: k.title, turns: k.turns, chars: k.chars }); } catch {} }
  return list;
}
async function talksUpload(skip = []) {
  const d = (readJson(STATE_F) || {}).talkDay || ymd(), dir = path.join(TALKS, d), sent = []; let failed = 0, files = []; try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch {}
  for (const f of files) { const k = readJson(path.join(dir, f)); if (!k || skip.includes(k.session)) continue;
    try { const r = await api('/talk?' + new URLSearchParams({ session: k.session, date: d, title: k.title, turns: String(k.turns) }), { method: 'POST', body: k.text, headers: { 'content-type': 'text/plain; charset=utf-8' } }, 60000); if (r.ok) sent.push({ session: k.session, title: k.title, chars: k.chars }); else failed++; } catch { failed++; } }
  return { sent, failed, skipped: skip.length };
}
if (cmd === 'talks') {   /* 上传今天做好的精简对话（--skip a,b 这几段不发）。菜单栏小程序在本人点了「确认发送」之后才调 */
  const skip = arg('skip').split(',').map(x => x.trim()).filter(Boolean); const r = await talksUpload(skip);
  console.log(flag('json') ? JSON.stringify(r) : `发了 ${r.sent.length} 段对话${r.failed ? `，${r.failed} 段没发成` : ''}${r.skipped ? `，${r.skipped} 段按你的意思没发` : ''}`); process.exit(0);
}
async function sendRun({ prepare = false, json = false } = {}) {
  const t0 = Date.now(); if (!json) desktopNotify('正在整理今天的工作，整理好会再通知…');
  let sent = 0, queued = 0, failed = 0, ferr = ''; if (CFG.digest !== 'off') for (const t of todaysTranscripts()) { const r = await summarizeFile(t.file, t.session, t.cwd); if (process.env.DADI_DEBUG) console.error(`[debug] ${t.session.slice(0, 8)} → ${r}`); if (r === 'sent') sent++; if (r === 'queued') queued++; if (r === 'fail') { failed++; ferr = ((readJson(STATE_F) || {}).sumError || {}).text || ''; if (AUTHISH.test(ferr)) break; } }   /* 登录过期：后面几段也不用试了 */
  const flushed = await flushOutbox();
  let up = 0, fail = '', files = []; if (CFG.sync !== 'off') { const r = await syncRun({ budgetMs: 180000, maxUp: 2000 }); up = r.up; fail = r.fail; files = r.names || []; patchState({ syncAt: Date.now() }); }
  const talks = talksPrepare();
  const client = { sent: sent + flushed, queued, failed, up, files, hint: failed ? fixHint(ferr) : '', fail, talks };
  if (prepare) { if (json) console.log(JSON.stringify(client)); else console.log(`整理好了：小结 ${sent + flushed} 份，备份 ${up} 个文件有变化，今天的对话 ${talks.length} 段（精简版，还在本机）。交接报告还没发：在菜单栏清单里看过再点「确认发送」。`); return true; }   /* 只整理不发：报告由本人在清单上看过再发 */
  const tk = flag('talks') ? await talksUpload([]) : { sent: [], failed: 0 };   /* 对话只有本人在清单「交接报告」里逐段看过才发；一条命令发完的走法要明确加 --talks */
  let j = null; try { const r = await post('/hook/report', { date: ymd(), client }, 15000); if (r.ok) j = await r.json(); } catch {}
  const secs = Math.round((Date.now() - t0) / 1000);
  const msg = (j ? `已收到：交接报告 1 份（做完 ${j.done} 件・还差 ${j.pending} 件・经验 ${j.learned} 条）、小结 ${sent + flushed} 份${tk.sent.length ? `、对话 ${tk.sent.length} 段（精简版）` : talks.length ? `；今天的对话 ${talks.length} 段还没发（在菜单栏清单「交接报告」里看过再发）` : ''}、备份 ${up} 个文件有变化（共 ${j.backupFiles} 个）。${secs} 秒。` : `连不上公司 Mac mini：小结已存在本机（${queued} 份），连上后会自动补交${fail ? '；备份：' + fail : ''}。`) + (failed ? `\n有 ${failed} 段对话没整理成小结：${fixHint(ferr)}。登录后再跑一次 dadi send 就会补上。` : '');
  if (j) patchState({ eveningDay: ymd(), snoozeUntil: 0 });
  desktopNotify(msg); console.log(msg); return !!j;
}
if (cmd === 'send') { process.exit((await sendRun({ prepare: flag('prepare'), json: flag('json') })) ? 0 : 1); }
if (cmd === 'brief') { try { const r = await api('/hook/brief?part=' + (process.argv[3] === 'evening' ? 'evening' : 'morning'), {}, 6000); console.log(r.ok ? await r.text() : '取不到：' + r.status); } catch { console.error('连不上主机'); process.exit(1); } process.exit(0); }
if (cmd === 'sync') { const r = await syncRun({ budgetMs: 10 * 60000, maxUp: 5000 }); patchState({ syncAt: Date.now() }); if (r.fail) { console.error('没备份成：' + r.fail); process.exit(1); } console.log(`备份好了：共 ${r.total} 个文件，这次传了 ${r.up} 个${r.skipped ? `，${r.skipped} 个太大没传` : ''}${r.more ? '，还有没传完的，再运行一次' : ''}`); for (const e of r.errors.slice(0, 5)) console.log('  ' + e); process.exit(0); }
if (cmd === 'folder') {
  const sub = process.argv[3], dir = process.argv[4] ? path.resolve(process.argv[4].replace(/^~(?=\/|$)/, os.homedir())) : ''; const list = (CFG.folders || []).slice();
  if (sub === 'add' && dir) { if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { console.error('没有这个文件夹：' + dir); process.exit(1); } if (!list.includes(dir)) list.push(dir); }
  else if (sub === 'remove' && dir) { const i = list.indexOf(dir); if (i >= 0) list.splice(i, 1); }
  else if (sub !== 'list') { console.error('用法：dadi folder add <文件夹>｜dadi folder remove <文件夹>｜dadi folder list'); process.exit(1); }
  if (sub !== 'list') fs.writeFileSync(CFG_F, JSON.stringify({ ...CFG, folders: list }, null, 2) + '\n', { mode: 0o600 });
  console.log(list.length ? '会备份这些工作文件夹：\n' + list.map(x => '  ' + x).join('\n') : '还没有指定工作文件夹（Claude 的记忆、规则、技能一直会备份）。'); process.exit(0);
}
if (cmd === 'status') { const man = readJson(SYNC_F) || { files: {} }; let ob = 0; try { ob = fs.readdirSync(OUTBOX).filter(f => f.endsWith('.json')).length; } catch {} const pr = state.prompt || {}; console.log(`主机：${CFG.url}\n备份：${CFG.sync === 'off' ? '已关' : `每 ${Number(CFG.syncMin) || 15} 分钟`}，已传 ${Object.keys(man.files).length} 个文件，上次 ${state.syncAt ? new Date(state.syncAt).toLocaleString() : '还没有'}\n工作文件夹：${(CFG.folders || []).join('、') || '（无）'}\n自动小结：${CFG.digest === 'off' ? '已关' : '开'}${ob ? `，${ob} 份还没交上去（连上主机会补交）` : ''}\n桌面提示：${CFG.prompt === 'off' || pr.on === false ? '已关' : `早上 ${pr.morning || '09:00'}・下班 ${pr.evening || '18:00'}`}${state.eveningDay === ymd() ? '，今天的资料已发送' : ''}${state.sumError ? `\n上次小结没整理成（${String(state.sumError.at).slice(0, 16).replace('T', ' ')}）：${fixHint(state.sumError.text)}` : ''}`); process.exit(0); }
if (cmd === 'restore') {   /* 换电脑、接手别人的工作：把主机上的备份取回来。默认只取到 ~/dadi-restore/…，加 --apply 才放进 Claude 的文件夹（已有的不覆盖，除非加 --force） */
  const person = arg('person'); const r = await api('/backup/list' + (person ? '?person=' + encodeURIComponent(person) : ''), {}, 20000).catch(() => null);
  if (!r || !r.ok) { console.error('取不到：' + ((r && (await r.json().catch(() => ({}))).error) || '连不上主机')); process.exit(1); }
  const j = await r.json(); const d = new Date(), dest = path.resolve(arg('to') || path.join(os.homedir(), 'dadi-restore', `${j.person}-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`));
  let n = 0, bad = 0;
  for (const f of j.files) { const parts = f.path.split('/'); if (parts.some(s => !s || s === '.' || s === '..')) { bad++; continue; } const to = path.join(dest, ...parts);
    try { const g = await api('/backup/file?' + new URLSearchParams({ path: f.path, ...(person ? { person } : {}) }), {}, 120000); if (!g.ok) { bad++; continue; } fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, Buffer.from(await g.arrayBuffer())); n++; } catch { bad++; } }
  console.log(`取回 ${n} 个文件到 ${dest}${bad ? `（${bad} 个没取到）` : ''}。来自 ${j.person} 的电脑 ${(j.meta && j.meta.host) || ''}，上次备份 ${(j.meta && j.meta.lastSync) || ''}`);
  if (flag('apply')) {
    const enc = s => String(s || '').replace(/[^a-zA-Z0-9]/g, '-'), oldH = enc(j.meta && j.meta.home), newH = enc(os.homedir()); let put = 0, kept = 0;
    const src = path.join(dest, 'claude'); const go = (dir, rel) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const a = path.join(dir, e.name), r2 = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) { go(a, r2); continue; }
      let out = r2 === 'settings.json' ? 'settings.restored.json' : r2; const m = /^projects\/([^/]+)\/(.*)$/.exec(out); if (m && oldH && oldH !== newH && m[1].startsWith(oldH)) out = `projects/${newH}${m[1].slice(oldH.length)}/${m[2]}`;   /* 记忆按文件夹路径存：用户名不同就换成这台电脑的 */
      const to = path.join(CLAUDE_DIR, out); if (fs.existsSync(to) && !flag('force')) { kept++; continue; } fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(a, to); put++; } };
    if (fs.existsSync(src)) go(src, '');
    console.log(`已放进 ${CLAUDE_DIR}：${put} 个${kept ? `；${kept} 个这台电脑上已经有，没有覆盖（要覆盖加 --force）` : ''}。原来的设置文件存成了 settings.restored.json，没有替换现在的设置。工作文件夹在 ${dest} 里，自己挪到要用的位置。`);
  } else console.log('只是取回来了，还没有放进 Claude。要让这台电脑的 Claude 接着用这些记忆和规则：再运行一次并加 --apply');
  process.exit(0);
}
if (cmd === 'put') {
  const file = process.argv[3];
  if (!file || !fs.existsSync(file)) { console.error('用法：dadi put <文件路径> [--task T-0003] [--note 说明]'); process.exit(1); }
  const buf = fs.readFileSync(file); if (buf.length > 50e6) { console.error('文件太大（最大 50MB）。大素材放共享的 Google Drive。'); process.exit(1); }
  const q = new URLSearchParams({ name: path.basename(file), task: arg('task'), note: arg('note') });
  const r = await api('/files?' + q, { method: 'POST', body: buf, headers: { 'content-type': 'application/octet-stream' } }, 120000); const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('没存成：' + (j.error || r.status)); process.exit(1); }
  console.log(`已存档到主机：${j.id} ${j.name}（${Math.round(j.size / 1024)}KB）`); process.exit(0);
}
if (cmd === 'get') {
  const id = process.argv[3]; if (!id) { console.error('用法：dadi get <F-编号> [保存位置]'); process.exit(1); }
  const r = await api('/files/' + encodeURIComponent(id), {}, 120000); if (!r.ok) { console.error('取不到：' + ((await r.json().catch(() => ({}))).error || r.status)); process.exit(1); }
  const name = decodeURIComponent(r.headers.get('x-file-name') || id); let dest = process.argv[4] || name; try { if (fs.statSync(dest).isDirectory()) dest = path.join(dest, name); } catch {}
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer())); console.log(`已取回：${dest}`); process.exit(0);
}
console.error('用法：dadi send（交今天的交接报告）｜dadi brief [evening]｜dadi put <文件> [--task T-0003] [--note 说明]｜dadi get <F-编号> [保存位置]｜dadi sync｜dadi folder add/list/remove｜dadi restore [--person 名字] [--apply]｜dadi status'); process.exit(1);
