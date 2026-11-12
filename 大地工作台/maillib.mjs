// 大地工作台 · Gmail 直连
// 用 Google 账号的「应用专用密码」走 IMAP（imap.gmail.com:993），本机直接读收件箱里没读的邮件，不经过 Claude、不花 token。
// 返回格式照 claude.ai Gmail 连接器的 search_threads：{threads:[{id,viewUrl,messages:[{sender,subject,snippet,date,viewUrl}]}]}。
// 账号和密码存在 data/mail.json（0600，仅本人可读）；不写日志、不交给模型。
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import net from 'node:net';

let FILE = '', saved = null, bad = '', badAt = 0;
const HOST = process.env.DADI_IMAP_HOST || 'imap.gmail.com', PORT = Number(process.env.DADI_IMAP_PORT || 993), PLAIN = !!process.env.DADI_IMAP_HOST && process.env.DADI_IMAP_TLS !== '1';
export function mailInit(dataDir) {
  FILE = path.join(dataDir, 'mail.json');
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (!saved || !saved.user || !saved.pass) saved = null; } catch { saved = null; }
}
export const mailOn = () => !!(saved && !bad);
export const mailInfo = () => (saved ? { on: !bad, user: saved.user, at: saved.at, bad } : null);
setInterval(async () => {   /* 登录失败过：每 5 分钟真的登录试一次（不是只连上 TCP），成功才算恢复 */
  if (!bad || !saved || Date.now() - badAt < 300e3) return; badAt = Date.now();
  let c = null; try { c = await open(saved.user, saved.pass); await c.login(); bad = ''; } catch {} finally { if (c) await c.logout(); }
}, 60e3).unref();

