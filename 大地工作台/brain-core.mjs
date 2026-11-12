// 大地工作台・协作模块：让每个人自己的 Claude Code（或 Codex）连到这台机器上的大地工作台。
// 工作台原有的东西照旧：模版＝固定做法，提醒型模版＝任务规则，后台工具、硬规则、页面都是原来的。这里只加四样——
//   ① 人和钥匙：每人一把，决定他的 Claude 能做什么
//   ② 任务表：提醒型模版每天按后台数据和日历生成任务，按分工表派人；人也能派；流程链自动接下一步；留言、通知
//   ③ 经验：各人的 Claude 交上来的先「待验证」，所有者批准后写进对应的模版，以后领这类任务时随任务一起给
//   ④ 连接口：/mcp（Claude Code 的工具）、/hook（开对话自动带入任务、结束自动交小结）、/files（存档文件）、/client（各电脑的小助手）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { adminCall, okPath, closedPath, DATA as WB_DATA } from './adminlib.mjs';
import * as SK from './skills.mjs';
import * as PROD from './product.mjs';
import { judge as guardJudge } from './hooks/guard.mjs';
import { CATEGORIES, DEPTS, ALL_CAPS, CAP_WORDS, CHAINS, COMPANY } from './brain-seed.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(WB_DATA, 'brain');
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, v) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v, null, 1), { mode: 0o600 }); fs.renameSync(t, f); };
const CFG = { scanHour: 9, ntfyBase: '' };
/* 工作台交进来的：模版（固定做法）怎么读写、提醒型模版清单、有变化时怎么通知页面 */
const deps = { practices: () => [], practiceAppend: () => {}, remindRules: () => [], productForm: () => undefined, onChange: () => {}, port: () => 8850, runAgent: async () => ({ ok: false, error: '这台机器没有配置 Claude' }) };
export function init(d) { Object.assign(deps, d); load(); }
export { CATEGORIES, CAP_WORDS };
const now = () => new Date().toISOString();
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; };
const str = (v, n = 2000) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');

/* ───── 数据：每样一个 JSON 文件（原子写入）。量很小：一个人几个月的经验不到 1MB ───── */
const F = n => path.join(DATA, n + '.json');
const db = { people: [], duties: {}, tasks: [], notes: [], digests: [], inbox: [], files: [], beats: {}, worklog: [], reminders: [], reports: [], talks: [], cands: [], gaps: [], weekly: [], settings: {}, seq: { task: 0, note: 0, file: 0, rem: 0 } };
function load() {
  for (const k of Object.keys(db)) { const v = readJson(F(k)); if (v != null) db[k] = v; }
  if (!db.people.length) seed();
  for (const k of ['task', 'note', 'file', 'rem']) if (!Number.isInteger(db.seq[k])) db.seq[k] = 0;
}
let chT = null;
const save = k => { writeJson(F(k), db[k]); if (!chT) chT = setTimeout(() => { chT = null; try { deps.onChange(); } catch {} }, 150); };   /* 有变化：通知工作台页面刷新 */
function audit(who, what, detail) { try { fs.appendFileSync(path.join(DATA, 'audit.log'), JSON.stringify({ at: now(), who, what, detail: clip(detail || '', 400) }) + '\n'); } catch {} }
function seed() {
  const key = 'dk_' + crypto.randomBytes(18).toString('base64url');
  db.people = [{ id: 'souki', name: 'Souki', role: 'owner', caps: ALL_CAPS, keyHash: sha(key), off: [], createdAt: now() }];
  fs.writeFileSync(path.join(DATA, 'owner.key'), key + '\n', { mode: 0o600 });   /* 所有者自己的钥匙：只存在这台机器上，给本机的 Claude 连接用 */
  db.duties = { map: Object.fromEntries(CATEGORIES.map(c => [c, 'souki'])), chains: CHAINS };
  db.notes = []; db.tasks = []; db.digests = []; db.inbox = []; db.files = []; db.seq = { task: 0, note: 0, file: 0, rem: 0 };
  for (const k of Object.keys(db)) save(k);
  fs.writeFileSync(path.join(DATA, 'company.md'), COMPANY);
}
const rules = () => deps.remindRules();   /* 提醒型模版就是任务规则 */
const company = () => { try { return fs.readFileSync(path.join(DATA, 'company.md'), 'utf8'); } catch { return COMPANY; } };
const person = id => db.people.find(p => p.id === id);
const pname = id => (person(id) || {}).name || id || '（未分配）';
const can = (p, cap) => !!p && (p.role === 'owner' || (p.caps || []).includes(cap));
const personByKey = key => { const h = sha(String(key || '').trim()); return db.people.find(p => p.keyHash === h && !p.disabled) || null; };

/* ───── 查找：中文按两个字一组、英文数字按词；标题和已采用的加权 ───── */
const toks = s => { s = String(s || '').toLowerCase(); const out = new Set(s.match(/[a-z0-9][a-z0-9\-_.]+/g) || []); const cj = s.replace(/[^぀-ヿ一-鿿]/g, ' ').split(/\s+/); for (const w of cj) for (let i = 0; i < w.length - 1; i++) out.add(w.slice(i, i + 2)); return [...out]; };
function search(q, { category } = {}) {
  const qs = toks(q); if (!qs.length) return [];
  const pool = [
    ...deps.practices().map(p => ({ kind: '固定做法', id: 'P:' + p.category, category: p.category, title: p.title, text: p.text, w: 3, meta: `v${p.version}` })),
    ...db.notes.filter(n => n.status !== '作废').map(n => ({ kind: n.status === '已采用' ? '已采用经验' : '待验证经验', id: n.id, category: n.category, title: n.title, text: n.text + ' ' + (n.evidence || ''), w: n.status === '已采用' ? 2 : 1, meta: `${pname(n.by)} ${n.at.slice(0, 10)}${n.status === '待验证' ? '（未经批准，仅供参考）' : ''}` })),
  ];
  return pool.map(x => { const t = (x.title + ' ' + x.category).toLowerCase(), b = x.text.toLowerCase(); let s = 0; for (const k of qs) { if (t.includes(k)) s += 3; if (b.includes(k)) s += 1; } if (category && x.category === category) s += 4; return { ...x, score: s * x.w }; })
    .filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
}

/* ───── 通知：每人一个通知箱（下次开对话／下一句话时由钩子带给他的 Claude，工作台的「任务」窗口也看得到）＋可选的手机推送 ───── */
const ownerId = () => (db.people.find(p => p.role === 'owner') || {}).id;
function notify(to, text, taskId, { push = true } = {}) {
  let p = person(to); if (p && p.disabled) { const heir = db.people.find(x => !x.disabled && x.role !== 'agent' && (x.takeover || []).includes(p.id)); const name = p.name; p = heir || person(ownerId()); if (!p || p.id === to) return; to = p.id; text = `（原本发给已停用的 ${name}）${text}`; }   /* 发给停用的人：转给接手他工作的人；没有接手的，转给所有者 */
  if (!p) return;
  db.inbox.unshift({ id: 'I-' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), to, at: now(), text: str(text, 400), taskId: taskId || '', read: false });
  if (db.inbox.length > 600) db.inbox.length = 600; save('inbox');
  const n = p.notify || {};
  if (!push || !n.target) return;
  /* 推送只发一句话（任务号＋标题）。ntfy＝手机装 ntfy App 订阅自己的主题；webhook＝任意能收 POST 的地址 */
  const go = n.kind === 'ntfy' ? fetch(`${(CFG.ntfyBase || 'https://ntfy.sh').replace(/\/+$/, '')}/${encodeURIComponent(n.target)}`, { method: 'POST', body: str(text, 300), signal: AbortSignal.timeout(6000) })
    : n.kind === 'webhook' && /^https?:\/\//.test(n.target) ? fetch(n.target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: str(text, 300), to: p.name, taskId }), signal: AbortSignal.timeout(6000) }) : null;
  if (go) go.catch(() => {});
}
/* 某人 3 天内各段对话小结里「没做完」的，合在一起去重（最新的在前） */
/* 同一件事在几段对话的小结里说法略有不同：去掉标点后，两句里连着的两个字有七成以上相同，就算同一件 */
const pkey = x => String(x || '').replace(/[\s\p{P}\p{S}]/gu, '').slice(0, 80);
const grams = k => { const g = new Set(); for (let i = 0; i < k.length - 1; i++) g.add(k.slice(i, i + 2)); return g; };
const codes = k => (k.match(/[A-Za-z0-9]+/g) || []).sort().join('|');
const CODE = /[A-Za-z0-9]+/g;
const overlap = (a, b) => { const A = grams(a), B = grams(b); let n = 0; for (const x of A) if (B.has(x)) n++; return { min: n / Math.max(1, Math.min(A.size, B.size)), max: n / Math.max(1, A.size, B.size) }; };
/* 是不是同一件事。编号（字母数字）必须一样；剩下的话：
   严（默认，用在任务查重、了结、候选、「不用了」、周清单）＝按长的那句算七成五相同——「确认消费税」和「确认法人税」不是一件；
   宽（用在「没做完的」去重和「不用了」、网站缺口、经验标题）＝短句九成在长句里，或按长句算七成 */
const psame = (a, b, loose = false) => { if (a === b) return true; if (codes(a) !== codes(b)) return false; const ra = a.replace(CODE, ''), rb = b.replace(CODE, ''); if (ra === rb) return true; if (ra.length < 4 || rb.length < 4) return false; const o = overlap(ra, rb); return loose ? o.min >= 0.9 || o.max >= 0.7 : o.max >= 0.75; };
const dismissedOf = pid => ((db.settings.dismissed || {})[pid] || []);
const dismiss = (pid, text) => { const k = pkey(text); if (!k) return; const m = (db.settings.dismissed = db.settings.dismissed || {}); const l = (m[pid] = m[pid] || []); if (!l.includes(k)) { l.push(k); if (l.length > 300) l.splice(0, l.length - 300); } };
const pendingOf = (pid, n = 8) => { const lim = ymd(new Date(Date.now() - 3 * 86400e3)), out = [], gone = dismissedOf(pid), seen = []; for (const g of db.digests) if (g.by === pid && g.date >= lim) for (const x of (g.pending || [])) { const k = pkey(x); if (!k || gone.some(y => psame(y, k, true)) || seen.some(y => psame(y, k, true)) || settled(pid, x, k)) continue; seen.push(k); out.push(x); } return out.slice(0, n); };
/* 这件「没做完的」其实已经了结：里面写的任务号已经完成或取消；或者和这个人最近 7 天做完的某个任务说的是一回事 */
function settled(pid, text, k) { const ids = String(text).match(/T-\d{4}/g) || []; if (ids.length && ids.every(id => { const t = db.tasks.find(x => x.id === id); return t && !OPEN.includes(t.status); })) return true; const lim = new Date(Date.now() - 7 * 86400e3).toISOString(); return db.tasks.some(t => t.assignee === pid && ((t.status === '完成' && (t.doneAt || '') >= lim) || OPEN.includes(t.status)) && psame(pkey(t.title), k)); }   /* 刚做完的，或者已经是一张开着的任务 */
/* ───── 三段简报：昨天做完／今天要做／还差（开对话时带给 Claude；早上和下班在同事电脑上弹窗；下班「发送资料」存成当天的交接报告）───── */
const trank = t => (t.level === '急' || (t.due && t.due < ymd()) ? 0 : t.due === ymd() ? 1 : t.status === '进行中' ? 2 : 3);
const tlabel = t => (t.status === '等确认' && t.check ? '待检查' : t.level === '急' || (t.due && t.due < ymd()) ? '急' : t.due === ymd() ? '今天' : t.status);
const trow = t => `- ${t.id}［${tlabel(t)}］${t.category}｜${clip(t.title, 80)}${t.due && t.due < ymd() ? `（到期 ${t.due}）` : ''}`;
const openOf = pid => db.tasks.filter(t => t.assignee === pid && OPEN.includes(t.status)).sort((a, b) => trank(a) - trank(b));
const doneOn = (pid, d) => [...new Set([...db.tasks.filter(t => t.assignee === pid && t.status === '完成' && dayOf(t.doneAt || t.updatedAt) === d).map(t => `${t.id} ${t.title}`), ...db.digests.filter(g => g.by === pid && g.date === d).flatMap(g => g.done)])];
/* 上一个有记录的日子（7 天内）：当天的交接报告优先，没有就用自动小结和做完的任务拼 */
function lastDay(pid) { for (let i = 1; i <= 7; i++) { const x = ymd(new Date(Date.now() - i * 86400e3)); const r = db.reports.find(q => q.by === pid && q.date === x); if (r) return { date: x, done: r.done }; const done = doneOn(pid, x); if (done.length) return { date: x, done }; } return null; }
const maybeLine = pid => { const a = db.cands.filter(c => c.by === pid && c.status === '待定').length, b = pendingOf(pid, 30).length; return a + b ? `另有 ${a + b} 条待定的（对话里提到要做的 ${a} 条、上次对话没做完的 ${b} 条）在菜单栏清单上，等本人点「接／记成任务」或「不用」。它们还不是任务：不要去做，也不用念。` : ''; };
const leftOf = (pid, open) => [...open.filter(t => t.status === '等确认').map(t => `- ${t.check ? '待你检查（Claude 做完了，在菜单栏清单上点「没问题」或「不对」）' : '等确认'}：${t.id} ${t.title}`), ...open.filter(t => t.rejectedNow && t.status !== '等确认').map(t => `- 检查没通过，要重做：${t.id} ${t.title}（${clip(t.rejectedNow, 80)}）`)];
function brief(p, part = 'morning') {
  const d = ymd(), open = openOf(p.id), L = [];
  if (part === 'evening') {
    const done = doneOn(p.id, d), left = open.filter(t => t.status === '进行中' || (t.due && t.due <= d)).map(trow);
    L.push(done.length ? `今天做完 ${done.length} 件：\n${done.slice(0, 10).map(x => '- ' + clip(x, 100)).join('\n')}` : '今天还没有做完的记录。');
    L.push(left.length ? `还差 ${left.length} 件：\n${left.slice(0, 8).join('\n')}` : '没有还差的。');
    return L.join('\n');
  }
  const last = lastDay(p.id), yd = ymd(new Date(Date.now() - 86400e3));
  L.push(last ? `${last.date === yd ? '昨天' : `上次（${last.date}）`}做完 ${last.done.length} 件：\n${last.done.slice(0, 8).map(x => '- ' + clip(x, 100)).join('\n')}` : '昨天没有工作记录。');
  const rs = db.reminders.filter(r => !r.sent && !r.cancelled && r.to === p.id && dayOf(r.at) === d).sort((x, y) => (x.at < y.at ? -1 : 1));
  const od = open.filter(t => t.due && t.due < d).length;
  L.push((open.length ? `今天要做 ${open.length} 件${od ? `（其中逾期 ${od} 件）` : ''}：\n${open.slice(0, 10).map(trow).join('\n')}` : '今天名下没有任务。') + (rs.length ? `\n今天定好的提醒：\n${rs.slice(0, 6).map(r => `- ${hhmm(new Date(r.at))} ${r.text}`).join('\n')}` : ''));
  const left = leftOf(p.id, open);
  L.push(left.length ? `还差：\n${left.slice(0, 8).join('\n')}` : '还差：没有。');
  const mb = maybeLine(p.id); if (mb) L.push(mb);
  return L.join('\n');
}
/* ───── 精简对话：各人电脑上做好的「人说的话＋Claude 回答的文字」，本人在报告页确认后才传上来，随当天的交接报告一起存。
   文字放 talks/人/日期/段.txt（只有本人、所有者、被指定接手的人能取），清单放 talks.json。留 365 天 ───── */
