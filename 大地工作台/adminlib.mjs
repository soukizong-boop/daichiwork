// 网站后台（alaco.ai）读写的公共部分。桥接程序和给 Claude Code 用的后台工具都从这里走。
// 代表 2026-10-02 明确同意：在页面上登录一次后，登录凭证保存在本机 data/admin.json（仅本人可读，7 天有效），
// 之后页面直接显示后台数据。密码只发给 alaco.ai，不记录、不发给页面、不经过任何模型。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const DATA = process.env.DADI_DATA || path.join(process.env.HOME || '', 'Library', 'Application Support', 'dadi-workbench');
export const ADMIN_BASE = (process.env.DADI_ADMIN_BASE || 'https://alaco.ai/api').replace(/\/+$/, '');
const FILE = path.join(DATA, 'admin.json');

export const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
export function writeJson(f, v) {
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  fs.writeFileSync(f, JSON.stringify(v, null, 1), { mode: 0o600 });
  try { fs.chmodSync(f, 0o600); } catch {}
}

/** 只认 /admin/ 开头的路径：不能跳到别的主机，也不能往上级路径走 */
const plain = p => { try { return decodeURIComponent(String(p)); } catch { return '\u0000'; } };
export const okPath = p => typeof p === 'string' && p.length < 600 && /^\/admin\/[^\s#\\]*$/.test(p) && !p.includes('..') && !p.includes('//') && !/\.\.|\/\/|\\|\u0000/.test(plain(p)) && !/%2f|%2e/i.test(p) && !/(^|\/)\.(\/|\?|$)/.test(plain(p));
/** 账号与登录相关的接口只有页面本身能碰（后台路由不分大小写，这里也不分；先按 URL 规则归一化再判断） */
const normPath = p => { try { return new URL(plain(p), 'http://x').pathname.replace(/\/+/g, '/'); } catch { return plain(p).split('?')[0].replace(/\/+/g, '/'); } };
export const closedPath = p => /^\/admin\/(auth|accounts)(\/|$)/i.test(normPath(p));

export const adminUser = () => { const a = readJson(FILE); return a && a.token ? Object.assign({ since: a.at }, a.user || {}) : null; };
export function adminForget() { try { fs.unlinkSync(FILE); } catch {} }

async function send(method, p, body, token) {
  const headers = {};
  if (token) headers.authorization = 'Bearer ' + token;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(ADMIN_BASE + p, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000), redirect: 'error',
  });
  const raw = await r.text();
  let data = raw;
  try { data = JSON.parse(raw); } catch {}
  return { status: r.status, data };
}
export const adminWords = d => { const m = d && typeof d === 'object' && d.message; return Array.isArray(m) ? m.join('；') : (m || ''); };

export async function adminLogin(username, password) {
  const r = await send('POST', '/admin/auth/login', { username, password });
  if (r.status >= 300 || !r.data || !r.data.token) return { ok: false, status: r.status, message: adminWords(r.data) || '登录没有成功' };
  writeJson(FILE, { token: r.data.token, user: r.data.user || {}, at: Date.now() });
  return { ok: true, user: r.data.user || {} };
}
export async function adminLogout() {
  const a = readJson(FILE);
  adminForget();
  if (a && a.token) { try { await send('POST', '/admin/auth/logout', {}, a.token); } catch {} }
}

/** 带着本机存的登录去读写后台。登录失效（401）就把本机的登录删掉，让页面重新登录。 */
export async function adminCall(method, p, body) {
  if (!okPath(p)) return { status: 400, data: { message: '路径必须以 /admin/ 开头' } };
  const a = readJson(FILE);
  if (!a || !a.token) return { status: 401, data: { message: '还没有登录后台。请在大地工作台的「网站后台」里登录。' } };
  const r = await send(method, p, body, a.token);
  if (r.status === 401) adminForget();
  return r;
}

/** 把本机的一张图片传到后台（POST /admin/upload，multipart 字段 file），返回 {status,data}，data.url 是后台给的地址。
    只收图片（png/jpg/jpeg/gif/webp）、12MB 以内、必须在本人用户目录下、不在隐藏目录里。 */
export async function adminUpload(filePath) {
  const fsp = await import('node:fs/promises');
  const home = process.env.HOME || '';
  let real; try { real = await fsp.realpath(String(filePath || '')); } catch { return { status: 400, data: { message: '文件不存在：' + filePath } }; }
  if (!home || !real.startsWith(home + path.sep)) return { status: 400, data: { message: '只能上传本人用户目录下的文件' } };
  if (real.split(path.sep).some(seg => seg.startsWith('.') && seg !== '.')) return { status: 400, data: { message: '隐藏目录里的文件不能上传' } };
  const ext = path.extname(real).toLowerCase(); const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[ext];
  if (!type) return { status: 400, data: { message: '只能上传 png／jpg／gif／webp 图片' } };
  const st = await fsp.stat(real); if (!st.isFile() || st.size > 12 * 1024 * 1024) return { status: 400, data: { message: '文件太大（最大 12MB）或不是文件' } };
  const a = readJson(FILE);
  if (!a || !a.token) return { status: 401, data: { message: '还没有登录后台。请在大地工作台的「网站后台」里登录。' } };
  const fd = new FormData(); fd.append('file', new Blob([await fsp.readFile(real)], { type }), path.basename(real));
  const r = await fetch(ADMIN_BASE + '/admin/upload', { method: 'POST', headers: { authorization: 'Bearer ' + a.token }, body: fd, signal: AbortSignal.timeout(60000), redirect: 'error' });
  const raw = await r.text(); let data = raw; try { data = JSON.parse(raw); } catch {}
  if (r.status === 401) adminForget();
  if (data && typeof data === 'object' && data.data && data.data.url && !data.url) data.url = data.data.url;   /* 后台有时包一层 data */
  return { status: r.status, data };
}
