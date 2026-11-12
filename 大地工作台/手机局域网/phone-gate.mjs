#!/usr/bin/env node
// 手机在同一个局域网里打开大地工作台（原版）：这个小程序在 8851 端口听局域网，先要密码登录，登录后把请求原样转给本机的 127.0.0.1:8850。
// 原版工作台的代码一行不改：它照旧只认本机，这里替手机把门。
// 密码第一次在 Mac 上打开 http://127.0.0.1:8851/ 设（只能在本机设）；只存加盐散列。登录 30 天有效；同一来源 15 分钟内输错 5 次就挡住。
// 局域网里走的是 http（不加密）：只在自己家里、公司这种信得过的 Wi-Fi 下用。
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const TARGET = Number(process.env.DADI_PORT || 8850);          // 原版工作台
const PORT = Number(process.env.DADI_PHONE_PORT || 8851);      // 手机打开的端口
const DATA = process.env.DADI_DATA || path.join(os.homedir(), 'Library', 'Application Support', 'dadi-workbench');   /* 和原版同一个数据目录：原版的硬规则不让 Claude 读这里 */
const PASS_FILE = path.join(DATA, 'phone-pass.json'), SESS_FILE = path.join(DATA, 'phone-sessions.json');
const COOKIE = 'dadi_phone', DAYS = 30;

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(v), { mode: 0o600 }); fs.renameSync(t, f); };
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const hashPass = (pw, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(String(pw), salt, 64).toString('hex') });
const passOk = pw => { const p = readJson(PASS_FILE); if (!p || !p.salt || !p.hash) return false; const a = Buffer.from(crypto.scryptSync(String(pw || ''), p.salt, 64).toString('hex')), b = Buffer.from(p.hash); return a.length === b.length && crypto.timingSafeEqual(a, b); };
let SESS = (readJson(SESS_FILE) || []).filter(s => s && s.h && s.exp > Date.now());
const saveSess = () => { try { writeJson(SESS_FILE, SESS); } catch {} };
const cookieOf = req => { for (const part of String(req.headers.cookie || '').split(/;\s*/)) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i) === COOKIE) return part.slice(i + 1); } return ''; };
const authed = req => { const t = cookieOf(req); if (!t) return false; const h = sha(t), now = Date.now(); return SESS.some(s => s.h === h && s.exp > now); };
const loopback = req => /^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || '');
/* 只认这几种地址打开：本机、局域网 IP（192.168／10／172.16–31）、这台 Mac 的 .local 名字；别的（比如 DNS 重绑定来的域名）一律拒 */
const HOST_OK = h => new RegExp(`^(127\\.0\\.0\\.1|localhost|192\\.168\\.\\d{1,3}\\.\\d{1,3}|10\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|172\\.(1[6-9]|2\\d|3[01])\\.\\d{1,3}\\.\\d{1,3}|[\\w-]+\\.local):${PORT}$`, 'i').test(h || '');
const fails = new Map();   /* ip → { n, at } */