const TK = path.join(DATA, 'talks');
const talksOf = (pid, date) => db.talks.filter(t => t.by === pid && t.date === date).map(t => ({ session: t.session, title: t.title, turns: t.turns, chars: t.chars, at: t.at }));
const talkFile = t => path.join(TK, t.by, t.date, t.session + '.txt');
function talkPut(p, { session, date, title, turns }, text) {
  const sid = String(session || '').replace(/[^\w-]/g, '_').slice(0, 60), d = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : ymd();
  if (!sid) return { error: '缺 session' }; const body = String(text || '').replace(SECRET, '（已隐藏）'); if (body.length < 20) return { error: '内容是空的' };
  const t = { by: p.id, date: d, session: sid, title: str(title, 80).replace(SECRET, '（已隐藏）') || '（没有标题）', turns: Number(turns) || 0, chars: body.length, at: now() };
  try { fs.mkdirSync(path.dirname(talkFile(t)), { recursive: true, mode: 0o700 }); fs.writeFileSync(talkFile(t), body, { mode: 0o600 }); } catch (e) { return { error: '没存成：' + String(e.message || e).slice(0, 100) }; }
  db.talks = db.talks.filter(x => !(x.by === p.id && x.date === d && x.session === sid)); db.talks.unshift(t); if (db.talks.length > 20000) db.talks.length = 20000; save('talks');
  const rp = db.reports.find(x => x.by === p.id && x.date === d); if (rp) { rp.talks = talksOf(p.id, d); save('reports'); }   /* 报告先发、对话后到：补进报告 */
  return { ok: true, chars: t.chars };
}
function talkDrop(p, date, session) { const t = db.talks.find(x => x.by === p.id && x.date === date && x.session === session); if (!t) return false; try { fs.rmSync(talkFile(t), { force: true }); } catch {} db.talks = db.talks.filter(x => x !== t); save('talks'); const rp = db.reports.find(x => x.by === p.id && x.date === date); if (rp) { rp.talks = talksOf(p.id, date); save('reports'); } audit(p.name, '撤回对话', `${date} ${t.title}`); return true; }
const talkRead = (who, date, session) => { const t = db.talks.find(x => x.by === who.id && x.date === date && x.session === session); if (!t) return null; try { return { ...t, text: fs.readFileSync(talkFile(t), 'utf8') }; } catch { return null; } };
/* 当天的交接报告。先出草稿给本人看（reportDraft），本人可以去掉几条、补一句，确认了才存（reportMake，同一天再发就覆盖）。第二天早上的「昨天做完」从这里来 */
function reportDraft(p) {
  const d = ymd(), open = openOf(p.id);
  const doneT = db.tasks.filter(t => t.assignee === p.id && t.status === '完成' && dayOf(t.doneAt || t.updatedAt) === d), tasks = doneT.map(t => `${t.id} ${t.title}${t.result && !/^数据核实/.test(t.result) ? '：' + clip(t.result, 120) : ''}`);
  const talk = db.digests.filter(g => g.by === p.id && g.date === d).flatMap(g => g.done || []).filter(x => !sameAsTask(x, doneT));
  const bk = bkSum(p.id);
  return { date: d, done: [...new Set([...tasks, ...talk])].slice(0, 40), waiting: open.filter(t => t.status === '等确认' && t.check).map(t => `${t.id} ${t.title}`),
    pending: [...new Set([...open.filter(t => !(t.status === '等确认' && t.check) && (t.status === '进行中' || (t.due && t.due <= d))).map(t => `${t.id} ${t.title}`), ...pendingOf(p.id, 8)])].slice(0, 15),
    learned: db.notes.filter(n => n.by === p.id && dayOf(n.at) === d && n.status !== '作废').map(n => n.title).slice(0, 10), minutes: activeMin(p.id, d) + logMin(p.id, d), digests: db.digests.filter(g => g.by === p.id && g.date === d).length,
    backup: { files: bk.files, at: bk.at, host: bk.host }, talks: talksOf(p.id, d) };
}
function reportMake(p, { note, drop, client } = {}) {
  const f = reportDraft(p), prev = db.reports.find(x => x.by === p.id && x.date === f.date);
  if (note === undefined && prev) note = prev.note; if (drop === undefined && prev) drop = prev.dropped || [];   /* 没说要改的：沿用本人上次写的补充和去掉的条目 */
  const out = new Set(drop || []), keep = l => l.filter(x => !out.has(x));
  const c = client && typeof client === 'object' ? { talks: Number(client.sent) || 0, up: Number(client.up) || 0, files: (Array.isArray(client.files) ? client.files : []).map(x => str(x, 160)).slice(0, 30), failed: Number(client.failed) || 0 } : null;
  const r = { id: 'RP-' + Date.now().toString(36), by: p.id, date: f.date, at: now(), done: keep(f.done).slice(0, 30), waiting: f.waiting, pending: keep(f.pending).slice(0, 12), learned: f.learned.length, learnedTitles: f.learned, note: str(note, 1000).replace(SECRET, '（已隐藏）'), dropped: [...out].slice(0, 60), minutes: f.minutes, sessions: f.digests, backup: f.backup, client: c, talks: talksOf(p.id, f.date) };
  db.reports = db.reports.filter(x => !(x.by === p.id && x.date === f.date)); db.reports.unshift(r); if (db.reports.length > 800) db.reports.length = 800; save('reports');
  audit(p.name, '交接报告', `做完 ${r.done.length}・还差 ${r.pending.length}・学到 ${r.learned}・${r.minutes} 分钟`);
  return r;
}
/* 小结里这一句说的是不是已经算过的那个任务：写了它的任务号，或者和它的标题是同一件事 */
const sameAsTask = (text, ts) => { const ids = String(text).match(/T-\d{4}/g) || []; if (ids.some(id => ts.some(t => t.id === id))) return true; const k = pkey(text); return ts.some(t => psame(pkey(t.title), k, true)); };
/* 「我的今天」清单：一个人名下没做完的（排好急缓）、小结里没做完的、近 14 天做完的（按天）。菜单栏小程序、手机、浏览器看的都是这一份 */
const deptOf = c => Object.keys(DEPTS).find(k => DEPTS[k].includes(c)) || '运营';
function meState(p) {
  const d = ymd(), all = openOf(p.id), lim = ymd(new Date(Date.now() - 14 * 86400e3));
  const review = all.filter(t => t.status === '等确认' && t.check), open = all.filter(t => !review.includes(t));
  const done = db.tasks.filter(t => t.assignee === p.id && t.status === '完成' && dayOf(t.doneAt || t.updatedAt) >= lim).sort((a, b) => ((a.doneAt || a.updatedAt) < (b.doneAt || b.updatedAt) ? 1 : -1));
  const days = [], day = k => { let g = days.find(x => x.date === k); if (!g) days.push(g = { date: k, items: [], talk: [] }); return g; };
  for (const t of done) day(dayOf(t.doneAt || t.updatedAt)).items.push({ id: t.id, title: t.title, category: t.category, at: t.doneAt || t.updatedAt, result: clip(t.result, 200), verify: t.verify || '', auto: !!t.autoDone || /^数据核实/.test(t.result || ''), checked: !!(t.check && t.check.okAt), override: t.verify === 'override' });
  for (const g of db.digests) if (g.by === p.id && g.date >= lim) for (const x of (g.done || [])) { const dd = day(g.date); if (!dd.talk.some(y => y.text === x) && !sameAsTask(x, dd.items)) dd.talk.push({ text: x, at: g.at }); }   /* 不挂在任务上的工作：从各段对话的小结里来 */
  days.sort((a, b) => (a.date < b.date ? 1 : -1));
  const rp = db.reports.find(x => x.by === p.id && x.date === d), td = days.find(x => x.date === d);
  const view = t => ({ id: t.id, title: t.title, category: t.category, dept: deptOf(t.category), label: tlabel(t), status: t.status, due: t.due || '', overdue: !!(t.due && t.due < d), source: t.source, by: t.createdBy || '', detail: clip(t.detail, 300), result: clip(t.result, 600), checkAt: t.check ? t.check.at : '', rejects: t.rejectedNow ? (t.rejects || 1) : 0, why: clip(t.rejectedNow || '', 120), from: t.from && t.from.id !== p.id && t.assignee === p.id ? { by: t.from.by, reason: t.from.reason } : null, transfers: t.transfers || 0,
    rule: t.source === '规则' && /^(page|draft|cal):/.test(ruleBase(t.ruleKey)),
    back: (l => (l && /数据核实：后台显示还没做完/.test(l.text) ? l.text : ''))(t.log[t.log.length - 1]), canVerify: VERIFY.test(ruleBase(t.ruleKey)), ackOnly: ACK.test(ruleBase(t.ruleKey)) });
  return { me: { id: p.id, name: p.name }, today: d, prompt: promptOf(p),
    counts: { open: open.length, total: all.length, review: review.length, overdue: all.filter(t => t.due && t.due < d).length, doneToday: td ? td.items.length + td.talk.length : 0 },
    review: review.map(view), open: open.map(view),
    people: staff().filter(x => x.id !== p.id).map(x => ({ id: x.id, name: x.name, off: (x.off || []).includes(d) })),
    pending: pendingOf(p.id, 30), done: days,
    cands: db.cands.filter(c => c.by === p.id && c.status === '待定').slice(0, 15).map(c => ({ id: c.id, title: c.title, to: c.to ? pname(c.to) : '', toId: c.to, due: c.due, category: c.category, at: c.at })),
    reminders: db.reminders.filter(r => !r.sent && !r.cancelled && r.to === p.id && dayOf(r.at) === d).sort((x, y) => (x.at < y.at ? -1 : 1)).map(r => ({ at: hhmm(new Date(r.at)), text: r.text })),
    report: rp ? { at: rp.at, done: rp.done.length, pending: rp.pending.length } : null };
}
const promptOf = p => ({ on: !(p.prompt && p.prompt.on === false), morning: (p.prompt && p.prompt.morning) || '09:00', evening: (p.prompt && p.prompt.evening) || '18:00' });
const unread = id => db.inbox.filter(x => x.to === id && !x.read);
const markRead = (id, only) => { let n = 0; for (const x of db.inbox) if (x.to === id && !x.read && (!only || only.includes(x))) { x.read = true; n++; } if (n) save('inbox'); };   /* only＝只标这几条 */

/* ───── 任务 ───── */
const OPEN = ['待做', '进行中', '等确认'];
const assigneeFor = (category, prefer) => { const named = prefer && person(prefer); if (named && !named.disabled && named.role !== 'agent') return prefer; const p = (db.duties.map || {})[category], today = ymd(), pp = person(p); return pp && !pp.disabled && pp.role !== 'agent' && !(pp.off || []).includes(today) ? p : ownerId(); };
function taskCreate({ title, detail, category, assignee, source, ruleKey, ref, due, by, byId, level }) {
  category = CATEGORIES.includes(category) ? category : '其他';
  if (ruleKey && db.tasks.some(t => t.ruleKey === ruleKey && OPEN.includes(t.status))) return null;
  if (source === '智能体') { const k = str(title, 160).replace(/\s+/g, ''); if (db.tasks.some(t => OPEN.includes(t.status) && t.title.replace(/\s+/g, '') === k)) return null; }   /* 智能体排的：同名的还开着就不重复建 */   /* 同一条规则的任务还开着：不重复建 */
  const t = { id: 'T-' + String(++db.seq.task).padStart(4, '0'), title: str(title, 160), detail: str(detail, 4000), category, assignee: assigneeFor(category, assignee), status: '待做', source: source || '人派', ruleKey: ruleKey || '', ref: str(ref, 80), due: str(due, 10), level: level || '', createdBy: by || '工作台规则', createdById: byId || '', createdAt: now(), updatedAt: now(), log: [], result: '' };
  db.tasks.unshift(t); save('tasks'); save('seq'); audit(by || '工作台规则', '建任务', `${t.id} ${t.title} → ${pname(t.assignee)}（${t.source}）`);
  if (t.assignee !== byId) notify(t.assignee, `新任务 ${t.id}：${t.title}（${t.category}・${by || '工作台规则'} 派）`, t.id, { push: level !== '提前' });
  return t;
}
function taskUpdate(t, { status, note, result, assignee, refs }, who, whoId) {
  const was = { status: t.status, assignee: t.assignee };
  if (status && ['待做', '进行中', '等确认', '完成', '取消'].includes(status)) { t.status = status; if (status === '完成' && was.status !== '完成') t.doneAt = now(); if (was.status === '完成' && OPEN.includes(status)) t.reopened = (t.reopened || 0) + 1; if (status === '进行中' && !t.startedAt) t.startedAt = now(); }
  /* 结束信号要核实：后台数据能看出来的任务（发货・咨询・退货退款・商品页），标完成后去后台看一眼——没了就「已核实」，还在就重新打开 */
  if (t.status === '完成' && was.status !== '完成' && VERIFY.test(ruleBase(t.ruleKey)) && who !== VERIFIER) { t.verify = 'pending'; verifySoon(); }
  if (t.status !== '完成' && t.verify === 'pending') t.verify = '';
  if (OPEN.includes(t.status)) t.autoDone = false;
  if (t.status === '取消' && was.status !== '取消' && t.source === '规则' && /^(page|draft):/.test(ruleBase(t.ruleKey)) && who !== VERIFIER) mute(ruleBase(t.ruleKey), who, t.title);   /* 取消了它：这个对象以后不再提，免得下一次扫描又开一张 */
  if (assignee && person(assignee)) t.assignee = assignee;
  if (result) t.result = str(result, 4000);
  if (note || status || assignee) t.log.push({ at: now(), by: who, text: str([status && `状态→${status}`, assignee && `转给 ${pname(assignee)}`, note].filter(Boolean).join('；'), 600) });
  t.updatedAt = now();
  const made = [];
  if (refs && refs.length) t.refs = refs.slice(0, 20);
  const objs = (t.refs && t.refs.length ? t.refs : [t.ref]).filter(Boolean);
  if (t.status === '完成' && !t.chained && t.verify !== 'pending' && objs.length) {   /* 流程链：这一步做完，自动生成下一步，按分工表派。要核实的任务等核实过了才接下一步（scan 里）。没有款号就先不记「派过」 */
    t.chained = true;
    for (const c of (db.duties.chains || [])) if (c.from === t.category) for (const r of objs) { if (db.tasks.some(x => x.ruleKey === `chain:${c.to}:${r}`) || db.tasks.some(x => OPEN.includes(x.status) && x.ref === r && x.category === c.to)) continue;   /* 这一款的下一步已经派过，或者已经有一张同类开着（比如扫描先开了「没图」）：不再派 */   /* 这个对象的下一步已经派过（做完了、取消了都算）：不再派第二次 */
      const n = taskCreate({ byId: '', title: c.title.replace('{ref}', r), detail: `上一步：${t.id} ${t.title}（${pname(t.assignee)} 完成）。${t.result ? '\n上一步结果：' + clip(t.result, 600) : ''}`, category: c.to, source: '流程', ruleKey: `chain:${c.to}:${r}`, ref: r, by: '工作台规则' }); if (n) made.push(n); }
  }
  if (t.assignee !== was.assignee && t.assignee !== whoId) notify(t.assignee, `${who} 把任务 ${t.id} 转给你：${t.title}${t.from && t.from.reason ? `（${clip(t.from.reason, 80)}）` : ''}`, t.id);
  if (who !== VERIFIER && t.status !== was.status && (t.status === '完成' || (t.status === '等确认' && !t.check))) for (const to of new Set([t.createdById, ownerId()].filter(x => x && x !== whoId))) notify(to, `${who} 把 ${t.id} 标为${t.status}：${t.title}`, t.id, { push: t.status === '等确认' });
  save('tasks'); audit(who, '更新任务', `${t.id} ${status || ''} ${clip(note || result || '', 120)}`);
  return made;
}
/* 转交：把自己名下没做完的一件事交给另一个人，要写一句原因。立即生效，对方收到通知，记录里留痕；对方不接就同样转回来 */
function taskTransfer(t, toRef, reason, by) {
  const to = db.people.find(x => (x.id === toRef || x.name === toRef) && !x.disabled && x.role !== 'agent');
  if (!to) return { error: '没有这个人' };
  if (!OPEN.includes(t.status)) return { error: '已经结束的任务不能转交' };
  if (to.id === t.assignee) return { error: '已经在他名下' };
  const why = str(reason, 200); if (!why) return { error: '转交要写一句原因' };
  t.verifyBack = 0; t.transfers = (t.transfers || 0) + 1; t.from = { id: t.assignee, by: pname(t.assignee), reason: why, at: now() };
  if (t.status === '等确认' && t.check) { t.check = null; t.status = '进行中'; }   /* 还没检查的结果不带过去：接手的人重新确认 */
  taskUpdate(t, { assignee: to.id, note: `原因：${why}` }, by.name, by.id);
  return { ok: true, to: to.name };
}
/* 任务下面的留言：负责人和派的人来回说话，对方会收到通知 */
function taskComment(t, text, p) {
  t.log.push({ at: now(), by: p.name, byId: p.id, kind: '留言', text: str(text, 1000) }); t.updatedAt = now(); save('tasks');
  const to = p.id === t.assignee ? (t.createdById && t.createdById !== p.id ? t.createdById : ownerId()) : t.assignee;
  if (to && to !== p.id) notify(to, `${p.name} 在 ${t.id} 留言：${clip(text, 160)}`, t.id);
  audit(p.name, '任务留言', `${t.id} ${clip(text, 120)}`);
}
/* 领任务时给 Claude 的整包：任务＋这类任务的固定做法＋相关经验。做法随任务推过去，不靠它想起来去查 */
function taskPack(t) {
  const p = deps.practices().find(x => x.category === t.category);
  const rel = search(`${t.title} ${t.ref}`, { category: t.category }).filter(x => x.kind !== '固定做法').slice(0, 5);
  return { task: { id: t.id, title: t.title, detail: t.detail, category: t.category, status: t.status, assignee: pname(t.assignee), ref: t.ref, due: t.due, source: t.source, log: t.log.slice(-8) },
    practice: p ? { title: p.title, version: p.version, text: p.text } : null,
    related_notes: rel.map(x => ({ id: x.id, kind: x.kind, title: x.title, text: clip(x.text, 500), from: x.meta })),
    how: '照「固定做法」做；做法里没写的事实不要编。做完用 task_update 把状态改成 完成 并写 result（必填：做了什么、证据），它会进本人清单的「待你检查」，本人确认才算完成；学到新东西用 remember 记一条；发现做法该改用 propose_practice 提出（要 Souki 批准才生效）。' };
}

/* ───── 规则引擎：后台数据＋日历 → 任务（程序算，不经模型） ───── */
const CAT_OF = id => /^svc:ship/.test(id) ? '订单发货' : /^svc:inq/.test(id) ? '客服咨询' : /^svc:(ret|ref|sref)/.test(id) ? '退换货退款' : /^svc:low/.test(id) ? '库存' : /^(page|draft):/.test(id) ? '商品页' : /^cal:/.test(id) ? '税务行政' : /^m[es]:/.test(id) ? '月结借入' : '其他';
const scanState = { at: 0, items: [], error: '', made: 0 };
/* 数据核实：哪些规则的任务能从后台数据看出「做完了没有」。库存预警只能「知道了」（补货到货前数据不会变），日历和月结看不出来 */
/* 「待发货」和「待发货超时」是同一件事的两种急缓（咨询、退货同理）：算一类，不然一超时就会「旧的自动结束＋新开一张」 */
const fam = id => String(id || '').replace(/^(svc:(?:ship|inq|ret))0(?=$|:)/, '$1');
const VERIFY = /^(svc:(ship|inq|ret|ref|sref)$|page:|draft:)/, ACK = /^svc:low$/, VERIFIER = '工作台核实';
const ruleBase = k => { const x = fam(k); return /^(svc:|m[es]:)/.test(x) ? x.replace(/:\d{4}-\d{2}-\d{2}$/, '') : x; };
let verifyT = null;
const verifySoon = () => { if (verifyT) return; verifyT = setTimeout(() => { verifyT = null; scan(VERIFIER).catch(() => {}); }, Number(process.env.DADI_VERIFY_MS) || 45000); verifyT.unref(); };
setInterval(() => { if (db.tasks.some(t => (OPEN.includes(t.status) && (VERIFY.test(ruleBase(t.ruleKey)) || ACK.test(ruleBase(t.ruleKey)))) || t.verify === 'pending')) scan(VERIFIER).catch(() => {}); }, 15 * 60000).unref();   /* 有要核实的：每 15 分钟看一次后台 */
const lowItems = t => String(t || '').split('：').slice(1).join('：').split('；').map(x => x.trim()).filter(Boolean);
const mute = (base, by, title) => { (db.settings.muted = db.settings.muted || {})[base] = { by, at: now(), title: clip(title, 80) }; save('settings'); };
/* 扫描一次只跑一个：正在跑的时候再叫，就等那一次的结果（定时的、打勾后 45 秒的、人手点的可能撞在一起） */
let scanRun = null;
let scanBy = '';
function scan(by = '工作台规则') {
  if (!scanRun) { scanBy = by; scanRun = scanOnce(by).finally(() => { scanRun = null; }); return scanRun; }
  if (by !== VERIFIER && scanBy === VERIFIER) { const prev = scanRun; scanBy = by; scanRun = prev.catch(() => {}).then(() => scanOnce(by)).finally(() => { scanRun = null; }); }   /* 正在跑的是核实那种：人点的、每天早上的要做的事更多（每周清单等），排在后面再跑一次 */
  return scanRun;
}
/* 规则→任务。原则：同一件事同时只有一张开着的；反复扫多少次结果都一样；做完的不因为再扫一次而冒出来。
   每日类（svc:*）：还开着就只刷新标题和急缓；做完并核实过、后来又出现＝新的一次，才再开。
   按对象的（page:／draft:）：同上；本人坚持做完（被重开过一次后再打勾）就按他的算，并且不再提这个对象。
   按期限的（cal:／me:／ms:／复查／每周清单）：一个期限只提一次，做完、取消了都不再提。 */