/* ── 极简 IMAP 客户端：一条命令一个回包，带 {n} 字面量 ── */
function open(user, pass) {
  return new Promise((resolve, reject) => {
    const sock = PLAIN ? net.connect({ host: HOST, port: PORT }) : tls.connect({ host: HOST, port: PORT, servername: HOST });
    let buf = Buffer.alloc(0), tag = 0, pending = null, greeted = false, cur = null, dead = null;
    const fail = e => { dead = dead || e; if (pending) { pending.reject(e); pending = null; } else if (!greeted) reject(e); try { sock.destroy(); } catch {} };   /* 断了就记住：之后的命令立刻拒，不再干等 25 秒 */
    const timer = () => setTimeout(() => fail(Object.assign(new Error('IMAP 超时'), { code: 'timeout' })), 25000);
    let t = timer();
    sock.on('error', fail); sock.on('close', () => fail(Object.assign(new Error('连接断了'), { code: 'tool_error' })));
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (cur && cur.need > 0) { if (buf.length < cur.need) return; cur.lits.push(buf.subarray(0, cur.need)); cur.text += `\u0000${cur.lits.length - 1}\u0000`; buf = buf.subarray(cur.need); cur.need = 0; }
        const i = buf.indexOf('\r\n'); if (i < 0) return;
        const line = buf.subarray(0, i).toString('latin1'); buf = buf.subarray(i + 2);
        if (!cur) cur = { text: '', lits: [], need: 0 };
        cur.text += line;
        const m = /\{(\d+)\}$/.exec(line);
        if (m) { cur.need = Number(m[1]); continue; }
        const done = cur; cur = null;
        if (!greeted) { greeted = true; clearTimeout(t); if (/^\* (OK|PREAUTH)/.test(done.text)) resolve(api); else reject(new Error('IMAP 没准备好：' + done.text.slice(0, 80))); continue; }
        if (!pending) continue;
        const tm = new RegExp('^' + pending.tag + ' (OK|NO|BAD)\\b(.*)$').exec(done.text);
        if (tm) { const p = pending; pending = null; clearTimeout(t); p.resolve({ status: tm[1], text: tm[2].trim(), lines: p.lines }); }
        else if (done.text.startsWith('* ')) pending.lines.push(done);
      }
    });
    const cmd = (s) => new Promise((res, rej) => {
      if (dead) return rej(dead);
      const tg = 'A' + (++tag);
      pending = { tag: tg, resolve: res, reject: rej, lines: [] };
      clearTimeout(t); t = timer();
      try { sock.write(tg + ' ' + s + '\r\n'); } catch (e) { fail(e); }
    });
    const api = {
      cmd,
      async login() { const r = await cmd(`LOGIN ${q(user)} ${q(pass)}`); if (r.status !== 'OK') throw Object.assign(new Error('Gmail 不认这个账号或应用密码：' + r.text), { code: 'dead' }); },
      async logout() { if (!dead) { try { await cmd('LOGOUT'); } catch {} } clearTimeout(t); try { sock.end(); } catch {} try { sock.destroy(); } catch {} },
    };
  });
}
const q = s => '"' + String(s).replace(/["\\]/g, c => '\\' + c) + '"';

/* ── 解码：RFC 2047 标题、quoted-printable、base64、各种字符集 ── */
function dec(bytes, charset) { try { return new TextDecoder((charset || 'utf-8').toLowerCase().replace(/^x-/, '')).decode(bytes); } catch { return Buffer.from(bytes).toString('utf8'); } }
function qp(s) { return Buffer.from(String(s).replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1'); }
function words(s) {
  return String(s || '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s+(?==\?))?/g, (_, cs, enc, data) => {
    const bytes = /b/i.test(enc) ? Buffer.from(data, 'base64') : qp(data.replace(/_/g, ' '));
    return dec(bytes, cs);
  });
}
function headers(lit) {
  const h = {}, text = Buffer.from(lit).toString('latin1').replace(/\r?\n[ \t]+/g, ' ');
  for (const line of text.split(/\r?\n/)) { const m = /^([\w-]+):\s*(.*)$/.exec(line); if (m) h[m[1].toLowerCase()] = m[2]; }
  return h;
}
/* 多段邮件（multipart）：按 boundary 拆开，里面还是 multipart（正文＋附件、内嵌图片都是这种套法）就再拆，最多 4 层，得到一串叶子段 {body, ct, cte} */
function leaves(text, ct, cte, depth = 0) {
  const bm = /boundary="?([^";\r\n]+)"?/i.exec(ct);
  if (!bm || depth > 4) return [{ body: text, ct, cte }];
  const out = [];
  for (const p of text.split('--' + bm[1]).slice(1)) {
    if (/^--/.test(p)) break;   /* --boundary-- 结束标记，后面是尾注 */
    const k = p.search(/\r?\n\r?\n/), ph = headers(Buffer.from(k >= 0 ? p.slice(0, k) : '', 'latin1'));
    out.push(...leaves(k >= 0 ? p.slice(k).replace(/^\r?\n\r?\n/, '') : p, String(ph['content-type'] || 'text/plain'), String(ph['content-transfer-encoding'] || '').toLowerCase(), depth + 1));
  }
  return out.length ? out : [{ body: text, ct: 'text/plain', cte }];
}
function snippet(lit, h) {   /* 第一段 text/plain（没有就 text/html），用它自己的编码和字符集 */
  const L = leaves(Buffer.from(lit).toString('latin1'), String(h['content-type'] || ''), String(h['content-transfer-encoding'] || '').toLowerCase());
  const pick = L.find(x => /^\s*text\/plain/i.test(x.ct)) || L.find(x => /^\s*text\/html/i.test(x.ct)) || L[0];
  const ct = pick.ct, cte = pick.cte, raw = Buffer.from(pick.body, 'latin1');
  const cs = (/charset="?([^";\s]+)"?/i.exec(ct) || [])[1] || 'utf-8';
  let bytes = raw;
  if (cte === 'base64') { const b = raw.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, ''); bytes = Buffer.from(b.slice(0, b.length - (b.length % 4)), 'base64'); }
  else if (cte === 'quoted-printable') bytes = qp(raw.toString('latin1'));
  let s = dec(bytes, cs);
  if (/html/i.test(ct)) s = s.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return s.replace(/\s+/g, ' ').trim().slice(0, 240);
}
function fetchParse(done) {   /* 一条 * n FETCH (…) 的回包：文字里 \u0000k\u0000 是第 k 个字面量 */
  const T = done.text, L = done.lits, get = re => (re.exec(T) || [])[1] || '';
  const lit = key => { const i = T.indexOf(key); if (i < 0) return null; const m = /\u0000(\d+)\u0000/.exec(T.slice(i)); return m ? L[Number(m[1])] : null; };
  return { uid: get(/\bUID (\d+)/), msgid: get(/X-GM-MSGID (\d+)/), thrid: get(/X-GM-THRID (\d+)/), date: get(/INTERNALDATE "([^"]+)"/), head: lit('BODY[HEADER.FIELDS'), body: lit('BODY[TEXT]') };
}
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function imapDate(d) {   /* INTERNALDATE 的写法 "20-Oct-2026 09:15:00 +0900"；认不出就试邮件头的 Date */
  const m = /^\s*(\d{1,2})-(\w{3})-(\d{4}) (\d\d):(\d\d):(\d\d) ([+-])(\d\d)(\d\d)/.exec(String(d || ''));
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
    const off = (m[7] === '-' ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]));
    return new Date(Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +m[4], +m[5] - off, +m[6])).toISOString();
  }
  const x = new Date(d); return isNaN(x) ? '' : x.toISOString();
}
const hex = n => { try { return BigInt(n).toString(16); } catch { return String(n); } };