const PAGE = (title, body) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${title} · 大地工作台</title>
<meta name="theme-color" content="#f4f1ea"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="大地工作台">
<style>:root{--bg:#f4f1ea;--ink:#141414;--ink-2:#4a4a4a;--ink-3:#7a7a7a;--line:rgba(20,20,20,.08);--line-dark:rgba(20,20,20,.16);--accent:#ee6a2d;--bad:#c2372c}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;font-size:15px;line-height:1.5;color:var(--ink);background:var(--bg);min-height:100vh;display:grid;place-items:center;padding:24px 16px;-webkit-font-smoothing:antialiased}
main{width:100%;max-width:380px;background:#fff;border:1px solid var(--line);border-radius:28px;padding:32px 24px;box-shadow:0 10px 40px rgba(20,20,20,.08);text-align:center}
.mark{font-family:"Bodoni 72",Didot,Georgia,serif;font-size:32px;font-weight:600;width:56px;height:56px;border-radius:50%;background:var(--accent);color:#fff;display:grid;place-items:center;padding-bottom:4px;margin:0 auto 16px}
h1{font-size:22px;font-weight:600}.who{color:var(--ink-2);font-size:13px;margin:6px 0 24px}
input{width:100%;height:48px;padding:0 16px;border:1px solid var(--line-dark);border-radius:12px;font:inherit;text-align:center;margin-bottom:10px}input:focus{outline:none;border-color:var(--ink)}
button{margin-top:6px;width:100%;height:48px;border:0;border-radius:999px;background:var(--ink);color:#fff;font:inherit;font-weight:600;cursor:pointer}button:disabled{opacity:.5}
.msg{min-height:20px;margin-top:12px;font-size:13px;color:var(--bad)}.note{font-size:12px;color:var(--ink-3);margin-top:16px}</style></head><body><main><div class="mark" aria-hidden="true">a</div><h1>大地工作台</h1>${body}</main></body></html>`;
const FORM = (who, note, setup) => `<p class="who">${who}</p><form id="f"><input id="pw" type="password" autocomplete="${setup ? 'new-password' : 'current-password'}" placeholder="${setup ? '设一个手机登录密码（至少 8 位）' : '手机登录密码'}" required>${setup ? '<input id="pw2" type="password" autocomplete="new-password" placeholder="再输一次" required>' : ''}<button id="b">${setup ? '设好密码' : '登录'}</button><p class="msg" id="m" role="alert"></p></form><p class="note">${note}</p>
<script>document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();const m=document.getElementById('m'),b=document.getElementById('b'),pw=document.getElementById('pw').value;m.textContent='';
${setup ? "if(pw!==document.getElementById('pw2').value){m.textContent='两次输入的密码不一样';return;}" : ''}b.disabled=true;
try{const r=await fetch('${setup ? '/__phone/setpass' : '/__phone/login'}',{method:'POST',headers:{'content-type':'application/json','x-dadi':'1'},body:JSON.stringify({password:pw})});let d={};try{d=await r.json();}catch(_){}
if(!r.ok)throw new Error(d.error||('没成（'+r.status+'）'));location.href='/';}catch(err){m.textContent=err.message;b.disabled=false;}});</script>`;
const html = (res, code, s) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' }); res.end(s); };
const json = (res, code, o, extra = {}) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }); res.end(JSON.stringify(o)); };
const readBody = req => new Promise(r => { let b = ''; req.on('data', d => { if (b.length < 4096) b += d; }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } }); req.on('error', () => r({})); });

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || '';
    if (!HOST_OK(host)) return json(res, 403, { error: '只能用这台 Mac 的局域网地址打开' });
    /* 别的网站发来的请求一律拒：转给原版前会把 Origin 改成本机，所以这里先查 */
    if (req.headers.origin && req.headers.origin !== 'http://' + host) return json(res, 403, { error: '只能从工作台页面调用' });
    const p = new URL(req.url, 'http://x').pathname, hasPass = !!readJson(PASS_FILE);
    const fmtOk = () => req.headers['x-dadi'] === '1' && /^application\/json/.test(req.headers['content-type'] || '');
    if (p === '/__phone/setpass' && req.method === 'POST') {   /* 设、改手机密码：只能在这台 Mac 上 */
      if (!loopback(req) || !/^(127\.0\.0\.1|localhost):/.test(host)) return json(res, 403, { error: '手机密码只能在这台 Mac 上设' });
      if (!fmtOk()) return json(res, 400, { error: '请求格式不对' });
      const b = await readBody(req), pw = String(b.password || '');
      if (pw.length < 8) return json(res, 400, { error: '密码至少 8 位' });
      writeJson(PASS_FILE, hashPass(pw)); SESS = []; saveSess();   /* 改了密码：手机上的旧登录全部作废 */
      return json(res, 200, { ok: true });
    }
    if (p === '/__phone/login' && req.method === 'POST') {
      if (!fmtOk()) return json(res, 400, { error: '请求格式不对' });
      const ip = String(req.socket.remoteAddress || ''), now = Date.now();
      for (const [k, v] of fails) if (now - v.at > 15 * 60e3) fails.delete(k);
      const mine = fails.get(ip) || { n: 0, at: now }, total = [...fails.values()].reduce((n, v) => n + v.n, 0);
      if (mine.n >= 5 || total >= 20) return json(res, 429, { error: '试错太多次，15 分钟后再试' });
      const b = await readBody(req);
      if (!hasPass || !passOk(b.password)) { fails.set(ip, { n: mine.n + 1, at: mine.n ? mine.at : now }); return json(res, 401, { error: hasPass ? '密码不对' : '还没设手机密码：先在 Mac 上打开 http://127.0.0.1:' + PORT + '/ 设' }); }
      fails.delete(ip);
      const t = crypto.randomBytes(32).toString('base64url');
      SESS = SESS.filter(s => s.exp > now); SESS.push({ h: sha(t), at: now, exp: now + DAYS * 86400e3, ua: String(req.headers['user-agent'] || '').slice(0, 80) }); SESS = SESS.slice(-20); saveSess();
      return json(res, 200, { ok: true }, { 'set-cookie': `${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${DAYS * 86400}` });
    }
    if (p === '/__phone/logout' && req.method === 'POST') {
      const t = cookieOf(req); if (t) { const h = sha(t); SESS = SESS.filter(s => s.h !== h); saveSess(); }
      return json(res, 200, { ok: true }, { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` });
    }
    if (!authed(req)) {
      if (req.method !== 'GET' || p.startsWith('/api/')) return json(res, 401, { error: '先登录', code: 'login' });
      if (!hasPass) return html(res, 200, PAGE('设手机密码', loopback(req) && /^(127\.0\.0\.1|localhost):/.test(host)
        ? FORM('第一次用：设一个手机登录密码', '设好以后，手机连同一个 Wi-Fi，打开 http://这台Mac的局域网IP:' + PORT + '/ 用这个密码登录。', true)
        : '<p class="who">还没设手机密码</p><p class="note">先在这台 Mac 上打开 http://127.0.0.1:' + PORT + '/ 设一个手机登录密码。</p>'));
      return html(res, 200, PAGE('登录', FORM('请登录', '登录后 30 天内不用再输。局域网里不加密：只在自己家、公司这种信得过的 Wi-Fi 下用。', false)));
    }
    /* 登录了：原样转给原版工作台，只把地址改成本机（原版只认本机） */
    const headers = { ...req.headers, host: `127.0.0.1:${TARGET}` };
    if (headers.origin) headers.origin = `http://127.0.0.1:${TARGET}`;
    if (headers.referer) headers.referer = String(headers.referer).replace(/^http:\/\/[^/]+/, `http://127.0.0.1:${TARGET}`);
    delete headers.cookie;   /* 手机登录的 cookie 不往原版传 */
    const up = http.request({ host: '127.0.0.1', port: TARGET, method: req.method, path: req.url, headers }, r => {
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);   /* 一段段往回传：ask ala 的实时输出（SSE）也照常 */
    });
    up.on('error', () => { if (!res.headersSent) json(res, 502, { error: '工作台程序没有在运行（127.0.0.1:' + TARGET + '）' }); else res.end(); });
    req.on('close', () => { if (!res.writableEnded) up.destroy(); });
    req.pipe(up);
  } catch (e) {
    try { json(res, 500, { error: String((e && e.message) || e) }); } catch {}
  }
});
server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `手机入口已经在运行：端口 ${PORT}` : '启动失败：' + e.message); process.exit(e.code === 'EADDRINUSE' ? 0 : 1); });
server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
  console.log(`手机入口已启动：${ips.map(ip => `http://${ip}:${PORT}/`).join('  ')}（转给 127.0.0.1:${TARGET}）`);
});