async function scanOnce(by) {
  const t0 = now();   /* 这次数据是什么时候取的：之后才打的勾、才开的任务，留给下一次判断 */
  const raw = (process.env.DADI_TEST_ITEMS && readJson(process.env.DADI_TEST_ITEMS)) || await SK.computeToday(rules());   /* 测试时可以从文件给「后台现在的情况」 */
  const items = raw.map(x => ({ ...x, id: fam(x.id) }));
  if (process.env.DADI_TEST_SCAN_DELAY && fs.existsSync(process.env.DADI_TEST_SCAN_DELAY)) await new Promise(r => setTimeout(r, 700));   /* 只给测试用：模拟「后台慢，取数和处理之间隔了一会儿」 */
  let made = 0, closed = 0, changed = false;
  const noLogin = items.some(x => x.id === 'login'), bad = items.filter(x => /:nodata$|:err$/.test(x.id)).map(x => x.id), present = new Set(items.map(x => x.id));
  /* 这次哪一类没读到：svc:nodata／service:err＝整个服务类；page:nodata／no_page:err＝商品页类；svc:sref:nodata＝只有店铺退款。没读到的那一类一律不核实 */
  const notRead = base => noLogin || (/^svc:/.test(base) && bad.some(b => b === 'svc:nodata' || b === 'service:err' || (b === 'svc:sref:nodata' && base === 'svc:sref'))) || (/^(page|draft):/.test(base) && bad.some(b => b === 'page:nodata' || b === 'no_page:err'));
  /* 哪几类这次真的查过后台：对应的提醒模版开着才算。模版停用了＝没查，不能当成「后台已经没有了」 */
  const on = new Set(); for (const t of (process.env.DADI_TEST_ITEMS && readJson(process.env.DADI_TEST_ITEMS) ? [{ kind: 'remind', checks: readJson(process.env.DADI_TEST_CHECKS || '') || ['service', 'no_page'] }] : rules())) if (t.kind === 'remind' && t.status !== '停用') for (const c of (t.checks || [])) on.add(c);
  const checked = base => !notRead(base) && (/^svc:/.test(base) ? on.has('service') : /^(page|draft):/.test(base) ? on.has('no_page') : false);
  const lim30 = ymd(new Date(Date.now() - 30 * 86400e3)), sameRule = (t, id) => !!t.ruleKey && ruleBase(t.ruleKey) === id;
  const once = (key, o) => { if (db.tasks.some(t => t.ruleKey === key)) return; if (taskCreate({ ...o, ruleKey: key, source: '规则', by })) made++; };   /* 这个编号的任务有过就不再建（做完、取消了也算） */
  for (let it of items) {
    if (it.id === 'login' || /:nodata$|:err$/.test(it.id)) continue;
    if ((db.settings.muted || {})[it.id]) continue;   /* 本人点过「不用再提」的：不再开任务 */
    const daily = /^svc:/.test(it.id), perObject = /^(page|draft):/.test(it.id);
    if (VERIFY.test(it.id)) {
      const back = db.tasks.find(t => t.status === '完成' && t.verify === 'pending' && sameRule(t, it.id) && (t.doneAt || '') <= t0);
      if (back && !(back.verifyBack >= 1)) {   /* 标了完成但后台还有：重新打开一次，告诉本人 */
        back.verifyBack = 1; back.title = str(it.text, 160);
        taskUpdate(back, { status: '待做', note: `数据核实：后台显示还没做完（${clip(it.text, 80)}），重新打开` }, VERIFIER, '');
        notify(back.assignee, `${back.id} 标了完成，但后台显示还没做完：${clip(it.text, 100)}。已重新打开；确实不用做就再打一次勾。`, back.id); continue;
      }
      if (back) {   /* 重开过一次，本人又打了勾：按他说的算，不再来回。按对象的规则顺便记成「不用再提」 */
        back.verify = 'override'; back.overrideText = str(it.text, 160); back.chained = true; back.verifyBack = 0;   /* 后台没变：不派流程的下一步 */
        back.log.push({ at: now(), by: VERIFIER, text: '后台显示还有，但本人两次确认做完：按本人的算，不再重开' });
        if (perObject) mute(it.id, pname(back.assignee), back.title); changed = true; continue;
      }
      if (db.tasks.some(t => t.status === '完成' && t.verify === 'pending' && sameRule(t, it.id))) continue;   /* 取数之后才打的勾：这一次先不判断，也不另开一张，等下一次 */
      if (daily && db.tasks.some(t => t.status === '完成' && t.verify === 'override' && sameRule(t, it.id) && dayOf(t.doneAt) === ymd() && t.overrideText === str(it.text, 160))) continue;   /* 今天本人已经坚持做完过、后台还是那个样子：今天不再开。数字变了（来了新的）才再提 */
      if (daily && db.tasks.some(t => t.status === '取消' && sameRule(t, it.id) && dayOf(t.updatedAt) === ymd())) continue;   /* 今天这张被取消过：今天不再开 */
    }
    if (ACK.test(it.id)) {   /* 库存预警：点过「知道了」的那几款（同一款、同样剩几件）不再提，只提新出现的或又变少的 */
      const split = x => { const m = /^(.*) 剩 (\d+)$/.exec(x); return m ? [m[1], +m[2]] : [x, 0]; }, acked = new Map();
      for (const t of db.tasks) if (t.status === '完成' && !t.autoDone && !/^数据核实/.test(t.result || '') && sameRule(t, it.id) && dayOf(t.doneAt || t.updatedAt) >= lim30) for (const x of (t.lowItems || lowItems(t.title))) { const [n, c] = split(x); if (!acked.has(n) || c < acked.get(n)) acked.set(n, c); }
      const all = lowItems(it.text), fresh = all.filter(x => { const [n, c] = split(x); return !acked.has(n) || c < acked.get(n); });   /* 没点过的，或者比点的时候更少了 */
      if (all.length && !fresh.length) { for (const t of [...db.tasks]) if (OPEN.includes(t.status) && !(t.status === '等确认' && t.check) && sameRule(t, it.id) && t.createdAt <= t0) { t.autoDone = true; taskUpdate(t, { status: '完成', note: '数据核实：现在预警的都是点过「知道了」的，自动结束。', result: t.result ? '' : '数据核实：现在预警的都是点过「知道了」的，自动结束。' }, VERIFIER, ''); closed++; } continue; }
      it = { ...it, items: fresh, full: fresh.length > 4 ? `全部 ${fresh.length} 款：${fresh.join('；')}` : '', text: `库存预警 ${fresh.length} 款${fresh.length < all.length ? '（新出现的）' : ''}：${fresh.slice(0, 4).join('；')}${fresh.length > 4 ? ' 等' : ''}` };
    }
    const slug = (/^(?:page|draft):(.+)$/.exec(it.id) || [])[1] || '', sameObj = t => !!slug && OPEN.includes(t.status) && t.ref === slug && t.category === '商品页' && !sameRule(t, it.id);
    if (perObject && db.tasks.some(sameObj)) continue;   /* 这一款已经有一张开着的商品页任务（流程派的、人派的、或另一条规则的）：不另开 */
    const open = db.tasks.find(t => OPEN.includes(t.status) && sameRule(t, it.id));
    if (open && person(open.assignee) && person(open.assignee).disabled) { const to = assigneeFor(open.category); taskUpdate(open, { assignee: to, note: `原负责人已停用，按分工表转给 ${pname(to)}` }, '工作台规则', ''); changed = true; }
    if (open) {   /* 已经有一张开着的：只把标题、急缓刷新成现在的样子，不再开 */
      const title = str(it.text, 160), due = it.due || open.due;
      if (open.title !== title || (it.level && open.level !== it.level) || open.due !== due || (it.items && JSON.stringify(open.lowItems || []) !== JSON.stringify(it.items))) { open.title = title; if (it.level) open.level = it.level; open.due = due; if (it.items) { open.lowItems = it.items; open.detail = `来源规则：${it.name}。${it.full ? '\n' + it.full : ''}${it.open ? '\n后台页面：' + it.open : ''}`; } open.updatedAt = now(); changed = true; }
      continue;
    }
    if (!daily && !perObject && db.tasks.some(t => sameRule(t, it.id))) continue;   /* 按期限的（税务日历、月结）：这个期限提过一次就不再提，做完了也不因为再扫一次而冒出来 */
    const ref = (/^(?:page|draft):(.+)$/.exec(it.id) || [])[1] || '';
    const t = taskCreate({ title: it.text, detail: `来源规则：${it.name}。${it.full ? '\n' + it.full : ''}${it.open ? '\n后台页面：' + it.open : ''}`, category: CAT_OF(it.id), source: '规则', ruleKey: daily ? `${it.id}:${ymd()}` : it.id, ref, due: it.due || (it.level === '提前' ? '' : ymd()), level: it.level, by });
    if (t) { if (it.items) t.lowItems = it.items; made++; }
  }
  if (new Date().getDay() === 1 && ownerId() && by !== VERIFIER) once(`weekly-review:${weekId()}`, { title: '做本周的改进清单：对你的 Claude 说「做这周的改进清单」', detail: 'Claude 会读这一周的统计（做完几件、一次通过率、被退回的原因、逾期、网站缺口、资料没交上来的、规则没起作用的），写 3–8 条改进，每条定去向：任务／规则／网站／不处理。下周先报上周每条的结果。', category: '其他', assignee: ownerId(), due: ymd() });
  for (const n of db.notes) if (n.status === '已采用' && n.recheckBy && n.recheckBy <= ymd()) once(`recheck:${n.id}:${n.recheckBy}`, { title: `复查经验 ${n.id}：${n.title}`, detail: `这条经验到了复查日期（${n.recheckBy}）。还对就在工作台「任务→经验」里把复查日期往后改；不对了就让 Claude 用 remember 记一条新的并写 supersedes=${n.id}。\n\n${n.text}`, category: '其他', assignee: ownerId() });
  for (const t of [...db.tasks]) {   /* 后台读得到的时候才核实；读不到一律不动。这次取数之后才开的任务、才打的勾，留给下一次 */
    const base = ruleBase(t.ruleKey); if (!base || present.has(base) || !checked(base)) continue;
    if (t.status === '等确认' && t.check) continue;   /* Claude 交上来等本人检查的：留给本人点，不替他结束（他点了「没问题」再核实） */
    const autoEnd = why => { t.autoDone = true; taskUpdate(t, { status: '完成', note: why, result: t.result ? '' : why }, VERIFIER, ''); closed++; };   /* 已经写了结果的不盖掉 */
    if (ACK.test(base)) { if (OPEN.includes(t.status) && t.createdAt <= t0) autoEnd('数据核实：后台已经没有这条预警了，自动结束。'); continue; }
    if (!VERIFY.test(base)) continue;
    if (OPEN.includes(t.status) && t.createdAt <= t0) { autoEnd('数据核实：后台里这件事已经没有了，自动结束。'); t.verify = 'ok'; }
    else if (t.status === '完成' && t.verify === 'pending' && (t.doneAt || '') <= t0) { t.verify = 'ok'; t.verifyBack = 0; taskUpdate(t, {}, VERIFIER, ''); closed++; }   /* 核实过了：这时才接流程的下一步 */
  }
  if (closed || changed) save('tasks');
  Object.assign(scanState, { at: Date.now(), items, error: noLogin ? '后台没有登录，和后台有关的规则算不出来' : bad.length ? '后台有接口这次没读到，那一类先不核实：' + bad.join('、') : '', made });
  if (by !== VERIFIER || made || closed) audit(by, '规则扫描', `${items.length} 条提醒，新建 ${made} 个任务${closed ? `，核实结束 ${closed} 个` : ''}`);
  return scanState;
}
/* 每天早上扫一次＋备份；9 点以后才开机就开机 30 秒后补 */
const daily = readJson(F('daily')) || { scan: '', backup: '' };
async function dailyJobs() {
  const d = ymd();
  if (daily.backup !== d) { backup(); daily.backup = d; writeJson(F('daily'), daily); }
  if (daily.scan !== d && new Date().getHours() >= CFG.scanHour && Date.now() - (daily.tryAt || 0) > 30 * 60000) { daily.tryAt = Date.now(); try { await scan(); } catch (e) { scanState.error = String(e.message || e); } if (!scanState.error) daily.scan = d; writeJson(F('daily'), daily); try { healthJob(); } catch {} }   /* 没读到后台：半小时后再试 */
}
function backup() {   /* 每天一份到 数据目录/backups/日期/，留 30 天。整台机器的备份另用时间机器和外接硬盘 */
  const dir = path.join(DATA, 'backups', ymd()); fs.mkdirSync(dir, { recursive: true });
  for (const n of ['people', 'duties', 'tasks', 'notes', 'digests', 'inbox', 'files', 'beats', 'worklog', 'reminders', 'reports', 'talks', 'cands', 'gaps', 'weekly', 'settings', 'seq']) { try { fs.copyFileSync(F(n), path.join(dir, n + '.json')); } catch {} }
  try { fs.copyFileSync(path.join(DATA, 'company.md'), path.join(dir, 'company.md')); } catch {}
  try { const all = fs.readdirSync(path.join(DATA, 'backups')).sort(); for (const old of all.slice(0, Math.max(0, all.length - 30))) fs.rmSync(path.join(DATA, 'backups', old), { recursive: true, force: true }); } catch {}
  try { const lim = ymd(new Date(Date.now() - 365 * 86400e3)); const old = db.talks.filter(t => t.date < lim); if (old.length) { for (const t of old) { try { fs.rmSync(talkFile(t), { force: true }); } catch {} } db.talks = db.talks.filter(t => t.date >= lim); save('talks'); } } catch {}   /* 精简对话留 365 天 */
  try { const lim = ymd(new Date(Date.now() - 60 * 86400e3)); for (const pid of fs.readdirSync(BK)) { const h = path.join(BK, pid, 'history'); if (fs.existsSync(h)) for (const day of fs.readdirSync(h)) if (day < lim) fs.rmSync(path.join(h, day), { recursive: true, force: true }); } } catch {}   /* 同事电脑备份里被覆盖的旧版：留 60 天 */
}
setInterval(() => dailyJobs().catch(() => {}), 60000).unref();
setTimeout(() => dailyJobs().catch(() => {}), 30000).unref();

/* ───── 经验：待验证 → 已采用（并进固定做法）／作废 ───── */
function noteAdd({ title, text, category, evidence, taskId, kind, supersedes, recheckDays, auto }, who) {
  const n = { id: 'N-' + String(++db.seq.note).padStart(4, '0'), kind: kind === '改做法' ? '改做法' : '经验', title: str(title, 120), text: str(text, 3000), category: CATEGORIES.includes(category) ? category : '其他', evidence: str(evidence, 600), taskId: str(taskId, 12), by: who, at: now(), status: '待验证', supersedes: db.notes.some(x => x.id === supersedes) ? supersedes : '', recheckBy: Number(recheckDays) > 0 ? ymd(new Date(Date.now() + Number(recheckDays) * 86400e3)) : '', auto: !!auto };
  db.notes.unshift(n); save('notes'); save('seq'); audit(who, n.kind === '改做法' ? '提议改做法' : '记经验', `${n.id} ${n.title}`);
  return n;
}
function noteDecide(n, ok, who) {
  n.status = ok ? '已采用' : '作废'; n.decidedBy = who; n.decidedAt = now();
  if (ok) {   /* 批准：写进这一类的固定做法，版本加一；以后谁领这类任务都会带上 */
    const line = `- [${n.id}] ${n.at.slice(0, 10)}（${pname(n.by)}）${n.title}：${n.text.replace(/\n+/g, ' ')}`;
    if (n.supersedes) { const old = db.notes.find(x => x.id === n.supersedes); if (old) { old.status = '作废'; old.supersededBy = n.id; } }   /* 取代旧的一条：旧的作废，模版里那一行也拿掉 */
    deps.practiceAppend(n.category, line, n.supersedes || '', who);   /* 写进这一类的模版（固定做法），版本加一 */
  }
  save('notes'); audit(who, ok ? '批准经验' : '作废经验', `${n.id} ${n.title}`);
}

/* ───── 后台（alaco.ai）：读要 backend_read；写要 backend_write 并过硬规则；全部记日志 ───── */
async function backend(p, method, pth, body) {
  pth = String(pth || '');
  if (!okPath(pth)) return { status: 400, data: { message: '路径要以 /admin/ 开头' } };
  if (closedPath(pth)) return { status: 403, data: { message: '账号和登录相关的接口不能从这里读写' } };
  if (method === 'GET') { if (!can(p, 'backend_read')) return { status: 403, data: { message: `${p.name} 没有读后台的权限` } }; return adminCall('GET', pth); }
  if (!can(p, 'backend_write')) return { status: 403, data: { message: `${p.name} 没有改后台的权限，请把这件事交给有权限的人（task_create）` } };
  const why = guardJudge('mcp__alaco__admin_write', { method, path: pth, body });
  if (why) { audit(p.name, '硬规则拦下', `${method} ${pth}：${why}`); return { status: 403, data: { message: `硬规则：不允许${why}。这类事只能人在后台手动做。` } }; }
  const r = await adminCall(method, pth, method === 'DELETE' ? undefined : (body || {}));
  audit(p.name, '改后台', `${method} ${pth} → HTTP ${r.status}`);
  return r;
}

/* ═════ 同事的工作状态・时间・提醒・电脑备份・派活智能体（v26） ═════
   数据都从各人自己的 Claude Code 自动来：钩子每次开对话、每句话、每次答完各报一声（只报时间和所在文件夹，不报说了什么）；
   后台小助手每分钟取一次到点的提醒、每 15 分钟把记忆・规则・技能・指定的工作文件夹备份过来。 */
const saveQ = k => writeJson(F(k), db[k]);   /* 只存盘，不惊动页面 */
const dayOf = iso => (iso ? ymd(new Date(iso)) : '');
const daysBack = n => Array.from({ length: n }, (_, i) => ymd(new Date(Date.now() - i * 86400e3)));
const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const fmtWhen = d => `${ymd(d) === ymd() ? '今天' : ymd(d)} ${hhmm(d)}`;
let beatT = null;
function beat(p, { session, ev, cwd } = {}) {
  const d = ymd(), me = (db.beats[p.id] = db.beats[p.id] || { days: {}, last: null });
  const day = (me.days[d] = me.days[d] || { t: [], s: [], e: '' }); const sec = Math.floor(Date.now() / 1000); const code = { start: 's', prompt: 'p', stop: 'o', end: 'e', compact: 'c', work: 'w' }[ev] || 'x'; if (typeof day.e !== 'string') day.e = 'x'.repeat(day.t.length);
  const was = me.last ? Date.now() - Date.parse(me.last.at) : Infinity;
  const li = day.t.length - 1;
  if (li < 0 || sec - day.t[li] >= 20 || day.e[li] !== code) { day.t.push(sec); day.e += code; }
  if (session) { const s = String(session).slice(0, 40); if (!day.s.includes(s)) { day.s.push(s); if (day.s.length > 80) day.s.shift(); } }
  me.last = { at: now(), ev: str(ev, 12), where: path.basename(str(cwd, 300)) };
  const keep = Object.keys(me.days).sort().slice(-40); for (const k of Object.keys(me.days)) if (!keep.includes(k)) delete me.days[k];
  if (!beatT) beatT = setTimeout(() => { beatT = null; saveQ('beats'); }, 5000);
  if (was > 10 * 60000 || ev === 'end') { try { deps.onChange(); } catch {} }
}
/* 和 Claude 一起干活的时间：相邻两次心跳隔不到 10 分钟算连续在做，隔得久的只算 1 分钟。
   Claude 自己连续干很久时，后台每分钟看它有没有在写对话记录，在写就报一声（w），所以长任务也是连续的；
   说完一句话后既没有答完、也没有 w（多半是按 Esc 打断了），那一段最多算 20 分钟 */
function activeMin(pid, d) { const day = (((db.beats[pid] || {}).days || {})[d] || {}), t = day.t, e = typeof day.e === 'string' ? day.e : ''; if (!t || !t.length) return 0; let s = 60; for (let i = 1; i < t.length; i++) { const g = t[i] - t[i - 1]; s += g <= 600 ? g : e[i - 1] === 'p' || e[i - 1] === 'c' ? Math.min(g, 1200) : 60; } return Math.round(s / 60); }
const logMin = (pid, d) => db.worklog.filter(w => w.by === pid && w.date === d).reduce((a, w) => a + w.minutes, 0);

/* ───── 定时提醒：自己定、所有者定、派活智能体定；到点进通知箱（同事电脑弹桌面通知，下一句话时 Claude 也会说）＋手机推送 ───── */
function parseWhen(v) {
  v = str(v, 40); let m; const ok = (h, mi) => h >= 0 && h < 24 && mi >= 0 && mi < 60;
  if ((m = /^(\d{1,2})[:：](\d{2})$/.exec(v))) { if (!ok(+m[1], +m[2])) return null; const d = new Date(); d.setHours(+m[1], +m[2], 0, 0); if (d.getTime() < Date.now() - 60000) d.setDate(d.getDate() + 1); return d; }
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2})[:：](\d{2})$/.exec(v))) { if (!ok(+m[4], +m[5])) return null; const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]); return d.getMonth() === +m[2] - 1 && d.getDate() === +m[3] ? d : null; }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(v)) { const d = new Date(v); return isNaN(d) ? null : d; }   /* 带时区的完整时间（程序传的） */
  return null;
}
function remindAdd(p, { to, at, text, taskId }) {
  const who = to ? db.people.find(x => (x.id === to || x.name === to) && !x.disabled && x.role !== 'agent') : (p.role === 'agent' ? null : p);
  if (!who) return { error: '没有这个人' };
  if (who.id !== p.id && !['owner', 'agent'].includes(p.role)) return { error: '只能给自己定提醒；要提醒别人，在任务下面留言' };
  const when = parseWhen(at); if (!when) return { error: '时间写成 15:00 或 2026-11-11 15:00' };
  if (when.getTime() < Date.now() - 60000) return { error: '这个时间已经过了' };
  const txt = str(text, 300); if (!txt) return { error: '提醒什么要写清楚' };
  const tid = String(taskId || '').toUpperCase(), iso = when.toISOString();
  if (db.reminders.some(r => !r.sent && !r.cancelled && r.to === who.id && r.at === iso && r.text === txt)) return { error: '已经有一条一样的提醒' };
  if ((who.off || []).includes(ymd(when))) return { error: `${who.name} 那天休息` };
  const r = { id: 'R-' + String(++db.seq.rem).padStart(4, '0'), to: who.id, at: iso, text: txt, taskId: db.tasks.some(t => t.id === tid) ? tid : '', by: p.id, sent: false, createdAt: now() };
  db.reminders.unshift(r); save('reminders'); save('seq'); audit(p.name, '定提醒', `${r.id} → ${who.name} ${fmtWhen(when)} ${clip(txt, 80)}`);
  return { ok: true, id: r.id, to: who.name, at: fmtWhen(when) };
}
function remindTick() {
  let n = 0; for (const r of db.reminders) if (!r.sent && !r.cancelled && Date.parse(r.at) <= Date.now()) { const rt = r.taskId && db.tasks.find(t => t.id === r.taskId); if (rt && !OPEN.includes(rt.status)) { r.cancelled = true; n++; continue; }   /* 那个任务已经结束了：不响 */
    r.sent = true; n++; notify(r.to, `提醒：${r.text}${r.taskId ? `（${r.taskId}）` : ''}`, r.taskId); }
  if (n) { db.reminders = db.reminders.filter(r => !(r.sent || r.cancelled) || Date.now() - Date.parse(r.at) < 14 * 86400e3); save('reminders'); }
}
setInterval(() => { try { remindTick(); } catch {} }, 20000).unref();