/* ── 两天内没读的收件箱邮件 → 连接器格式 ── */
async function searchThreads(input) {
  const days = Math.max(1, Number((/newer_than:(\d+)d/.exec(String(input.query || '')) || [])[1]) || 2);
  const since = new Date(Date.now() - days * 86400e3), MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const sinceStr = `${since.getUTCDate()}-${MON[since.getUTCMonth()]}-${since.getUTCFullYear()}`;
  const unread = !/\bis:read\b/.test(String(input.query || ''));   /* 页面只问「没读的」；写了 is:read 才连读过的一起给 */
  const c = await open(saved.user, saved.pass);
  try {
    await c.login();
    const sel = await c.cmd('SELECT INBOX'); if (sel.status !== 'OK') throw Object.assign(new Error('打不开收件箱：' + sel.text), { code: 'tool_error' });
    const sr = await c.cmd(`UID SEARCH ${unread ? 'UNSEEN ' : ''}SINCE ${sinceStr}`);
    const uids = sr.lines.flatMap(l => (/^\* SEARCH\s*(.*)$/.exec(l.text) || [, ''])[1].trim().split(/\s+/).filter(Boolean)).map(Number).filter(Boolean).sort((a, b) => b - a).slice(0, Math.min(50, Number(input.pageSize) || 15));
    const threads = new Map();
    if (uids.length) {
      const fr = await c.cmd(`UID FETCH ${uids.join(',')} (UID X-GM-MSGID X-GM-THRID INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] BODY.PEEK[TEXT]<0.2000>)`);
      for (const l of fr.lines) {
        if (!/^\* \d+ FETCH/.test(l.text)) continue;
        const m = fetchParse(l), h = m.head ? headers(m.head) : {};
        const msg = { sender: words(h.from || ''), subject: words(h.subject || '') || '（无标题）', snippet: m.body ? snippet(m.body, h) : '', date: imapDate(m.date || h.date || ''), viewUrl: m.msgid ? `https://mail.google.com/mail/u/0/#all/${hex(m.msgid)}` : '' };
        const tid = m.thrid ? hex(m.thrid) : (m.msgid ? hex(m.msgid) : 'u' + m.uid);
        const t = threads.get(tid) || { id: tid, viewUrl: msg.viewUrl, messages: [] };
        t.messages.push(msg); if (!t.viewUrl) t.viewUrl = msg.viewUrl; threads.set(tid, t);
      }
    }
    const out = [...threads.values()].map(t => { t.messages.sort((a, b) => String(a.date).localeCompare(String(b.date))); return t; }).sort((a, b) => String(b.messages[b.messages.length - 1].date).localeCompare(String(a.messages[a.messages.length - 1].date)));
    return JSON.stringify({ threads: out, nextPageToken: '' });
  } finally { await c.logout(); }
}

/* ── 保存前先试登录 ── */
export async function mailSetToken(user, pass) {
  user = String(user || '').trim(); pass = String(pass || '').replace(/\s+/g, '');
  if (!user && !pass) { saved = null; bad = ''; try { fs.unlinkSync(FILE); } catch {} return { ok: true, off: true }; }
  if (!/^[^@\s]+@[^@\s]+$/.test(user)) return { ok: false, error: '邮箱地址不对' };
  if (!/^[a-z]{16}$/i.test(pass)) return { ok: false, error: '这不是「应用专用密码」。应用专用密码是 16 个小写字母（显示成 4 组 4 个），不是平时登录 Google 的密码；到 myaccount.google.com/apppasswords 生成一个' };
  let c;
  try { c = await open(user, pass); await c.login(); const r = await c.cmd('SELECT INBOX'); if (r.status !== 'OK') throw new Error('打不开收件箱：' + r.text); }
  catch (e) { if (c) await c.logout(); return { ok: false, error: e.message || String(e) }; }
  await c.logout();
  saved = { user, pass, at: Date.now() }; bad = '';
  fs.writeFileSync(FILE, JSON.stringify(saved), { mode: 0o600 });
  return { ok: true, user };
}

const TOOLS = { search_threads: searchThreads };
export const mailCan = tool => !!TOOLS[tool];
export async function mailDirect(tool, input) {
  if (!mailOn() || !TOOLS[tool]) return null;
  try { return { ok: true, text: await TOOLS[tool](input || {}) }; }
  catch (e) {
    if (e.code === 'dead') { bad = e.message; badAt = Date.now(); return null; }
    return { ok: false, code: e.code === 'timeout' ? 'timeout' : 'tool_error', error: String(e.message || e) };
  }
}
export const _test = { words, snippet, headers, fetchParse, setSaved: v => { saved = v; bad = ''; } };