/* ───── 同事电脑的备份：记忆・规则・技能・指定的工作文件夹。每人一棵 current/，被覆盖的旧版每天留一份在 history/日期/（留 60 天）。只增不删：电脑坏了、人走了，这里还在 ───── */
const BK = path.join(DATA, 'backup');
const bkDir = pid => path.join(BK, pid);
const bkCache = new Map();
const bkGet = pid => { if (!bkCache.has(pid)) bkCache.set(pid, readJson(path.join(bkDir(pid), 'manifest.json')) || { meta: {}, files: {} }); return bkCache.get(pid); };
const bkTimers = new Map();
const bkSoon = pid => { if (bkTimers.has(pid)) return; bkTimers.set(pid, setTimeout(() => { bkTimers.delete(pid); try { bkWrite(pid); } catch {} }, 2000)); };
const bkWrite = pid => { const m = bkGet(pid); fs.mkdirSync(bkDir(pid), { recursive: true, mode: 0o700 }); writeJson(path.join(bkDir(pid), 'manifest.json'), m); };
const safeRel = rel => { const parts = String(rel || '').split('/').filter(Boolean); if (!parts.length || parts.length > 24 || parts.some(s => s === '.' || s === '..' || s.length > 200 || /[\x00-\x1f\\]/.test(s))) return null; return parts.join('/'); };
const okRoot = r => /^[\p{L}\p{N}_.\-]{1,60}$/u.test(String(r || '')) && !/^\.+$/.test(r);
const BK_QUOTA = Number(process.env.DADI_BK_QUOTA) || 5 * 1024 ** 3;
const bkBytes = m => Object.values(m.files).reduce((a, v) => a + (v.size || 0), 0);
function bkPut(p, root, rel, buf) {
  rel = safeRel(rel); if (!okRoot(root) || !rel) return { error: '路径不对' };
  const key = `${root}/${rel}`, m = bkGet(p.id), cur = path.join(bkDir(p.id), 'current', key), h = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
  try {
    if (m.files[key] && m.files[key].sha === h && fs.existsSync(cur)) return { ok: true, same: true };
    if (bkBytes(m) - ((m.files[key] || {}).size || 0) + buf.length > BK_QUOTA) return { error: '这个人在主机上的备份已到 5GB 上限，没有再收。少备份几个工作文件夹，或让 Souki 调大上限' };
    if (fs.existsSync(cur)) { const old = path.join(bkDir(p.id), 'history', ymd(), key); if (!fs.existsSync(old)) { fs.mkdirSync(path.dirname(old), { recursive: true, mode: 0o700 }); fs.renameSync(cur, old); } else if (fs.statSync(cur).isDirectory()) fs.renameSync(cur, old + '.' + Date.now()); }
    for (let d = path.dirname(cur); d.length > bkDir(p.id).length; d = path.dirname(d)) if (fs.existsSync(d) && !fs.statSync(d).isDirectory()) { const old = path.join(bkDir(p.id), 'history', ymd(), path.relative(path.join(bkDir(p.id), 'current'), d)); fs.mkdirSync(path.dirname(old), { recursive: true, mode: 0o700 }); fs.renameSync(d, fs.existsSync(old) ? old + '.' + Date.now() : old); delete m.files[path.relative(path.join(bkDir(p.id), 'current'), d).split(path.sep).join('/')]; }
    fs.mkdirSync(path.dirname(cur), { recursive: true, mode: 0o700 }); fs.writeFileSync(cur, buf, { mode: 0o600 });
  } catch (e) { return { error: '没存成：' + String(e.message || e).slice(0, 120) }; }
  m.files[key] = { size: buf.length, sha: h, at: now() }; bkSoon(p.id);
  return { ok: true };
}
function bkDone(p, b) {
  const m = bkGet(p.id); const up = Number(b.uploaded) || 0;
  m.meta = { host: str(b.host, 80), user: str(b.user, 40), home: str(b.home, 200), claudeDir: str(b.claudeDir, 200), folders: (Array.isArray(b.folders) ? b.folders : []).map(x => str(x, 200)).slice(0, 20), lastSync: now(), seen: Number(b.count) || 0, errors: Number(b.errors) || 0, firstError: str(b.firstError, 200), lastUpload: up ? now() : (m.meta.lastUpload || '') };
  delete m.n; clearTimeout(bkTimers.get(p.id)); bkTimers.delete(p.id); bkWrite(p.id); if (up) { audit(p.name, '备份', `${up} 个文件有变化（共 ${Object.keys(m.files).length} 个）`); try { deps.onChange(); } catch {} }
}
const bkWho = (me, person) => { if (!person) return me; const t = db.people.find(x => x.id === person || x.name === person); return t && (t.id === me.id || me.role === 'owner' || (me.takeover || []).includes(t.id)) ? t : null; };   /* 自己的；所有者能取所有人的；被指定接手的人能取前任的 */
const bkList = p => { const m = bkGet(p.id); return { person: p.name, meta: m.meta, files: Object.entries(m.files).map(([k, v]) => ({ path: k, size: v.size, at: v.at })) }; };
const bkPath = (p, key) => { const i = String(key || '').indexOf('/'); const root = String(key || '').slice(0, i), rel = safeRel(String(key || '').slice(i + 1)); if (i < 1 || !okRoot(root) || !rel) return null; const f = path.join(bkDir(p.id), 'current', root, rel); return fs.existsSync(f) && fs.statSync(f).isFile() ? f : null; };
const bkSum = pid => { const m = bkGet(pid); let bytes = 0; const roots = {}; for (const [k, v] of Object.entries(m.files)) { bytes += v.size; const r = k.split('/')[0]; roots[r] = (roots[r] || 0) + 1; } return { at: m.meta.lastSync || '', lastUpload: m.meta.lastUpload || '', files: Object.keys(m.files).length, bytes, roots, host: m.meta.host || '', errors: m.meta.errors || 0, firstError: m.meta.firstError || '' }; };

/* ───── 每个同事一行：状态・任务进度・今天的进度・时间・认真程度（只用能算出来的数）・贡献・解决了什么・还没解决什么 ───── */
function personView(p) {
  const d = ymd(), b = db.beats[p.id] || { days: {}, last: null };
  const mine = db.tasks.filter(t => t.assignee === p.id), open = mine.filter(t => OPEN.includes(t.status));
  const doneIn = days => mine.filter(t => t.status === '完成' && days.includes(dayOf(t.doneAt || t.updatedAt)));
  const d14 = daysBack(14), d7 = daysBack(7), d3 = daysBack(3), done14 = doneIn(d14), withDue = done14.filter(t => t.due);
  const dig = db.digests.filter(g => g.by === p.id);
  const lastAt = b.last ? Date.parse(b.last.at) : 0, ago = Date.now() - lastAt, doing = open.find(t => t.status === '进行中');
  const tmin = x => activeMin(p.id, x) + logMin(p.id, x);
  return {
    id: p.id, name: p.name, role: p.role, off: (p.off || []).includes(d),
    status: !lastAt ? 'never' : ago < 10 * 60000 && b.last.ev !== 'end' ? 'on' : dayOf(b.last.at) === d ? 'today' : 'off', lastAt: b.last ? b.last.at : '', where: b.last ? b.last.where : '',
    doing: doing ? `${doing.id} ${doing.title}` : '',
    tasks: { open: open.length, doing: open.filter(t => t.status === '进行中').length, overdue: open.filter(t => t.due && t.due < d).length, waiting: open.filter(t => t.status === '等确认').length },
    today: { planned: mine.filter(t => (OPEN.includes(t.status) && (!t.due || t.due <= d)) || (t.status === '完成' && dayOf(t.doneAt || t.updatedAt) === d)).length, done: doneIn([d]).length },
    time: { today: tmin(d), offline: logMin(p.id, d), week: d7.reduce((a, x) => a + tmin(x), 0), days: [...d7].reverse().map(x => ({ d: x.slice(5), m: tmin(x) })) },
    care: { done: done14.length, onTime: withDue.length ? Math.round(withDue.filter(t => dayOf(t.doneAt || t.updatedAt) <= t.due).length * 100 / withDue.length) : null, reopened: mine.filter(t => d14.includes(dayOf(t.updatedAt))).reduce((a, t) => a + (t.reopened || 0), 0), evidence: done14.length ? Math.round(done14.filter(t => str(t.result) || db.files.some(f => f.taskId === t.id)).length * 100 / done14.length) : null, activeDays: d7.filter(x => ((b.days[x] || {}).t || []).length).length, digestDays: d7.filter(x => dig.some(g => g.date === x)).length },
    contrib: { done7: doneIn(d7).length, done30: doneIn(daysBack(30)).length, notes: db.notes.filter(n => n.by === p.id && n.status === '已采用').length, notesPending: db.notes.filter(n => n.by === p.id && n.status === '待验证').length, files: db.files.filter(f => f.by === p.id).length },
    solved: [...doneIn(d3).map(t => ({ at: t.doneAt || t.updatedAt, text: `${t.id} ${t.title}${t.result ? '：' + clip(t.result, 120) : ''}` })), ...dig.filter(g => d3.includes(g.date)).flatMap(g => g.done.map(x => ({ at: g.at, text: x })))].sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, 8).map(x => x.text),
    unsolved: [...open.filter(t => t.due && t.due < d).map(t => `逾期：${t.id} ${t.title}（到期 ${t.due}）`), ...open.filter(t => t.status === '等确认').map(t => `等确认：${t.id} ${t.title}`), ...pendingOf(p.id).map(x => `上次没做完：${x}`)].slice(0, 8),
    digests: dig.slice(0, 5).map(g => ({ date: g.date, at: g.at, auto: !!g.auto, done: g.done, pending: g.pending || [], learned: g.learned.length })),
    worklog: db.worklog.filter(w => w.by === p.id).slice(0, 5).map(w => ({ date: w.date, minutes: w.minutes, what: w.what })),
    backup: bkSum(p.id), week: (w => ({ done: w.做完的任务, talk: w.对话里做完的, pass: w.一次通过率, rejected: w.被退回的.length }))(weekStats(p.id)), health: healthList(ymd(new Date(Date.now() - 86400e3))).filter(x => x.id === p.id).map(x => x.问题).concat(p.health && p.health.sumError ? [`本机整理小结失败：${clip(p.health.sumError, 80)}`] : []).filter((x, i, a) => a.indexOf(x) === i),
    report: (r => (r ? { at: r.at, done: r.done.length, pending: r.pending.length, learned: r.learned, minutes: r.minutes } : null))(db.reports.find(x => x.by === p.id && x.date === d)), prompt: promptOf(p),
    reports: db.reports.filter(x => x.by === p.id).slice(0, 7).map(r => ({ date: r.date, at: r.at, done: r.done, pending: r.pending, note: r.note || '', learned: r.learnedTitles || [], talks: r.talks || talksOf(p.id, r.date) })),
    reminders: db.reminders.filter(r => !r.sent && !r.cancelled && r.to === p.id).sort((x, y) => (x.at < y.at ? -1 : 1)).slice(0, 4).map(r => ({ id: r.id, at: r.at, text: r.text, taskId: r.taskId })),
  };
}
const staff = () => db.people.filter(p => p.role !== 'agent' && !p.disabled);
const teamView = () => staff().map(personView);

/* ───── 派活智能体：主机上的一个 Claude，每天几次读主机里的数据，给每个人排任务和提醒。它只排活，不干活、不改后台 ───── */
const AGENT_TOOLS = ['team_overview', 'task_list', 'task_create', 'task_comment', 'remind', 'admin_get', 'recall', 'brief'];
const dcfg = () => ({ enabled: false, times: ['09:05', '13:00', '17:00'], model: 'sonnet', ...(db.settings.dispatch || {}) });
const dispatchState = { running: false };
function agentPerson() {
  let a = db.people.find(p => p.role === 'agent'); const kf = path.join(DATA, 'agent.key');
  if (!a) { a = { id: 'agent', name: '派活智能体', role: 'agent', caps: ['backend_read', 'see_all'], keyHash: '', off: [], createdAt: now() }; db.people.push(a); }
  let key = ''; try { key = fs.readFileSync(kf, 'utf8').trim(); } catch {}
  if (!key || a.keyHash !== sha(key)) { key = 'dk_' + crypto.randomBytes(18).toString('base64url'); a.keyHash = sha(key); fs.writeFileSync(kf, key + '\n', { mode: 0o600 }); save('people'); }
  return { a, key };
}
function overview() {
  const d = new Date(), W = '日一二三四五六';
  return { now: `${ymd(d)} 星期${W[d.getDay()]} ${hhmm(d)}`, company_facts: clip(company(), 1500),
    duties: Object.fromEntries(Object.entries(db.duties.map || {}).map(([k, v]) => [k, pname(v)])),
    people: teamView().map(v => ({ name: v.name, role: v.role === 'owner' ? '所有者' : '成员', off_today: v.off, status: { on: '正在用 Claude', today: '今天来过', off: '今天还没上线', never: '还没接入' }[v.status], last_active: v.lastAt ? fmtWhen(new Date(v.lastAt)) : '', doing: v.doing, tasks: v.tasks, today: v.today, minutes_today: v.time.today,
      open_tasks: db.tasks.filter(t => t.assignee === v.id && OPEN.includes(t.status)).slice(0, 25).map(t => ({ id: t.id, title: t.title, category: t.category, status: t.status, due: t.due, level: t.level, source: t.source, last: (t.log[t.log.length - 1] || {}).text || '' })),
      unfinished_from_last_digest: v.unsolved.filter(x => x.startsWith('上次没做完')), solved_recently: v.solved.slice(0, 5), reminders_pending: v.reminders.map(r => `${fmtWhen(new Date(r.at))} ${r.text}`) })),
    waiting_for_approval: db.notes.filter(n => n.status === '待验证').length,
    rule_items_today: scanState.items.filter(x => x.id !== 'login').slice(0, 20).map(x => x.text) };
}
const DISPATCH_PROMPT = () => `你是大地株式会社（ALA&CO）的「派活智能体」，跑在公司主机上。你的工作只有一件：读主机里的数据，给每位同事排今天的任务和提醒。你不干具体的活，不改网站后台。

步骤：
1. 调用 team_overview：里面有现在的时间、分工表、每个人名下没做完的任务、逾期的、上次小结里没做完的事、已经定好的提醒、谁今天休息。
2. 对每个人：
   - 「上次没做完」的事，如果他名下还没有对应的任务，用 task_create 建一个，派给他本人。
   - 逾期和今天到期的任务，用 remind 给他定提醒，时间写成 HH:MM，要在现在之后；下午再留一次看进度的提醒。同一件事已经有提醒就不要再加。
   - 「等确认」的任务，提醒该确认的人（通常是 Souki）。
3. 需要时用 admin_get 看网站后台有没有该做而任务表里没有的事（待发货订单、没回的咨询），有就按分工表 task_create。
4. 最后调用 brief，用中文给 Souki 写一份简报：每人一行（今天做什么、卡在哪），然后列出要 Souki 决定的事。不超过 15 行。

规矩：任务表里已有的不要重复建；一次最多新建 8 个任务、12 条提醒；只能派给 team_overview 里列出的人，今天休息的人不派也不提醒；分不清归谁就派给 Souki，并在说明里写清为什么；提醒要具体到任务号和要做的动作；没有要排的就只写简报。`;
async function dispatch(by) {
  if (dispatchState.running) return { error: '正在排，等它做完' };
  dispatchState.running = true; dispatchState.made = 0; dispatchState.rems = 0; const t0 = Date.now(); let before = { task: db.seq.task, rem: db.seq.rem }; try { deps.onChange(); } catch {}
  let last;
  try {
    const { key } = agentPerson(); try { await scan('工作台规则'); } catch {}
    before = { task: db.seq.task, rem: db.seq.rem };   /* 规则建的任务不算在智能体头上 */
    const f = path.join(DATA, 'agent-mcp.json'); fs.writeFileSync(f, JSON.stringify({ mcpServers: { 'dadi-brain': { type: 'http', url: `http://127.0.0.1:${deps.port()}/mcp`, headers: { Authorization: 'Bearer ' + key } } } }), { mode: 0o600 });
    const r = await deps.runAgent({ prompt: DISPATCH_PROMPT(), mcp: f, tools: AGENT_TOOLS.map(n => 'mcp__dadi-brain__' + n), model: dcfg().model, maxTurns: 30 });
    last = { at: now(), by, ok: !!r.ok, sec: Math.round((Date.now() - t0) / 1000), text: clip(r.text || r.error || '', 3000), tasks: db.seq.task - before.task, reminders: db.seq.rem - before.rem };
  } catch (e) { last = { at: now(), by, ok: false, sec: Math.round((Date.now() - t0) / 1000), text: String((e && e.message) || e), tasks: 0, reminders: 0 }; }
  db.settings.dispatchLast = last; db.settings.dispatchLog = [{ ...last, text: clip(last.text, 300) }, ...(db.settings.dispatchLog || [])].slice(0, 30); save('settings');
  audit('派活智能体', last.ok ? '排了一次' : '没排成', `${by}・${last.sec} 秒・新任务 ${last.tasks}・新提醒 ${last.reminders}${last.ok ? '' : '・' + clip(last.text, 120)}`);
  dispatchState.running = false; try { deps.onChange(); } catch {}
  return last;
}
function dispatchSlots() {   /* 到点（或开机晚了、三小时内）就排一次；每个时间点一天只排一次 */
  const c = dcfg(); if (!c.enabled || dispatchState.running) return; const d = ymd(), n = new Date();
  for (const tm of c.times) { const m = /^(\d{1,2}):(\d{2})$/.exec(tm); if (!m) continue; const at = new Date(); at.setHours(+m[1], +m[2], 0, 0); const late = n - at, slot = `${d} ${tm}`;
    if (late >= 0 && late < 3 * 3600e3 && !(daily.slots || {})[slot]) { daily.slots = { ...Object.fromEntries(Object.entries(daily.slots || {}).filter(([k]) => k.startsWith(d))), [slot]: 1 }; writeJson(F('daily'), daily); dispatch('定时 ' + tm).catch(() => {}); return; } }
}
setInterval(() => { try { dispatchSlots(); } catch {} }, 60000).unref();

/* ───── 给 Claude Code／Codex 的工具（MCP） ───── */
/* ═════ 第二大脑（需求 3）：收上来的资料反过来用 ═════
   ① 任务候选：每段对话做小结时，同一个模型顺带挑出「答应要做的／要别人做的／在等回复的」，放进本人清单让他点〔接〕或〔不用〕。不会自动派出去。
   ② 网站缺口：对话里出现「网站后台没有这个功能、只能手工做」的，记一条；同一件事再出现就计数加一。也可以对 Claude 说「记一个网站缺口」。
   ③ 一周统计（程序算，不经模型）：做完几件、一次通过率、被退回的原因、转交、逾期、时间。本人问「我这周怎么样」、所有者做每周改进清单都用它。
   ④ 每周改进清单：所有者对自己的 Claude 说「做这周的改进清单」→ Claude 读统计写 3–8 条 → 每条必须有去向（任务／规则／网站／不处理）→ 下一周先报上一周每条的结果。
   ⑤ 资料没交上来：昨天用了 Claude 却没有小结、两天没备份、本机小结整理失败 → 提醒本人，汇总告诉所有者。 */
const personOf = s => { const x = String(s || '').trim(); if (!x || /^(我|自己|本人)$/.test(x)) return null; return staff().find(p => p.name === x || x.includes(p.name)) || null; };
function candAdd(me, c, session) {
  const title = str(c && c.title, 160).replace(SECRET, '（已隐藏）'); if (!title) return null; const k = pkey(title);
  const lim = new Date(Date.now() - 14 * 86400e3).toISOString();
  if (db.tasks.some(t => t.status !== '取消' && (OPEN.includes(t.status) || (t.updatedAt || '') >= lim) && psame(pkey(t.title), k))) return null;   /* 已经是任务了，或者两周内刚做完 */
  if (db.cands.some(x => x.by === me.id && x.at >= lim && psame(pkey(x.title), k))) return null;   /* 两周内提过（接了、不用了都算）：不再提 */
  const to = personOf(c.who); const due = /^\d{4}-\d{2}-\d{2}$/.test(String(c.due || '')) ? c.due : '';
  const x = { id: 'C-' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), by: me.id, title, to: to && to.id !== me.id ? to.id : '', who: str(c.who, 30), due, category: CATEGORIES.includes(c.category) ? c.category : '其他', session: str(session, 60), at: now(), status: '待定' };
  db.cands.unshift(x); if (db.cands.length > 3000) db.cands.length = 3000; return x;
}
function gapAdd(by, text, { from = '对话', detail = '' } = {}) {
  const t = str(text, 200).replace(SECRET, '（已隐藏）'); if (!t) return null; const k = pkey(t);
  const old = db.gaps.find(g => g.status !== '不做' && psame(pkey(g.text), k, true));
  if (old) { old.count = (old.count || 1) + 1; old.lastAt = now(); if (!old.people.includes(by)) old.people.push(by); save('gaps'); return old; }
  const g = { id: 'W-' + String(db.gaps.length + 1).padStart(3, '0'), text: t, detail: str(detail, 1000), from, people: [by], count: 1, at: now(), lastAt: now(), status: '待看' };
  db.gaps.unshift(g); save('gaps'); return g;
}
const hoursOf = t => (t.doneAt && t.createdAt ? Math.round((Date.parse(t.doneAt) - Date.parse(t.createdAt)) / 3600e3) : null);
const rejectsOf = t => t.log.filter(l => /检查不通过：/.test(l.text)).map(l => l.text.replace(/^.*检查不通过：/, ''));
/* 一周统计。pid 空＝全员 */
function weekStats(pid, days = 7) {
  const ds = daysBack(days), lim = ds[ds.length - 1], inW = iso => !!iso && dayOf(iso) >= lim;
  const mine = t => !pid || t.assignee === pid;
  const done = db.tasks.filter(t => mine(t) && t.status === '完成' && inW(t.doneAt || t.updatedAt));
  const checked = done.filter(t => t.check && t.check.okAt);
  const cats = {}; for (const t of done) { const c = (cats[t.category] = cats[t.category] || { 做完: 0, 检查过: 0, 一次通过: 0, 被退回次数: 0, 平均小时: 0, _h: [] }); c.做完++; if (t.check && t.check.okAt) { c.检查过++; if (t.passFirst) c.一次通过++; } c.被退回次数 += t.rejects || 0; const h = hoursOf(t); if (h != null) c._h.push(h); }
  for (const c of Object.values(cats)) { c.平均小时 = c._h.length ? Math.round(c._h.reduce((a, b) => a + b, 0) / c._h.length) : null; c.一次通过率 = c.检查过 ? Math.round(c.一次通过 * 100 / c.检查过) + '%' : '还没有检查过的'; delete c._h; }
  const open = db.tasks.filter(t => mine(t) && OPEN.includes(t.status)), d = ymd();
  const rejected = db.tasks.filter(t => mine(t) && t.status !== '取消' && (t.rejects || 0) > 0 && inW(t.updatedAt)).map(t => ({ 任务: `${t.id} ${t.title}`, 类别: t.category, 原因: rejectsOf(t) }));
  const talkDone = db.digests.filter(g => (!pid || g.by === pid) && g.date >= lim).reduce((a, g) => a + (g.done || []).filter(x => !sameAsTask(x, done.filter(t => t.assignee === g.by))).length, 0);
  const people = pid ? [person(pid)] : staff();
  const time = people.filter(Boolean).map(p => ({ 人: p.name, 分钟: ds.reduce((a, x) => a + activeMin(p.id, x) + logMin(p.id, x), 0), 交接报告天数: db.reports.filter(r => r.by === p.id && r.date >= lim).length, 小结份数: db.digests.filter(g => g.by === p.id && g.date >= lim).length }));
  return {
    期间: `${lim} ～ ${d}`, 做完的任务: done.length, 对话里做完的: talkDone, 按类别: cats,
    一次通过率: checked.length ? Math.round(checked.filter(t => t.passFirst).length * 100 / checked.length) + `%（${checked.length} 件检查过）` : '还没有检查过的任务',
    被退回的: rejected.slice(0, 20), 转交: db.tasks.filter(t => (t.transfers || 0) > 0 && inW(t.updatedAt) && (!pid || t.assignee === pid || (t.from && t.from.id === pid))).map(t => `${t.id} ${t.title}：${t.from ? `${t.from.by} 转出，原因：${t.from.reason}` : ''}`).slice(0, 15),
    现在逾期: open.filter(t => t.due && t.due < d).map(t => `${t.id} ${t.category}｜${t.title}（到期 ${t.due}）`),
    任务候选: { 提出: db.cands.filter(c => (!pid || c.by === pid) && inW(c.at)).length, 接了: db.cands.filter(c => (!pid || c.by === pid) && inW(c.at) && c.status === '接了').length, 没处理: db.cands.filter(c => (!pid || c.by === pid) && c.status === '待定').length },
    经验: { 新提出: db.notes.filter(n => (!pid || n.by === pid) && inW(n.at)).length, 采用: db.notes.filter(n => (!pid || n.by === pid) && n.status === '已采用' && inW(n.decidedAt)).length, 等批准: db.notes.filter(n => (!pid || n.by === pid) && n.status === '待验证').length },
    时间: time,
  };
}
/* 规则批了，同一类之后还在被退回：说明这条规则没起作用 */
function rulesNotWorking() {
  const out = [];
  for (const n of db.notes.filter(n => n.status === '已采用' && n.decidedAt && Date.now() - Date.parse(n.decidedAt) < 45 * 86400e3)) {
    const rule = grams(pkey(n.title + n.text)), about = why => { const g = grams(pkey(why)); if (g.size < 2) return false; let k = 0; for (const x of g) if (rule.has(x)) k++; return k / g.size >= 0.3; };   /* 退回的原因里三成以上的字和这条规则重合：说的是同一件事 */
    const hits = []; for (const t of db.tasks) if (t.category === n.category && t.status !== '取消') for (const l of t.log) if (/检查不通过：/.test(l.text) && l.at > n.decidedAt) { const why = l.text.replace(/^.*检查不通过：/, ''); if (about(why)) hits.push(`${t.id}：${why}`); }
    if (hits.length) out.push({ 规则: `${n.id} ${n.title}`, 类别: n.category, 批准于: n.decidedAt.slice(0, 10), 之后又因为同一件事被退回: hits.slice(0, 5) });
  }
  return out;
}
const weekId = (d = new Date()) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x); };   /* 这一周的星期一 */
function itemState(it) {
  if (it.fate === '任务') { const t = db.tasks.find(x => x.id === it.ref); return t ? `${t.status}${t.status === '完成' ? '' : `（${pname(t.assignee)}）`}` : '任务不在了'; }
  if (it.fate === '规则') { const n = db.notes.find(x => x.id === it.ref); return n ? n.status : '不在了'; }
  if (it.fate === '网站') { const g = db.gaps.find(x => x.id === it.ref); return g ? g.status : '不在了'; }
  return '不处理';
}
function weeklyView(w) { return w ? { 周: w.week, 写于: w.at.slice(0, 16).replace('T', ' '), 条目: w.items.map(it => ({ 问题: it.text, 原因: it.why, 去向: it.fate, 编号: it.ref || '', 现在: itemState(it) })) } : null; }
function teamReview() {
  const prs = deps.practices(), noPractice = CATEGORIES.filter(c => c !== '其他' && !prs.some(x => x.category === c));
  const last = db.weekly.find(w => w.week < weekId()) || null;
  return { 全员: weekStats(null), 每个人: staff().map(p => ({ 人: p.name, ...weekStats(p.id) })).map(x => ({ 人: x.人, 做完: x.做完的任务, 对话里做完: x.对话里做完的, 一次通过率: x.一次通过率, 被退回: x.被退回的.length, 逾期: x.现在逾期.length, 时间: x.时间[0] })),
    规则没起作用: rulesNotWorking(), 待批准的经验: db.notes.filter(n => n.status === '待验证').length, 还没有固定做法的类别: noPractice,
    到期该复查的经验: db.notes.filter(n => n.status === '已采用' && n.recheckBy && n.recheckBy <= ymd()).map(n => `${n.id} ${n.title}（${n.recheckBy}）`),
    网站缺口: db.gaps.filter(g => g.status === '待看').map(g => `${g.id} ${g.text}（提到 ${g.count} 次）`).slice(0, 20),
    资料没交上来: healthList(), 上一周的改进清单: weeklyView(last), 这一周已经写过: weeklyView(db.weekly.find(w => w.week === weekId())) };
}
function weeklySave(me, items) {
  const wk = weekId(), out = [], prev = (db.weekly.find(w => w.week === wk) || { items: [] }).items;
  for (const it of (Array.isArray(items) ? items : []).slice(0, 12)) {
    const text = str(it && it.text, 300), fate = ['任务', '规则', '网站', '不处理'].includes(it && it.fate) ? it.fate : ''; if (!text || !fate) continue;
    const x = { text, why: str(it.why, 400), fate, ref: '' };
    const same = prev.find(o => o.fate === fate && o.ref && psame(pkey(o.text), pkey(text))); if (same) { x.ref = same.ref; out.push(x); continue; }   /* 这一周已经存过这一条：沿用原来的任务／规则／缺口，不再建一份 */
    if (fate === '任务') { const who = it.assignee ? (db.people.find(q => q.id === it.assignee || q.name === it.assignee) || {}).id : ''; const t = taskCreate({ title: text, detail: [x.why && `原因：${x.why}`, str(it.detail, 1500)].filter(Boolean).join('\n'), category: it.category, assignee: who, source: '改进清单', by: me.name, byId: me.id, ruleKey: `weekly:${wk}:${pkey(text).slice(0, 20)}` }); x.ref = t ? t.id : ''; }
    if (fate === '规则') { const n = noteAdd({ title: text, text: str(it.detail, 2000) || x.why || text, category: it.category, evidence: `每周改进清单 ${wk}` }, me.id); x.ref = n.id; }
    if (fate === '网站') { const g = gapAdd(me.id, text, { from: '改进清单', detail: str(it.detail, 1000) || x.why }); x.ref = g ? g.id : ''; }
    out.push(x);
  }
  if (!out.length) return { error: '每条要有 text 和 fate（任务／规则／网站／不处理）' };
  db.weekly = db.weekly.filter(w => w.week !== wk); db.weekly.unshift({ week: wk, at: now(), by: me.id, items: out }); if (db.weekly.length > 104) db.weekly.length = 104; save('weekly');
  audit(me.name, '每周改进清单', `${wk}：${out.length} 条（${out.map(x => x.fate).join('・')}）`);
  return { ok: true, week: wk, items: out.map(x => ({ ...x, 现在: itemState(x) })) };
}
/* 资料没交上来：昨天用了 Claude（有心跳）却没有任何小结；两天以上没备份；本机小结整理失败（小助手每分钟报上来） */
function healthList(day) {
  const y = day || ymd(new Date(Date.now() - 86400e3)), out = [];
  for (const p of staff()) {
    const used = ((((db.beats[p.id] || {}).days || {})[y] || {}).s || []).length > 0,   /* 用 Claude Code 开过对话（钩子报的对话编号）才算：工作台里的 ask ala 不交小结 */ b = bkSum(p.id), h = p.health || {};
    if (used && !db.digests.some(g => g.by === p.id && g.date === y) && !db.reports.some(r => r.by === p.id && r.date === y)) out.push({ 人: p.name, id: p.id, 问题: `${y} 用了 Claude，但一份小结都没交上来`, 办法: '在终端跑 ~/.dadi-brain/dadi status 看原因；多半是 claude 命令行没登录（claude auth login）' });
    if (b.at && Date.now() - Date.parse(b.at) > 2 * 86400e3 && used) out.push({ 人: p.name, id: p.id, 问题: `记忆和规则两天以上没备份（上次 ${b.at.slice(0, 10)}）`, 办法: '在终端跑 ~/.dadi-brain/dadi sync 看报什么' });
    if (h.sumError && Date.now() - Date.parse(h.at || 0) < 86400e3) out.push({ 人: p.name, id: p.id, 问题: `本机整理小结失败：${clip(h.sumError, 80)}`, 办法: /auth|登录|login/i.test(h.sumError) ? '在终端跑 claude auth login' : '在终端跑 ~/.dadi-brain/dadi status' });
  }
  return out;
}
function healthJob() {
  const d = ymd(); if ((db.settings.healthDay || '') === d) return; db.settings.healthDay = d; save('settings');
  const l = healthList(); if (!l.length) return;
  for (const x of l) notify(x.id, `资料没交上来：${x.问题}。${x.办法}`, '', { push: false });
  const o = ownerId(); if (o) notify(o, `资料没交上来 ${l.length} 处：${l.map(x => `${x.人}・${x.问题}`).join('；').slice(0, 300)}`, '', { push: false });
}
const TOOLS = [
  { name: 'brain_start', description: '开工先调用：返回公司固定事实、我名下没做完的任务（按急缓）、等我处理的事。每段对话开始时调用一次。', inputSchema: { type: 'object', properties: {} } },
  { name: 'task_get', description: '领一个任务：返回任务详情＋这一类任务的「固定做法」＋相关经验。开始做任何任务前必须先调用，然后照固定做法做。', inputSchema: { type: 'object', properties: { id: { type: 'string', description: '任务编号，如 T-0003' } }, required: ['id'] } },
  { name: 'task_list', description: '列任务。默认只列我名下没做完的；all=true 列全公司没做完的；status 可指定 待做／进行中／等确认／完成。', inputSchema: { type: 'object', properties: { all: { type: 'boolean' }, status: { type: 'string' }, category: { type: 'string' } } } },
  { name: 'task_update', description: '更新任务：开始做时 status=进行中；做完 status=完成 并且必须在 result 写结果和证据（做了什么、后台回读到什么、文件在哪）——它会进本人清单的「待你检查」，本人点了「没问题」才算完成，点「不对」会带着原因退回来重做；卡住了写 note 说明。refs 写这次产生的对象（如新款号 g-2026018），确认完成后工作台按流程链自动建下一步任务。转交给别人：assignee 写对方名字，note 写一句原因。', inputSchema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['待做', '进行中', '等确认', '完成', '取消'] }, note: { type: 'string' }, result: { type: 'string' }, refs: { type: 'array', items: { type: 'string' } }, assignee: { type: 'string', description: '转交给谁（名字）' } }, required: ['id'] } },
  { name: 'task_create', description: `建一个任务（人说「这件事记一下／派给某人」时用）。category 从这里选：${CATEGORIES.join('／')}。不写 assignee 就按分工表派。`, inputSchema: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' }, category: { type: 'string' }, assignee: { type: 'string', description: '成员 id 或名字，可不填' }, ref: { type: 'string' }, due: { type: 'string', description: 'YYYY-MM-DD，可不填' } }, required: ['title', 'category'] } },
  { name: 'task_comment', description: '在任务下面留言（问派活的人一个问题、回复对方、说明卡在哪）。对方会收到通知。', inputSchema: { type: 'object', properties: { id: { type: 'string' }, text: { type: 'string' } }, required: ['id', 'text'] } },
  { name: 'remind', description: '定一个到点的提醒（同事说「三点提醒我发货」「明天上午提醒我给税理士回信」时用）。at 写 15:00（今天，过了就是明天）或 2026-11-11 15:00。不写 to 就是提醒自己；只有所有者能提醒别人。到点会在对方电脑弹通知，他下一句话时助手也会告诉他。', inputSchema: { type: 'object', properties: { at: { type: 'string' }, text: { type: 'string', description: '提醒什么，写具体：任务号＋要做的动作' }, to: { type: 'string', description: '成员 id 或名字，可不填' }, task_id: { type: 'string' } }, required: ['at', 'text'] } },
  { name: 'work_log', description: '记一段不在电脑上做的工作时间（打包、接待客人、跑银行、盘点）。同事说「刚才打包了一小时」时用。', inputSchema: { type: 'object', properties: { minutes: { type: 'number' }, what: { type: 'string', description: '做了什么，一句话' }, task_id: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD，不写就是今天' } }, required: ['minutes', 'what'] } },
  { name: 'team_overview', description: '（只有所有者和派活智能体能用）全员现状：每个人的状态、名下任务、逾期、上次没做完的事、已定的提醒、分工表。', inputSchema: { type: 'object', properties: {} } },
  { name: 'brief', description: '（只有所有者和派活智能体能用）写今天给 Souki 的简报，显示在工作台「任务→同事」最上面。', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'file_list', description: '查存在公司 Mac mini 上的存档文件（报价单、图片、做好的资料）。返回编号，取回用命令 ~/.dadi-brain/dadi get <编号> <保存位置>。', inputSchema: { type: 'object', properties: { query: { type: 'string' }, task_id: { type: 'string' } } } },
  { name: 'recall', description: '查公司的经验和固定做法（以前怎么做的、踩过什么坑、某个供应商／税务口径）。遇到不确定的公司事务先查这里，查不到再问人。', inputSchema: { type: 'object', properties: { query: { type: 'string' }, category: { type: 'string' } }, required: ['query'] } },
  { name: 'remember', description: '做完一件事后，把学到的公司经验记一条（状态是「待验证」，Souki 批准后才会变成固定做法）。只记公司的事：做法、坑、供应商习惯、口径。不记私事、不记密码和钥匙。evidence 写凭什么说它对（回读结果、对方原话、文件）。', inputSchema: { type: 'object', properties: { title: { type: 'string', description: '一句话标题' }, text: { type: 'string' }, category: { type: 'string' }, evidence: { type: 'string' }, task_id: { type: 'string' }, supersedes: { type: 'string', description: '如果这条是更正以前的某条经验，写那条的编号（如 N-0012）；批准后旧的自动作废' }, recheck_days: { type: 'number', description: '多少天后该复查（价格、政策、对方口径这类会变的事要写，如 90）' } }, required: ['title', 'text', 'category'] } },
  { name: 'propose_practice', description: '发现某类任务的固定做法该改（规则错了、漏了一步）时提一条修改建议。Souki 在工作台「任务→待批准」里批准后才生效，所有人下次都用新版。', inputSchema: { type: 'object', properties: { category: { type: 'string' }, title: { type: 'string' }, text: { type: 'string', description: '要加或要改成的那句话' }, evidence: { type: 'string' } }, required: ['category', 'title', 'text'] } },
  { name: 'daily_digest', description: '收工时交当天小结：done 做完的、learned 学到的（会进待验证经验）、unfinished 没做完的（放进本人清单，他点了才变成任务）。人说「今天到这」「收工」时调用。', inputSchema: { type: 'object', properties: { done: { type: 'array', items: { type: 'string' } }, learned: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' }, category: { type: 'string' } } } }, unfinished: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, category: { type: 'string' }, detail: { type: 'string' } } } } } } },
  { name: 'my_week', description: '本人这一周的统计（程序算的）：做完几件、对话里做完的、各类别的一次通过率和平均用时、被退回的原因、转交、逾期、任务候选、经验、时间。同事问「我这周做了什么／哪里还能更快／哪里不足」时调用，只按这些数回答，不编。', inputSchema: { type: 'object', properties: { days: { type: 'number', description: '看几天，默认 7' } } } },
  { name: 'site_gap', description: '记一条网站缺口：网站后台没有、只能手工做的事（例：后台不能批量改库存）。同一件事已经有了就计数加一。攒着交给网站开发方。', inputSchema: { type: 'object', properties: { text: { type: 'string' }, detail: { type: 'string' } }, required: ['text'] } },
  { name: 'weekly_review', description: '（只有所有者）做每周改进清单用的全员数据：每个人和每一类的做完数・一次通过率・被退回原因・逾期，规则没起作用的，还没有固定做法的类别，该复查的经验，网站缺口，资料没交上来的，以及上一周改进清单每条的结果。拿到后：先报上一周每条的结果，再写 3–8 条这一周的改进（每条一句问题＋引用数字的原因＋建议），给所有者看，他同意后用 weekly_save 存。', inputSchema: { type: 'object', properties: {} } },
  { name: 'weekly_save', description: '（只有所有者）存这一周的改进清单。每条必须有去向 fate：任务（会建任务，可写 assignee 派给谁、category）／规则（进待批准经验，detail 写规则全文）／网站（进网站缺口清单）／不处理（写明原因）。同一周再存会覆盖。', inputSchema: { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, why: { type: 'string' }, fate: { type: 'string', enum: ['任务', '规则', '网站', '不处理'] }, category: { type: 'string' }, assignee: { type: 'string' }, detail: { type: 'string' } }, required: ['text', 'fate'] } } }, required: ['items'] } },
  { name: 'notes_pending', description: '（只有所有者）列出等批准的经验和改做法：编号、类别、标题、内容、谁提的、来源。所有者说「看看待批准的」时调用，逐条念给他。', inputSchema: { type: 'object', properties: {} } },
  { name: 'note_decide', description: '（只有所有者）批准或作废一条等批准的经验。ok=true 批准（写进这一类的固定做法，以后领这类任务都会带上）；ok=false 作废。可以先改 text、category 再批。只在所有者明确说了「批」「不要」之后调用。', inputSchema: { type: 'object', properties: { id: { type: 'string' }, ok: { type: 'boolean' }, text: { type: 'string' }, category: { type: 'string' } }, required: ['id', 'ok'] } },
  { name: 'admin_get', description: '读 alaco.ai 网站后台（只读）。path 以 /admin/ 开头，如 /admin/orders?page=1&per=20&flt=pending、/admin/products、/admin/purchase/stock-overview、/admin/dashboard。', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'admin_write', description: '改 alaco.ai 网站后台，会在线上真的生效。需要改后台的权限；删除商品／用户／订单、改账号设置被硬规则禁止。先 admin_get 看清现状再改，改完回读核对。', inputSchema: { type: 'object', properties: { method: { type: 'string', enum: ['POST', 'PUT', 'DELETE'] }, path: { type: 'string' }, body: { type: 'object' } }, required: ['method', 'path'] } },
  { name: 'product_check', description: '商品页的程序检查：把要写进后台的商品表单交来校验（日文、小类、他社商标、同梱物写法、SKU 不可改等），返回 errors 和 warnings。写商品页之前必须先过这一关；errors 不为空不许写。form 的形状用 product_form 取。', inputSchema: { type: 'object', properties: { slug: { type: 'string' }, form: { type: 'object' } }, required: ['slug', 'form'] } },
  { name: 'product_form', description: '按款号读后台现状并成商品表单（空位已用公司默认值补上），同时返回字段说明和分类清单。', inputSchema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] } },
];
const INSTRUCTIONS = `这是「大地工作台」：大地株式会社（ALA&CO）全公司共用的任务表、经验和固定做法（模版），放在公司的 Mac mini 上。你是某位同事电脑上的助手，用下面的规矩和它配合：
1. 每段对话开始先调用 brain_start，知道这位同事今天有什么任务。
2. 做任何任务前先 task_get：它会把这一类任务的「固定做法」一起给你，照着做；做法里没写的事实不要编，先 recall 查，查不到问人。
3. 做完：task_update 状态改 完成、result 必须写结果和证据；它会进本人清单的「待你检查」，本人在菜单栏清单上点「没问题」才算完成，点「不对」会带着原因退回来重做。学到的公司经验用 remember 记一条；做法该改用 propose_practice 提出。
4. 同事说到一件没记录的公司事务（来电、口头交代、想到的待办），用 task_create 记下来。
5. 同事说收工，调用 daily_digest。要问派活的人、或回复对方，用 task_comment。
6. 同事说「几点提醒我…」用 remind；说做了不在电脑上的工作（打包、接待、跑银行）用 work_log 记时间。
7. 只交公司的事。私事、聊天原文、密码和钥匙不要交。经验会变的（价格、政策、口径）写 recheck_days；更正旧经验写 supersedes。
8. 把电脑上的文件存档到公司 Mac mini：用 Bash 运行 ~/.dadi-brain/dadi put <文件路径> --task <任务号> --note <一句说明>；取回：~/.dadi-brain/dadi get <F-编号> <保存位置>。
9. 改网站后台前先读现状、改完回读核对；被拒绝就停下说明，不要换办法做同一件事。
10. 碰到网站后台没有、只能手工做的事，用 site_gap 记一条。同事问「我这周怎么样／哪里还能更快」，用 my_week 拿数字再回答。
11. 所有者说「看看待批准的」用 notes_pending 逐条念、他说批或不要再用 note_decide；说「做这周的改进清单」用 weekly_review，写好给他看，同意后 weekly_save。`;

async function callTool(p, name, a) {
  a = a || {};
  if (p.role === 'agent' && !AGENT_TOOLS.includes(name)) return { error: '派活智能体不能用这个工具：它只排活和提醒' };
  if (p.role === 'agent' && name === 'task_create' && (dispatchState.made = (dispatchState.made || 0) + 1) > 8) return { error: '这一次已经建了 8 个任务，到上限了。剩下的写进简报让 Souki 决定' };
  if (p.role === 'agent' && name === 'remind' && (dispatchState.rems = (dispatchState.rems || 0) + 1) > 12) return { error: '这一次已经定了 12 条提醒，到上限了' };
  if (name === 'remind') return remindAdd(p, { to: a.to, at: a.at, text: a.text, taskId: a.task_id });
  if (name === 'work_log') { const min = Math.round(Number(a.minutes)); if (!(min > 0 && min <= 960)) return { error: 'minutes 写 1～960 的分钟数' }; const w = { id: 'W-' + Date.now().toString(36), by: p.id, date: /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') ? a.date : ymd(), minutes: min, what: str(a.what, 200), taskId: String(a.task_id || '').toUpperCase(), at: now() }; db.worklog.unshift(w); if (db.worklog.length > 3000) db.worklog.length = 3000; save('worklog'); audit(p.name, '记线下时间', `${min} 分钟 ${w.what}`); return { ok: true, note: `记下了：${w.what} ${min} 分钟` }; }
  if (name === 'team_overview') { if (!['owner', 'agent'].includes(p.role)) return { error: '只有所有者和派活智能体能看全员' }; return overview(); }
  if (name === 'brief') { if (!['owner', 'agent'].includes(p.role)) return { error: '只有所有者和派活智能体能写简报' }; const text = str(a.text, 3000); if (!text) return { error: '简报是空的' }; db.settings.brief = { at: now(), by: p.name, text }; save('settings'); notify(ownerId(), `今日简报（${hhmm(new Date())}）：${clip(text.split('\n')[0], 120)}`, ''); return { ok: true }; }
  const mine = t => t.assignee === p.id;
  const row = t => ({ id: t.id, title: t.title, category: t.category, status: t.status, assignee: pname(t.assignee), due: t.due, level: t.level, ref: t.ref, source: t.source });
  if (name === 'brain_start') {
    const open = db.tasks.filter(t => mine(t) && OPEN.includes(t.status));
    const rank = t => (t.level === '急' ? 0 : t.due && t.due <= ymd() ? 1 : t.status === '进行中' ? 2 : 3);
    const pending = p.role === 'owner' ? { 待批准的经验和改做法: db.notes.filter(n => n.status === '待验证').length, 等确认的任务: db.tasks.filter(t => t.status === '等确认').length } : undefined;
    return { me: { name: p.name, role: p.role === 'owner' ? '所有者' : '成员', 负责: Object.entries(db.duties.map || {}).filter(([, v]) => v === p.id).map(([k]) => k) }, today: ymd(), brief: brief(p), my_open_tasks: open.sort((x, y) => rank(x) - rank(y)).map(row), pending, company_facts: company(), note: open.length ? '要做哪个任务，先 task_get 领它。' : '名下没有待做任务。' };
  }
  if (name === 'task_list') { let l = db.tasks.filter(t => (a.all ? true : mine(t)) && (a.status ? t.status === a.status : OPEN.includes(t.status)) && (a.category ? t.category === a.category : true)); if (a.all && p.role !== 'owner' && !can(p, 'see_all')) l = l.filter(mine); return { count: l.length, tasks: l.slice(0, 60).map(row) }; }
  if (name === 'task_get') { const t = db.tasks.find(x => x.id === String(a.id || '').toUpperCase()); if (!t) return { error: '没有这个任务' }; if (!mine(t) && p.role !== 'owner' && !can(p, 'see_all')) return { error: '这个任务不在你名下' }; return taskPack(t); }
  if (name === 'task_update') { const t = db.tasks.find(x => x.id === String(a.id || '').toUpperCase()); if (!t) return { error: '没有这个任务' }; if (!mine(t) && p.role !== 'owner') return { error: '这个任务不在你名下，不能改' };
    if (!OPEN.includes(t.status) && (a.status || a.assignee)) return { error: `这个任务已经${t.status}了，没有改。要重做：本人在清单「已完成」里取消打勾，或者新建一个任务。` };
    if (a.status === '完成' && t.status === '等确认' && t.check && !a.result) return { ok: true, task: row(t), next: '已经在本人清单的「待你检查」里了，等他点。' };
    if (a.assignee) { const r = taskTransfer(t, String(a.assignee), a.note, p); return r.error ? r : { ok: true, task: row(t), note: `已转给 ${r.to}，对方会收到通知。` }; }
    if (a.status === '完成') {   /* Claude 说做完了：不直接算完成，进本人清单的「待你检查」 */
      if (!str(a.result) && !str(t.result)) return { error: '做完要写 result：做了什么、证据（后台回读到什么、文件在哪）。写了再交。' };
      t.check = { at: now(), by: p.name }; taskUpdate(t, { status: '等确认', note: a.note || 'Claude 做完了，等本人检查', result: a.result, refs: Array.isArray(a.refs) ? a.refs.map(String) : [] }, p.name, p.id);
      return { ok: true, task: row(t), next: '已交到本人清单的「待你检查」。告诉用户：在菜单栏「大地」清单里看一下结果，点「没问题」才算完成；点「不对」会带着原因退回来。', remind: '如果这次学到了公司经验，用 remember 记一条。' };
    }
    const made = taskUpdate(t, { status: a.status, note: a.note, result: a.result, refs: Array.isArray(a.refs) ? a.refs.map(String) : [] }, p.name, p.id); return { ok: true, task: row(t), next_tasks_created: made.map(row), remind: t.status === '完成' ? '如果这次学到了公司经验，用 remember 记一条。' : undefined }; }
  if (name === 'task_create') { const who = a.assignee ? (db.people.find(x => (x.id === a.assignee || x.name === a.assignee) && !x.disabled && x.role !== 'agent') || {}).id : '';   /* 同名的人里取还在用的那个 */
    if (a.assignee && !who) return { error: `没有叫「${str(a.assignee, 30)}」的同事（或已停用）。先用 team_overview 看名字，或者不写 assignee 按分工表派。` };
    { const k = pkey(a.title), dup = k && db.tasks.find(t => OPEN.includes(t.status) && psame(pkey(t.title), k) && (!who || t.assignee === who)); if (dup) return p.role === 'agent' ? { error: '已经有同名的没做完的任务，没有重复建' } : { ok: true, task: row(dup), note: `已经有一张说同一件事的任务还开着（${dup.id}），没有重复建。` }; } const t = taskCreate({ title: a.title, detail: a.detail, category: a.category, assignee: who, source: p.role === 'agent' ? '智能体' : '人派', ref: a.ref, due: a.due, by: p.name, byId: p.id }); return t ? { ok: true, task: row(t) } : { error: p.role === 'agent' ? '已经有同名的没做完的任务，没有重复建' : '没建成' }; }
  if (name === 'task_comment') { const t = db.tasks.find(x => x.id === String(a.id || '').toUpperCase()); if (!t) return { error: '没有这个任务' }; if (!mine(t) && t.createdById !== p.id && p.role !== 'owner' && !can(p, 'see_all')) return { error: '这个任务和你无关，不能留言' }; if (!str(a.text)) return { error: '留言是空的' }; taskComment(t, a.text, p); return { ok: true, note: '留言了，对方会收到通知。' }; }
  if (name === 'file_list') { const q = String(a.query || '').toLowerCase(); const l = filesFor(p).filter(f => (!a.task_id || f.taskId === String(a.task_id).toUpperCase()) && (!q || (f.name + ' ' + f.note).toLowerCase().includes(q))); return { count: l.length, files: l.slice(0, 50).map(f => ({ id: f.id, name: f.name, kb: Math.round(f.size / 1024), by: pname(f.by), at: f.at.slice(0, 16), task: f.taskId, note: f.note })), how: '取回：~/.dadi-brain/dadi get <编号> <保存位置>' }; }
  if (name === 'recall') { const r = search(a.query, { category: a.category }); return { count: r.length, results: r.map(x => ({ id: x.id, kind: x.kind, category: x.category, title: x.title, text: clip(x.text, 900), from: x.meta })), note: r.length ? '「待验证经验」没经过批准，只作参考。' : '没查到。公司没有这方面的记录，问人，问到了用 remember 记下来。' }; }
  if (name === 'remember') { if (/(sk-ant-|xox[bp]-|dk_[A-Za-z0-9_-]{20,}|password\s*[:=]|密码[:：]\s*\S{4,})/i.test(`${a.title} ${a.text} ${a.evidence}`)) return { error: '里面像是有密码或钥匙，不能记进工作台。去掉后再记。' }; const n = noteAdd({ title: a.title, text: a.text, category: a.category, evidence: a.evidence, taskId: a.task_id, supersedes: String(a.supersedes || '').toUpperCase(), recheckDays: a.recheck_days }, p.id); return { ok: true, id: n.id, status: n.status, note: '已记下，等 Souki 批准后会并进固定做法。' }; }
  if (name === 'propose_practice') { const n = noteAdd({ title: a.title, text: a.text, category: a.category, evidence: a.evidence, kind: '改做法' }, p.id); return { ok: true, id: n.id, note: '已提交，Souki 批准后生效。在那之前仍按现在的固定做法做。' }; }
  if (name === 'daily_digest') {
    const d = { id: 'D-' + Date.now().toString(36), by: p.id, date: ymd(), at: now(), done: (a.done || []).map(x => str(x, 300)).slice(0, 30), learned: [], unfinished: [] };
    for (const l of (a.learned || []).slice(0, 15)) { if (l && l.title && l.text && !db.notes.some(n => psame(pkey(n.title), pkey(l.title), true))) { const n = noteAdd({ title: l.title, text: l.text, category: l.category }, p.id); d.learned.push(n.id); } }
    d.pending = (a.unfinished || []).slice(0, 15).map(u => str(typeof u === 'string' ? u : u && u.title, 300)).filter(Boolean);   /* 没做完的不直接变任务：放进清单「上次对话里没做完的」，本人点了才算 */
    db.digests.unshift(d); if (db.digests.length > 400) db.digests.length = 400; save('digests'); audit(p.name, '交小结', `做完 ${d.done.length}・学到 ${d.learned.length}・没做完 ${d.unfinished.length}`);
    return { ok: true, saved: { done: d.done.length, notes: d.learned, pending: d.pending.length }, note: d.pending.length ? '没做完的放在本人清单的「上次对话里没做完的」，他点「记成任务」才变成任务。' : undefined };
  }
  if (name === 'my_week') return { ...weekStats(p.id, Math.min(31, Math.max(1, Number(a.days) || 7))), 规则没起作用: rulesNotWorking().filter(x => db.tasks.some(t => t.assignee === p.id && t.category === x.类别)), how: '用这些数回答：这周做了什么、时间花在哪、哪一类被退回最多以及原因、怎样能更快。只说数字支持的；没有数据就说还没有。' };
  if (name === 'site_gap') { const g = gapAdd(p.id, a.text, { from: 'Claude', detail: a.detail }); return g ? { ok: true, id: g.id, count: g.count, note: g.count > 1 ? `这件事已经有人提过，现在提到 ${g.count} 次。` : '记下了，攒着交给网站开发方。' } : { error: '写一句网站缺什么' }; }
  if (['weekly_review', 'weekly_save', 'notes_pending', 'note_decide'].includes(name) && p.role !== 'owner') return { error: '只有所有者能用' };
  if (name === 'weekly_review') return { ...teamReview(), how: '先报「上一周的改进清单」每条现在怎样；再写这一周 3–8 条改进：一句问题＋原因（引用上面的数字）＋建议＋去向（任务／规则／网站／不处理）。先给所有者看，他同意后调用 weekly_save。' };
  if (name === 'weekly_save') return weeklySave(p, a.items);
  if (name === 'notes_pending') return { count: db.notes.filter(n => n.status === '待验证').length, notes: db.notes.filter(n => n.status === '待验证').map(n => ({ id: n.id, kind: n.kind, category: n.category, title: n.title, text: n.text, by: pname(n.by), evidence: n.evidence, at: n.at.slice(0, 10), task: n.taskId || '' })) };
  if (name === 'note_decide') { const n = db.notes.find(x => x.id === String(a.id || '').toUpperCase()); if (!n) return { error: '没有这一条' }; if (n.status !== '待验证') return { error: `这一条已经是「${n.status}」` }; if (a.text) n.text = str(a.text, 3000); if (a.category && CATEGORIES.includes(a.category)) n.category = a.category; noteDecide(n, !!a.ok, p.name); save('notes'); return { ok: true, id: n.id, status: n.status, note: a.ok ? `写进「${n.category}」的固定做法了，以后领这类任务都会带上。` : '作废了。' }; }
  if (name === 'admin_get') { const r = await backend(p, 'GET', a.path); return { http: r.status, data: r.data }; }
  if (name === 'admin_write') { const r = await backend(p, String(a.method || '').toUpperCase(), a.path, a.body); return { http: r.status, data: r.data }; }
  if (name === 'product_form') { if (!can(p, 'backend_read')) return { error: '没有读后台的权限' }; try { const r = await PROD.loadForm(String(a.slug || ''), deps.productForm()); const cats = await PROD.fetchCategories(); return { form: r.form, meta: r.meta, sections: PROD.SECTIONS, enums: PROD.ENUMS, categories: cats.map(c => ({ id: c.id, name: c.name, parent_id: c.parent_id })) }; } catch (e) { return { error: String(e.message || e) }; } }
  if (name === 'product_check') { try { const product = await PROD.findProduct(String(a.slug || '')); const cats = await PROD.fetchCategories(); return PROD.validate(a.form || {}, { product, categories: cats }); } catch (e) { return { error: String(e.message || e) }; } }
  return { error: '没有这个工具' };
}
async function mcp(p, m) {
  const { id, method, params } = m || {};
  if (method === 'initialize') return { jsonrpc: '2.0', id, result: { protocolVersion: (params && params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'dadi-brain', title: '大地工作台', version: '2.0.0' }, instructions: INSTRUCTIONS } };
  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };
  if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  if (method === 'tools/call') {
    const name = params && params.name; if (!TOOLS.some(t => t.name === name)) return { jsonrpc: '2.0', id, error: { code: -32602, message: '没有这个工具' } };
    let out; try { out = await callTool(p, name, (params && params.arguments) || {}); } catch (e) { out = { error: String((e && e.message) || e) }; }
    if (!['brain_start', 'task_list', 'recall', 'admin_get', 'team_overview', 'remind', 'work_log'].includes(name)) audit(p.name, '工具 ' + name, clip(JSON.stringify((params && params.arguments) || {}), 200));
    return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: clip(JSON.stringify(out, null, 1), 80000) }], isError: !!(out && out.error) } };
  }
  if (id === undefined) return null;   /* 通知：不用回 */
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } };
}

/* ───── 存档文件：从各人电脑传到 Mac mini（数据目录/files/年-月/），索引在 files.json ───── */
const FILES_DIR = path.join(DATA, 'files');
const filesFor = p => (p.role === 'owner' || can(p, 'see_all') ? db.files : db.files.filter(f => f.by === p.id || db.tasks.some(t => t.id === f.taskId && (t.assignee === p.id || t.createdById === p.id))));
function fileSave(p, name, buf, { taskId, note }) {
  const safe = String(name || 'file').replace(/[\/\\:*?"<>|\x00-\x1f]/g, '_').slice(-120) || 'file';
  const id = 'F-' + String(++db.seq.file).padStart(4, '0'); const dir = path.join(FILES_DIR, ymd().slice(0, 7)); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const rel = path.join(ymd().slice(0, 7), `${id}-${safe}`); fs.writeFileSync(path.join(FILES_DIR, rel), buf, { mode: 0o600 });
  const f = { id, name: safe, size: buf.length, sha: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16), by: p.id, at: now(), taskId: db.tasks.some(t => t.id === taskId) ? taskId : '', note: str(note, 300), rel };
  db.files.unshift(f); save('files'); save('seq'); audit(p.name, '存档文件', `${id} ${safe}（${Math.round(buf.length / 1024)}KB）${f.taskId ? ' → ' + f.taskId : ''}`);
  if (f.taskId) { const t = db.tasks.find(x => x.id === f.taskId); t.log.push({ at: now(), by: p.name, byId: p.id, text: `存档了文件 ${id} ${safe}` }); save('tasks'); }
  return f;
}
const readRaw = (req, max) => new Promise((ok, bad) => { let n = 0; const c = []; req.on('data', d => { n += d.length; if (n > max) { bad(new Error('文件太大（最大 50MB）')); req.destroy(); } else c.push(d); }); req.on('end', () => ok(Buffer.concat(c))); req.on('error', bad); });
/* 钩子用：开对话时带给 Claude 的一段话（今天的任务、新通知、上次没做完的）。短，不占地方 */
const SECRET = /(sk-ant-[\w-]{8,}|xox[bp]-[\w-]{8,}|dk_[A-Za-z0-9_-]{20,}|password\s*[:=]\s*\S+|密码[:：]\s*\S{4,})/gi;
function startText(p, { inboxOnly } = {}) {
  const un = unread(p.id); const L = [];
  const show = un.slice(-8).reverse(), more = un.length - show.length;   /* 一次最多带 8 条，从最早的开始；剩下的下一句话时再带，不丢 */
  if (inboxOnly) { if (!un.length) return ''; markRead(p.id, show); return `【大地工作台 新通知】\n${show.map(x => `- ${x.text}`).join('\n')}${more ? `\n（还有 ${more} 条，下一句话时带上。）` : ''}\n（告诉用户有这些新通知；相关任务用 task_get 看详情。）`; }
  L.push(`【大地工作台・${p.name}・${ymd()}】（公司 Mac mini 上的任务和经验，由钩子自动带入）`);
  L.push(brief(p));   /* 昨天做完／今天要做（＋今天的提醒）／还差 */
  if (un.length) { L.push(`新通知：\n${show.map(x => `- ${x.text}`).join('\n')}${more ? `\n（还有 ${more} 条，下一句话时带上。）` : ''}`); markRead(p.id, show); }
  if (p.role === 'owner') { const n = db.notes.filter(x => x.status === '待验证').length; if (n) L.push(`等你批准的经验／改做法：${n} 条（工作台「任务→待批准」）。`); }
  L.push('规矩：做某个任务前先用 task_get 领它（会带上固定做法）；做完 task_update（result 必填，交给本人在清单上检查）；学到公司经验用 remember；要转交给别人用 task_update 的 assignee＋note 原因。用户没问任务时不用主动念这段，只在相关时用。');
  return L.join('\n');
}

/* ───── HTTP：/mcp 给 Claude；页面走工作台自己的 /api/brain ───── */
/* 把一个文件发给请求方。文件不在了、读到一半出错：只结束这一个请求，服务照常 */
function sendFile(res, f, headers) { const st = fs.createReadStream(f); st.on('error', () => { if (!res.headersSent) reply(res, 404, { error: '文件不在了' }); else res.destroy(); }); st.on('open', () => { res.writeHead(200, headers); st.pipe(res); }); }
const reply = (res, code, body, type) => { const b = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body); res.writeHead(code, { 'content-type': type || 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(b); };
const readBody = req => new Promise((ok, bad) => { let n = 0; const c = []; req.on('data', d => { n += d.length; if (n > 4e6) { bad(new Error('太大')); req.destroy(); } else c.push(d); }); req.on('end', () => { try { ok(c.length ? JSON.parse(Buffer.concat(c).toString('utf8')) : {}); } catch { bad(new Error('不是 JSON')); } }); req.on('error', bad); });
const view = { task: t => ({ ...t, assigneeName: pname(t.assignee) }), note: n => ({ ...n, byName: pname(n.by) }), person: p => ({ id: p.id, name: p.name, role: p.role, caps: p.caps || [], off: p.off || [], disabled: !!p.disabled, createdAt: p.createdAt, notify: p.notify || { kind: 'none', target: '' }, takeover: p.takeover || [], prompt: promptOf(p) }) };

/* ───── 给各人电脑的入口：/mcp、/hook/*、/files、/client/*。用各自的钥匙，不走页面那一套口令 ───── */
export async function handle(req, res, url) {
  const p = url.pathname;
  if (p === '/mcp') {
    if (req.method !== 'POST') { reply(res, 405, { error: '只收 POST' }); return true; }
    const me = personByKey((/^Bearer\s+(.+)$/i.exec(req.headers.authorization || '') || [])[1]);
    if (!me) { reply(res, 401, { jsonrpc: '2.0', id: null, error: { code: -32001, message: '钥匙不对或已停用。向 Souki 要一把新的。' } }); return true; }
    const body = await readBody(req);
    if (Array.isArray(body)) { const outs = (await Promise.all(body.map(m => mcp(me, m)))).filter(Boolean); outs.length ? reply(res, 200, outs) : reply(res, 202, ''); return true; }
    const out = await mcp(me, body); out ? reply(res, 200, out) : reply(res, 202, ''); return true;
  }
  if (req.method === 'GET' && p.startsWith('/client/')) { const n = p.slice(8); const f = path.join(ROOT, 'client', n); if (!['brain-hook.mjs', 'install.mjs', 'DadiMenu.zip'].includes(n) || !fs.existsSync(f)) reply(res, 404, { error: '没有这个文件' }); else reply(res, 200, fs.readFileSync(f), n.endsWith('.zip') ? 'application/zip' : 'text/javascript; charset=utf-8'); return true; }
  if (req.method === 'GET' && p === '/me') { reply(res, 200, fs.readFileSync(path.join(ROOT, 'client', 'me.html')), 'text/html; charset=utf-8'); return true; }   /* 「我的今天」清单页：页面本身没有数据，数据要带钥匙取 */
  if (!(p.startsWith('/hook/') || p === '/files' || p.startsWith('/files/') || p.startsWith('/backup/') || p.startsWith('/me/') || p === '/talk')) return false;
  const me = personByKey((/^Bearer\s+(.+)$/i.exec(req.headers.authorization || '') || [])[1]);
  if (!me) { reply(res, 401, { error: '钥匙不对或已停用' }); return true; }
  if (p === '/me/state' && req.method === 'GET') { reply(res, 200, meState(me)); return true; }
  if (p === '/me/task' && req.method === 'POST') {   /* 清单上打勾／取消打勾／开始做。只能动自己名下的 */
    const b = await readBody(req), t = db.tasks.find(x => x.id === String(b.id || '').toUpperCase());
    if (!t || t.assignee !== me.id) { reply(res, 404, { error: '没有这个任务，或不在你名下' }); return true; }
    const fail = m => { reply(res, 400, { error: m }); return true; };
    if (b.action === 'done' && !OPEN.includes(t.status)) { reply(res, 409, { error: `这条已经${t.status}了`, state: meState(me) }); return true; }
    if (b.action === 'done') {   /* 自己做的（多半不在电脑上）：打勾并写一句做了什么。库存预警这类「知道了」可以不写 */
      const r = str(b.result, 600);   /* 写不写说明都能做完（Souki 20261111 定） */
      t.check = null; taskUpdate(t, { status: '完成', note: '本人在清单上打勾', result: r || (ACK.test(ruleBase(t.ruleKey)) ? '知道了' : '') }, me.name, me.id);
    } else if ((b.action === 'ok' || b.action === 'reject') && !(t.status === '等确认' && t.check)) { reply(res, 409, { error: `这条已经不是「待检查」了（现在是${t.status}），刷新看看`, state: meState(me) }); return true;
    } else if (b.action === 'ok') {   /* 检查 Claude 做的：没问题 */
      t.check = { ...t.check, okAt: now() }; if (!t.rejects) t.passFirst = true; t.rejectedNow = ''; taskUpdate(t, { status: '完成', note: '本人检查：没问题' }, me.name, me.id);
    } else if (b.action === 'reject') {   /* 不对：带着原因退回去重做；这句原因同时成为一条等批准的经验 */
      const why = str(b.reason, 400); if (!why) return fail('写一句哪里不对');
      t.rejects = (t.rejects || 0) + 1; t.passFirst = false; t.check = null; t.rejectedNow = why; taskUpdate(t, { status: '进行中', note: `检查不通过：${why}` }, me.name, me.id);
      noteAdd({ title: `纠正：${clip(t.title, 60)}`, text: `做「${t.title}」时被本人退回：${why}`, category: t.category, evidence: `任务 ${t.id} 检查时退回（Claude 交的结果：${clip(t.result, 160)}）`, taskId: t.id, auto: true }, me.id);
    } else if (b.action === 'mute' && !OPEN.includes(t.status)) { reply(res, 409, { error: `这条已经${t.status}了`, state: meState(me) }); return true;
    } else if (b.action === 'mute') {   /* 规则派的任务：这件事不用再提（比如故意留着 draft 的测试款）。任务取消，这条规则对这个对象以后不再开任务 */
      const base = ruleBase(t.ruleKey); if (!base || t.source !== '规则') return fail('只有规则自动派的任务能设「不用再提」');
      if (!/^(page|draft|cal):/.test(base)) return fail('这一类每天都可能有新的（发货、咨询、退款、库存），不能设「不用再提」；今天不用做就打勾');
      mute(base, me.name, t.title); taskUpdate(t, { status: '取消', note: '本人：这件事不用再提' }, me.name, me.id); audit(me.name, '不用再提', `${base} ${clip(t.title, 60)}`);
    } else if (b.action === 'transfer') { const r = taskTransfer(t, String(b.to || ''), b.reason, me); if (r.error) return fail(r.error);
    } else if (b.action === 'undo' && t.status === '完成') { taskUpdate(t, { status: '待做', note: '本人取消打勾' }, me.name, me.id); t.reopened = Math.max(0, (t.reopened || 0) - 1); save('tasks'); }   /* 自己点错不算被退回 */
    else if (b.action === 'start' && t.status === '待做') taskUpdate(t, { status: '进行中' }, me.name, me.id);
    else { reply(res, ['done', 'mute', 'undo', 'start'].includes(b.action) ? 409 : 400, { error: ['done', 'mute', 'undo', 'start'].includes(b.action) ? `这条现在是「${t.status}」，没有改。刷新看看` : '不认识的动作', state: meState(me) }); return true; }
    save('tasks');
    reply(res, 200, { ok: true, state: meState(me) }); return true;
  }
  if (p === '/me/cand' && req.method === 'POST') {   /* 对话里提出来的任务候选：接（变成任务，可以派给别人）／不用 */
    const b = await readBody(req), c = db.cands.find(x => x.id === String(b.id || '') && x.by === me.id && x.status === '待定');
    if (!c) { reply(res, 404, { error: '没有这一条' }); return true; }
    if (b.action === 'take') { const to = b.to ? person(String(b.to)) : (c.to ? person(c.to) : me); const t = taskCreate({ title: c.title, detail: `从 ${me.name} 和 Claude 的对话里提出来的（${c.at.slice(0, 10)}）`, category: c.category, assignee: (to || me).id, source: '对话', due: c.due, by: me.name, byId: me.id }); c.status = '接了'; c.task = t ? t.id : ''; }
    else if (b.action === 'drop') c.status = '不用';
    else { reply(res, 400, { error: '不认识的动作' }); return true; }
    c.decidedAt = now(); save('cands'); audit(me.name, c.status === '接了' ? '候选→任务' : '候选→不用', `${c.title}${c.task ? ' ' + c.task : ''}`);
    reply(res, 200, { ok: true, task: c.task || '', state: meState(me) }); return true;
  }
  if (p === '/me/pending' && req.method === 'POST') {   /* 小结里「没做完」的一条：记成任务，或者不用了。两种都从小结里拿掉，不再反复出现 */
    const b = await readBody(req);
    if (b.action === 'dropall') { const l = pendingOf(me.id, 100); for (const g of db.digests) if (g.by === me.id) for (const x of (g.pending || [])) dismiss(me.id, x);   /* 同一件事的几种说法都记成「不用了」 */ for (const g of db.digests) if (g.by === me.id && (g.pending || []).length) g.pending = []; save('digests'); save('settings'); audit(me.name, '没做完→全部不用', `${l.length} 条`); reply(res, 200, { ok: true, dropped: l.length, state: meState(me) }); return true; }
    const text = str(b.text, 300), k = pkey(text); let hit = false;
    for (const g of db.digests) if (g.by === me.id && (g.pending || []).some(x => psame(pkey(x), k))) { g.pending = g.pending.filter(x => !psame(pkey(x), k)); hit = true; }
    if (!hit || !k) { reply(res, 404, { error: '没有这一条' }); return true; }
    dismiss(me.id, text); save('digests'); save('settings'); let t = null;
    if (b.action === 'task') t = db.tasks.find(x => x.assignee === me.id && OPEN.includes(x.status) && psame(pkey(x.title), pkey(clip(text, 150)))) || taskCreate({ title: clip(text, 150), detail: text.length > 150 ? text : '', category: '其他', assignee: me.id, source: '小结', by: me.name, byId: me.id });
    audit(me.name, b.action === 'task' ? '没做完→任务' : '没做完→不用', clip(text, 100));
    reply(res, 200, { ok: true, task: t ? t.id : '', state: meState(me) }); return true;
  }
  if (p === '/talk' && req.method === 'POST') { let r; try { r = talkPut(me, { session: url.searchParams.get('session'), date: url.searchParams.get('date'), title: url.searchParams.get('title'), turns: url.searchParams.get('turns') }, (await readRaw(req, 1500000)).toString('utf8')); } catch (e) { r = { error: String((e && e.message) || e) }; } if (!r.error) audit(me.name, '交对话', `${url.searchParams.get('date')} ${str(url.searchParams.get('title'), 40)}（${r.chars} 字）`); reply(res, r.error ? 400 : 200, r); return true; }
  if (p === '/me/talk' && req.method === 'GET') {   /* 看一段精简对话：自己的；所有者能看所有人的；被指定接手的人能看前任的 */
    const who = bkWho(me, url.searchParams.get('person')), t = who && talkRead(who, url.searchParams.get('date'), url.searchParams.get('session'));
    if (!t) { reply(res, 404, { error: '没有这一段，或无权看' }); return true; } if (who.id !== me.id) audit(me.name, '看对话', `${who.name} ${t.date} ${t.title}`); reply(res, 200, t); return true;
  }
  if (p === '/me/talk' && req.method === 'POST') { const b = await readBody(req); if (b.action === 'drop' && talkDrop(me, String(b.date || ''), String(b.session || ''))) { reply(res, 200, { ok: true }); return true; } reply(res, 404, { error: '没有这一段' }); return true; }
  if (p === '/me/report' && req.method === 'GET') { reply(res, 200, { draft: reportDraft(me), sent: db.reports.find(x => x.by === me.id && x.date === ymd()) || null, history: db.reports.filter(x => x.by === me.id).slice(0, 14) }); return true; }
  if (p === '/me/report' && req.method === 'POST') { const b = await readBody(req), r = reportMake(me, { note: typeof b.note === 'string' ? b.note : '', drop: Array.isArray(b.drop) ? b.drop.map(String) : [], client: b.client }); try { deps.onChange(); } catch {} reply(res, 200, { ok: true, report: r, state: meState(me) }); return true; }
  if (p === '/hook/beat' && req.method === 'POST') { beat(me, await readBody(req)); reply(res, 200, { ok: true }); return true; }
  if (p === '/hook/tick' && req.method === 'GET') {
    { const se = str(url.searchParams.get('se'), 300); const had = !!(me.health && me.health.sumError); if (se) { me.health = { sumError: se, at: (me.health && me.health.sumError === se && me.health.at) || now() }; if (!had) saveQ('people'); } else if (had) { me.health = null; saveQ('people'); } }   /* 后台小助手每分钟来取一次：到点的提醒和新通知（弹桌面通知用；Claude 那边下一句话时照样会说） */
    try { remindTick(); } catch {}
    const l = db.inbox.filter(x => x.to === me.id && !x.read && !x.shown && Date.now() - Date.parse(x.at) < 12 * 3600e3).slice(-5).reverse(); for (const x of l) x.shown = true; if (l.length) saveQ('inbox');   /* 一分钟最多弹 5 条，从最早的开始；剩下的下一分钟接着弹 */
    reply(res, 200, { notify: l.map(x => x.text), prompt: promptOf(me) }); return true;   /* prompt＝这个人早上、下班弹窗的时间和开关（所有者在「成员」里改） */
  }
  if (p === '/hook/brief' && req.method === 'GET') { reply(res, 200, brief(me, url.searchParams.get('part') === 'evening' ? 'evening' : 'morning'), 'text/plain; charset=utf-8'); return true; }
  if (p === '/hook/report' && req.method === 'POST') { const b = await readBody(req).catch(() => ({})); const r = reportMake(me, { client: b && b.client }); try { deps.onChange(); } catch {} reply(res, 200, { ok: true, id: r.id, done: r.done.length, pending: r.pending.length, learned: r.learned, minutes: r.minutes, backupFiles: bkSum(me.id).files }); return true; }
  if (p === '/backup/file' && req.method === 'POST') { let r; try { r = bkPut(me, url.searchParams.get('root'), url.searchParams.get('path'), await readRaw(req, 26e6)); } catch (e) { r = { error: String((e && e.message) || e) }; } reply(res, r.error ? 400 : 200, r); return true; }
  if (p === '/backup/done' && req.method === 'POST') { bkDone(me, await readBody(req)); reply(res, 200, { ok: true }); return true; }
  if (p === '/backup/list' && req.method === 'GET') { const who = bkWho(me, url.searchParams.get('person')); if (!who) { reply(res, 403, { error: '没有这个人，或只有所有者能取别人的备份' }); return true; } reply(res, 200, bkList(who)); return true; }
  if (p === '/backup/file' && req.method === 'GET') { const who = bkWho(me, url.searchParams.get('person')), f = who && bkPath(who, url.searchParams.get('path')); if (!f) { reply(res, 404, { error: '没有这个文件，或无权取' }); return true; } sendFile(res, f, { 'content-type': 'application/octet-stream' }); return true; }
  if (p === '/hook/start' && req.method === 'GET') { reply(res, 200, startText(me), 'text/plain; charset=utf-8'); return true; }
  if (p === '/hook/inbox' && req.method === 'GET') { reply(res, 200, startText(me, { inboxOnly: true }), 'text/plain; charset=utf-8'); return true; }
  if (p === '/hook/pending' && req.method === 'GET') { const sid = str(url.searchParams.get('session'), 40), out = []; for (const g of db.digests) if (g.by === me.id && g.session && g.session === sid) for (const x of (g.pending || [])) if (!out.includes(x)) out.push(x); reply(res, 200, { pending: out.slice(0, 12) }); return true; }
  if (p === '/hook/digest' && req.method === 'POST') {   /* 对话结束／压缩前自动交的小结：学到的进待验证（最多 3 条），没做完的留在小结里、下次开工时提醒 */
    const b = await readBody(req); const clean = x => str(x, 300).replace(SECRET, '（已隐藏）');
    const d = { id: 'D-' + Date.now().toString(36), by: me.id, date: ymd(), at: now(), auto: true, session: str(b.session, 40), where: str(b.cwd, 200), done: (b.done || []).map(clean).filter(Boolean).slice(0, 20), learned: [], unfinished: [], pending: (b.unfinished || []).map(x => clean(typeof x === 'string' ? x : x && x.title)).filter(Boolean).slice(0, 10) };
    if (/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') && b.date <= d.date) d.date = b.date;   /* 断网几天后补交的：算对话那天的，不算补交这天 */
    if (!d.done.length && !d.pending.length && !(b.learned || []).length && !(b.todo || []).length && !(b.gaps || []).length) { reply(res, 200, { ok: true, skipped: true }); return true; }   /* 五样都空：什么都不动（前半段没做完的照旧留着） */
    const known = db.notes.map(n => pkey(n.title));   /* 作废过的也算：不再自动交回来 */ const isNew = l => { const k = pkey(l.title); return !known.some(x => psame(x, k, true)); };   /* 已经有一条说同一件事的：不再提 */
    for (const l of (b.learned || []).slice(0, 3)) { SECRET.lastIndex = 0; if (l && l.title && l.text && isNew(l) && !SECRET.test(`${l.title} ${l.text}`)) d.learned.push(noteAdd({ title: l.title, text: l.text, category: l.category, evidence: '自动小结（对话结束时由助手整理）', auto: true }, me.id).id); }
    for (const c of (Array.isArray(b.todo) ? b.todo : []).slice(0, 6)) { const x = candAdd(me, c, d.session); if (x) (d.cands = d.cands || []).push(x.id); } if ((d.cands || []).length) save('cands');
    for (const g of (Array.isArray(b.gaps) ? b.gaps : []).slice(0, 3)) gapAdd(me.id, typeof g === 'string' ? g : g && g.text);
    if (!b.carry) { const keep = []; for (const old of db.digests) if (old.by === me.id && old.session && old.session === d.session) for (const x of (old.pending || [])) if (!d.pending.some(y => psame(pkey(y), pkey(x), true)) && !keep.includes(x)) keep.push(x); d.pending = [...d.pending, ...keep].slice(0, 12); }   /* 老版本小助手没带上一份：这一份只看到后半段，前面没做完的不能因此丢掉 */
    for (const old of db.digests) if (old.by === me.id && old.pending && old.session && old.session === d.session) old.pending = [];   /* 同一段对话：只留最新一份的「没做完」；别的对话的不动 */
    db.digests.unshift(d); if (db.digests.length > 600) db.digests.length = 600; save('digests'); audit(me.name, '自动小结', `做完 ${d.done.length}・学到 ${d.learned.length}・没做完 ${d.pending.length}`);
    reply(res, 200, { ok: true, id: d.id }); return true;
  }
  if (p === '/files' && req.method === 'POST') { const buf = await readRaw(req, 50e6); if (!buf.length) { reply(res, 400, { error: '文件是空的' }); return true; } const f = fileSave(me, url.searchParams.get('name'), buf, { taskId: String(url.searchParams.get('task') || '').toUpperCase(), note: url.searchParams.get('note') }); reply(res, 200, { ok: true, id: f.id, name: f.name, size: f.size }); return true; }
  if (p.startsWith('/files/') && req.method === 'GET') { const f = filesFor(me).find(x => x.id === p.slice(7).toUpperCase()); if (!f) { reply(res, 404, { error: '没有这个文件，或你无权取' }); return true; } sendFile(res, path.join(FILES_DIR, f.rel), { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(f.name) }); return true; }
  reply(res, 404, { error: '没有这个地址' }); return true;
}

/* ───── 给工作台页面的：坐在这台机器前的人＝所有者 ───── */
export const owner = () => db.people.find(p => p.role === 'owner');
export const ownerKeyFile = () => path.join(DATA, 'owner.key');
export function pageState() {
  const me = owner();
  return { me: view.person(me), today: ymd(), categories: CATEGORIES, depts: DEPTS, caps: CAP_WORDS, people: db.people.filter(x => x.role !== 'agent').map(view.person), team: teamView(), brief: db.settings.brief || null,
    reminders: db.reminders.filter(r => !r.sent && !r.cancelled).sort((x, y) => (x.at < y.at ? -1 : 1)).slice(0, 60).map(r => ({ ...r, toName: pname(r.to), byName: pname(r.by) })), dispatch: { ...dcfg(), running: dispatchState.running, last: db.settings.dispatchLast || null, log: db.settings.dispatchLog || [] }, duties: db.duties, tasks: db.tasks.slice(0, 400).map(view.task), notes: db.notes.slice(0, 400).map(view.note),
    digests: db.digests.slice(0, 60).map(d => ({ ...d, byName: pname(d.by) })), reports: db.reports.slice(0, 60).map(r => ({ ...r, byName: pname(r.by) })), gaps: db.gaps.slice(0, 100).map(g => ({ ...g, names: g.people.map(pname) })), muted: Object.entries(db.settings.muted || {}).map(([base, v]) => ({ base, ...v })), weekly: db.weekly.slice(0, 8).map(w => ({ ...weeklyView(w), byName: pname(w.by) })), cands: db.cands.filter(c => c.status === '待定').length, inbox: unread(me.id).slice(0, 30), files: db.files.slice(0, 300).map(f => ({ ...f, byName: pname(f.by), rel: undefined })), scan: { at: scanState.at, error: scanState.error, made: scanState.made }, company: company() };
}
export function auditTail(n = 150) { try { return fs.readFileSync(path.join(DATA, 'audit.log'), 'utf8').trim().split('\n').slice(-n).reverse().map(l => JSON.parse(l)); } catch { return []; } }
export function fileStream(id, res) { const f = db.files.find(x => x.id === String(id || '').toUpperCase()); if (!f) return false; sendFile(res, path.join(FILES_DIR, f.rel), { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}` }); return true; }
/* 页面上的操作。manage＝现在的人物有没有管理权限（管理员人物）；没有就只能看、留言、改自己的任务 */
export async function pageOp(op, b, manage) {
  const me = owner(); const need = () => { if (!manage) throw Object.assign(new Error('要切换成管理员才能做这件事'), { code: 403 }); };
  const T = () => { const t = db.tasks.find(x => x.id === b.id); if (!t) throw Object.assign(new Error('没有这个任务'), { code: 404 }); return t; };
  if (op === 'task/create') { const t = taskCreate({ ...b, source: '人派', by: me.name, byId: me.id }); if (!t) throw new Error('没建成'); return { ok: true, task: view.task(t) }; }
  if (op === 'task/update') { const t = T(); let to;
    if (b.assignee && b.assignee !== t.assignee) { to = person(b.assignee); if (!to || to.disabled || to.role === 'agent') throw new Error('接手的人不在、已停用，或是派活智能体'); if (t.status === '等确认' && t.check) { t.check = null; t.status = '进行中'; } t.from = { id: t.assignee, by: pname(t.assignee), reason: str(b.note, 200) || `${me.name} 在管理页改派`, at: now() }; t.transfers = (t.transfers || 0) + 1; t.verifyBack = 0; }
    taskUpdate(t, { status: b.status !== t.status ? b.status : undefined, note: b.note, result: b.result, assignee: to ? to.id : undefined }, me.name, me.id); return { ok: true }; }
  if (op === 'task/comment') { const t = T(); if (!str(b.text)) throw new Error('留言是空的'); taskComment(t, b.text, me); return { ok: true }; }
  if (op === 'inbox/read') { markRead(me.id); return { ok: true }; }
  if (op === 'remind/add') { if (b.to && b.to !== me.id) need(); const r = remindAdd(me, { to: b.to, at: b.at, text: b.text, taskId: b.taskId }); if (r.error) throw new Error(r.error); return r; }
  if (op === 'remind/cancel') { const r = db.reminders.find(x => x.id === b.id); if (!r) throw Object.assign(new Error('没有这条提醒'), { code: 404 }); if (r.to !== me.id) need(); r.cancelled = true; save('reminders'); audit(me.name, '取消提醒', `${r.id} ${clip(r.text, 80)}`); return { ok: true }; }
  if (op === 'scan') { const s = await scan(me.name); return { ok: true, made: s.made, error: s.error, items: s.items.length }; }
  need();
  if (op === 'dispatch/save') { const times = [...new Set((Array.isArray(b.times) ? b.times : String(b.times || '').split(/[,，、\s]+/)).map(x => { const m = /^(\d{1,2})[:：](\d{2})$/.exec(String(x).trim()); return m && +m[1] < 24 && +m[2] < 60 ? `${String(+m[1]).padStart(2, '0')}:${m[2]}` : ''; }).filter(Boolean))].sort().slice(0, 6); if (!times.length) throw new Error('时间写成 09:05, 13:00, 17:00 这样'); db.settings.dispatch = { enabled: !!b.enabled, times, model: ['haiku', 'sonnet', 'opus'].includes(b.model) ? b.model : 'sonnet' }; save('settings'); audit(me.name, '改派活设置', `${b.enabled ? '开' : '关'}・${times.join(' ')}・${db.settings.dispatch.model}`); return { ok: true }; }
  if (op === 'mute/remove') { if (db.settings.muted && db.settings.muted[b.base]) { delete db.settings.muted[b.base]; save('settings'); audit(me.name, '恢复提醒', String(b.base)); } return { ok: true }; }
  if (op === 'gap/update') { const g = db.gaps.find(x => x.id === b.id); if (!g) throw Object.assign(new Error('没有这一条'), { code: 404 }); if (['待看', '已交黄兄', '已做好', '不做'].includes(b.status)) g.status = b.status; save('gaps'); audit(me.name, '网站缺口', `${g.id} → ${g.status}`); return { ok: true }; }
  if (op === 'health/run') { db.settings.healthDay = ''; healthJob(); return { ok: true, items: healthList(b.day) }; }
  if (op === 'dispatch/run') { if (dispatchState.running) throw new Error('正在排，等它做完'); dispatch(me.name + ' 手动').catch(() => {}); return { ok: true, started: true }; }
  if (op === 'note/decide') { const n = db.notes.find(x => x.id === b.id); if (!n) throw Object.assign(new Error('没有这条'), { code: 404 }); if (b.text != null) n.text = str(b.text, 3000); if (b.category && CATEGORIES.includes(b.category)) n.category = b.category; if (b.recheckBy != null) n.recheckBy = /^\d{4}-\d{2}-\d{2}$/.test(b.recheckBy) ? b.recheckBy : ''; if (b.only === 'recheck') { save('notes'); return { ok: true }; } if (n.status !== '待验证') throw Object.assign(new Error(`这一条已经是「${n.status}」了（可能刚在 Claude 里批过）。刷新看看`), { code: 409 }); noteDecide(n, !!b.ok, me.name); return { ok: true }; }
  if (op === 'duties/save') { const map = {}; for (const c of CATEGORIES) map[c] = person((b.map || {})[c]) ? b.map[c] : me.id; const was = db.duties.map || {}; db.duties.map = map; save('duties'); audit(me.name, '改分工表', JSON.stringify(map));
    let moved = 0; for (const t of db.tasks) { const fp = t.from && person(t.from.id); if (OPEN.includes(t.status) && fp && fp.disabled && map[t.category] !== was[t.category] && t.assignee !== map[t.category]) { taskUpdate(t, { assignee: map[t.category], note: `分工表改了：${t.category} 归 ${pname(map[t.category])}` }, me.name, me.id); moved++; } }   /* 停用的人转出来、暂时落在别人名下的：跟着新的分工表走 */
    return { ok: true, moved }; }
  if (op === 'person/add') { const name = str(b.name, 30); if (!name) throw new Error('要有名字'); const id = 'p' + crypto.randomBytes(3).toString('hex'); const key = 'dk_' + crypto.randomBytes(18).toString('base64url'); db.people.push({ id, name, role: 'member', caps: (b.caps || ['backend_read']).filter(c => ALL_CAPS.includes(c)), keyHash: sha(key), off: [], createdAt: now() }); save('people'); audit(me.name, '加成员', name); return { ok: true, id, key }; }   /* 钥匙只在这一次显示，这里只存它的指纹 */
  if (op === 'person/handover') {   /* 一键交接：没做完的任务和没到点的提醒整体转给接手的人；接手的人能取回前任的记忆和规则 */
    const from = person(b.from), to = person(b.to); if (!from || !to || from.id === to.id || to.role === 'agent' || to.disabled) throw new Error('要选交出的人和接手的人');
    let nt = 0, nr = 0; for (const t of db.tasks) if (t.assignee === from.id && OPEN.includes(t.status)) { t.assignee = to.id; t.log.push({ at: now(), by: me.name, text: `交接：从 ${from.name} 转给 ${to.name}` }); t.updatedAt = now(); nt++; } if (nt) save('tasks');
    for (const r of db.reminders) if (!r.sent && !r.cancelled && r.to === from.id) { r.to = to.id; nr++; } if (nr) save('reminders');
    let nc = 0; for (const c of db.cands) if (c.by === from.id && c.status === '待定') { c.by = to.id; if (c.to === to.id) c.to = ''; nc++; } if (nc) save('cands');   /* 对话里提到要做的，一起交过去 */
    const pend = pendingOf(from.id, 30); if (pend.length) { db.digests.unshift({ id: 'D-' + Date.now().toString(36), by: to.id, date: ymd(), at: now(), session: `交接自 ${from.name}`, where: '', done: [], learned: [], unfinished: [], pending: pend.map(x => `（${from.name} 的）${x}`) }); for (const g of db.digests) if (g.by === from.id) g.pending = []; save('digests'); }   /* 上次对话没做完的，也交过去 */
    if (to.role !== 'owner') to.takeover = [...new Set([...(to.takeover || []), from.id])].slice(0, 5);
    from.takeover = (from.takeover || []).filter(x => x !== to.id); save('people');   /* 交回来：对方不能再读自己的备份和对话 */
    audit(me.name, '交接', `${from.name} → ${to.name}：任务 ${nt}・提醒 ${nr}・候选 ${nc}・没做完 ${pend.length}・备份可取回`);
    if (to.id !== me.id) notify(to.id, `${me.name} 把 ${from.name} 的工作交接给你：${nt} 个任务、${nr} 条提醒${nc + pend.length ? `、${nc + pend.length} 条待定的` : ''}。他的记忆和规则可以取回：~/.dadi-brain/dadi restore --person ${from.name} --apply`);
    return { ok: true, tasks: nt, reminders: nr, cands: nc, pending: pend.length };
  }
  if (op === 'person/update') { const x = person(b.id); if (!x) throw Object.assign(new Error('没有这个人'), { code: 404 }); if (b.name) x.name = str(b.name, 30); if (Array.isArray(b.caps) && x.role !== 'owner') x.caps = b.caps.filter(c => ALL_CAPS.includes(c)); if (Array.isArray(b.off)) x.off = b.off.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 60); if (typeof b.disabled === 'boolean' && x.role !== 'owner') { const was = !!x.disabled; x.disabled = b.disabled; if (b.disabled && !was) { let n = 0; for (const t of db.tasks) if (t.assignee === x.id && OPEN.includes(t.status)) { const to = assigneeFor(t.category); if (t.status === '等确认' && t.check) { t.check = null; t.status = '进行中'; } t.from = { id: x.id, by: x.name, reason: `${x.name} 已停用，按分工表转来`, at: now() }; taskUpdate(t, { assignee: to, note: `${x.name} 已停用，按分工表转给 ${pname(to)}` }, me.name, me.id); n++; } for (const r of db.reminders) if (!r.sent && !r.cancelled && r.to === x.id) r.cancelled = true; save('reminders'); audit(me.name, '停用', `${x.name}：名下 ${n} 个任务按分工表转出`); } } if (Array.isArray(b.takeover) && x.role !== 'owner') { x.takeover = b.takeover.filter(id => id !== x.id && db.people.some(q => q.id === id && q.role !== 'agent')).slice(0, 5); audit(me.name, '交接备份', `${x.name} 可以取回：${x.takeover.map(pname).join('、') || '无'}`); } if (b.notify && ['none', 'ntfy', 'webhook'].includes(b.notify.kind)) x.notify = { kind: b.notify.kind, target: str(b.notify.target, 300) }; if (b.prompt && typeof b.prompt === 'object') { const hm = v => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : ''); if ((b.prompt.morning && !hm(b.prompt.morning)) || (b.prompt.evening && !hm(b.prompt.evening))) throw new Error('时间写成 09:00 这样'); x.prompt = { on: b.prompt.on !== false, morning: hm(b.prompt.morning) || '09:00', evening: hm(b.prompt.evening) || '18:00' }; audit(me.name, '改弹窗时间', `${x.name} 早上 ${x.prompt.morning}・下班 ${x.prompt.evening}${x.prompt.on ? '' : '・关'}`); } let key; if (b.rekey) { key = 'dk_' + crypto.randomBytes(18).toString('base64url'); x.keyHash = sha(key); if (x.role === 'owner') fs.writeFileSync(path.join(DATA, 'owner.key'), key + '\n', { mode: 0o600 }); } save('people'); audit(me.name, '改成员', `${x.name}${b.rekey ? '（换钥匙）' : ''}${b.disabled ? '（停用）' : ''}`); return { ok: true, key }; }
  throw Object.assign(new Error('没有这个操作'), { code: 404 });
}

/* 页面上取某个同事备份里的一个文件（主机本机、所有者看） */
export function ownerBeat(ev) { const o = owner(); if (o) beat(o, { ev, cwd: 'ask ala' }); }
export const _test = { activeMin, beats: () => db.beats };   /* 只给测试用 */
export function talkGet(person, date, session, by) { const t = db.people.find(x => x.id === person || x.name === person), r = t && talkRead(t, date, session); if (r) audit(by || '所有者', '看对话', `${t.name} ${r.date} ${r.title}`); return r; }
export function backupList(person) { const t = db.people.find(x => x.id === person || x.name === person); return t ? bkList(t) : null; }
export function backupStream(person, key, res) { const t = db.people.find(x => x.id === person || x.name === person), f = t && bkPath(t, key); if (!f) return false; sendFile(res, f, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(f))}` }); return true; }
