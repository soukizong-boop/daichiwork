// 大地工作台 · Google Drive 直连
// 读写本机 Google Drive 桌面版挂载的共享云端硬盘（~/Library/CloudStorage/GoogleDrive-…/共享云端硬盘/），不经过 Claude、不花 token。
// 每个文件和文件夹的 Drive 编号就在扩展属性里（com.google.drivefs.item-id#S），所以编号、链接和 claude.ai 连接器完全一致，页面不用改。
// 返回格式照连接器：search_files → {files:[…]}，read_file_content → {fileContent}，download_file_content → {content(base64)}。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';

const XATTR = 'com.google.drivefs.item-id#S';
const FOLDER = 'application/vnd.google-apps.folder';
const POINTER = { '.gdoc': 'application/vnd.google-apps.document', '.gsheet': 'application/vnd.google-apps.spreadsheet', '.gslides': 'application/vnd.google-apps.presentation', '.gform': 'application/vnd.google-apps.form', '.gdraw': 'application/vnd.google-apps.drawing', '.gjam': 'application/vnd.google-apps.jam', '.gsite': 'application/vnd.google-apps.site', '.gmap': 'application/vnd.google-apps.map' };
const MIME = { '.pdf': 'application/pdf', '.md': 'text/markdown', '.txt': 'text/plain', '.csv': 'text/csv', '.json': 'application/json', '.html': 'text/html', '.htm': 'text/html', '.xml': 'text/xml',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.doc': 'application/msword', '.xls': 'application/vnd.ms-excel', '.ppt': 'application/vnd.ms-powerpoint', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.zip': 'application/zip', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg' };
const TEXTLIKE = /^(text\/|application\/json$)/;

let MOUNT = '', DRIVES = [], onFlag = false, note = '';
const byId = new Map();        // 编号 → { p: 路径, parentId }
const dirCache = new Map();    // 文件夹路径 → { mtime, items }
const J = v => JSON.stringify(v);
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const localId = p => 'local_' + crypto.createHash('sha1').update(p).digest('base64url').slice(0, 22);

/* ── 启动：找挂载点（可用 DADI_DRIVE_MOUNT 指定，测试用） ── */
export function driveInit(opt = {}) {
  MOUNT = opt.mount || findMount(); DRIVES = []; byId.clear(); dirCache.clear();
  if (MOUNT && isDir(MOUNT)) {
    for (const name of safeReaddir(MOUNT)) {
      const dir = path.join(MOUNT, name); if (!isDir(dir)) continue;
      const id = xattrOne(dir) || localId(dir);
      DRIVES.push({ id, name, dir }); byId.set(id, { p: dir, parentId: '' });
    }
  }
  DRIVES.sort((a, b) => (b.name === '大地 AI 工作任务') - (a.name === '大地 AI 工作任务'));   /* 任务盘排最前：编号大多在这里，找起来快 */
  onFlag = DRIVES.length > 0;
  note = onFlag ? '' : '没找到 Google Drive 桌面版挂载的共享云端硬盘（~/Library/CloudStorage/GoogleDrive-…/共享云端硬盘/）';
  return driveInfo();
}
function findMount() {
  const base = path.join(os.homedir(), 'Library', 'CloudStorage');
  const cands = safeReaddir(base).filter(n => n.startsWith('GoogleDrive-')).map(n => path.join(base, n, '共享云端硬盘')).filter(isDir);
  return cands.find(d => isDir(path.join(d, '大地 AI 工作任务'))) || cands[0] || '';
}
function safeReaddir(p) { try { return fs.readdirSync(p).filter(n => !n.startsWith('.') && !n.startsWith('~$') && n !== 'Icon\r'); } catch { return []; } }
export const driveOn = () => onFlag;
export const driveInfo = () => ({ on: onFlag, mount: MOUNT, drives: DRIVES.map(d => ({ id: d.id, name: d.name })), note });

/* ── 编号：从扩展属性读；没有（刚建、还没同步上去）就按路径算一个本机编号 ── */
function xattrOne(p) { try { return execFileSync('xattr', ['-p', XATTR, p], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || ''; } catch { return ''; } }
function xattrMany(paths) {
  const out = new Map();
  for (let i = 0; i < paths.length; i += 150) {
    const chunk = paths.slice(i, i + 150);
    if (chunk.length === 1) { const v = xattrOne(chunk[0]); if (v) out.set(chunk[0], v); continue; }
    const r = spawnSync('xattr', ['-p', XATTR, ...chunk], { encoding: 'utf8', maxBuffer: 32e6 });
    for (const line of String(r.stdout || '').split('\n')) {
      const k = line.lastIndexOf(': '); if (k < 0) continue;
      const p = line.slice(0, k), v = line.slice(k + 2).trim();
      if (p && v && !/^xattr:/.test(line)) out.set(p, v);
    }
  }
  return out;
}

/* ── 列一个文件夹：按文件夹的修改时间缓存，变了才重读；文件只改内容时文件夹的修改时间不一定变，所以页面直接列的文件夹最多信 60 秒（搜索走全盘时 10 分钟） ── */
function listDir(dir, parentId, maxAge = 600e3) {
  let st; try { st = fs.statSync(dir); } catch { return []; }
  const hit = dirCache.get(dir);
  if (hit && hit.mtime === st.mtimeMs && Date.now() - hit.at < maxAge) return hit.items;
  const names = safeReaddir(dir), paths = names.map(n => path.join(dir, n));
  const ids = xattrMany(paths), items = [], seen = new Set();
  names.forEach((name, i) => {
    const p = paths[i]; let s; try { s = fs.statSync(p); } catch { return; }
    const ext = path.extname(name).toLowerCase();
    const folder = s.isDirectory(), pointer = !folder && POINTER[ext];
    let id = ids.get(p) || (pointer ? pointerId(p) : '') || localId(p);
    if (seen.has(id)) id = localId(p);   /* 同一编号出现第二次（指针文件被本机复制过）：后者按路径给本机编号，不顶掉原文档 */
    seen.add(id);
    const title = pointer ? name.slice(0, -ext.length) : name;
    const mimeType = folder ? FOLDER : pointer || MIME[ext] || 'application/octet-stream';
    const f = { id, title, mimeType, modifiedTime: new Date(s.mtimeMs).toISOString(), createdTime: new Date(s.birthtimeMs || s.ctimeMs).toISOString(), parentId, size: folder ? undefined : s.size, viewUrl: urlOf(id, mimeType) };
    byId.set(id, { p, parentId });
    items.push(f);
  });
  items.sort((a, b) => String(b.modifiedTime).localeCompare(String(a.modifiedTime)));
  dirCache.set(dir, { mtime: st.mtimeMs, at: Date.now(), items });
  return items;
}
function pointerId(p) { try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); return j.doc_id || j.id || ''; } catch { return ''; } }
function urlOf(id, mime) {
  if (/^local_/.test(id)) return '';
  if (mime === FOLDER) return `https://drive.google.com/drive/folders/${id}`;
  if (mime === POINTER['.gdoc']) return `https://docs.google.com/document/d/${id}/edit`;
  if (mime === POINTER['.gsheet']) return `https://docs.google.com/spreadsheets/d/${id}/edit`;
  if (mime === POINTER['.gslides']) return `https://docs.google.com/presentation/d/${id}/edit`;
  return `https://drive.google.com/file/d/${id}/view`;
}
/* 编号 → 路径：先查记过的；没记过就把各个盘走一遍找（结果会记下）；找不到的十分钟内不再找 */
const missAt = new Map();
const stillIs = (p, id) => { const x = xattrOne(p); return !x || x === id; };   /* 那个位置的扩展属性还是这个编号（没编号＝还没同步上去，按路径信它） */
function resolve(id) {
  if (!id) return null;
  const hit = byId.get(id);
  if (hit) {
    /* 记过的路径还在、而且（真编号）位置上仍是这个编号才算命中；路径没了、或位置上换成了别的文件（被外部移走后又建了同名的），就忘掉重找 */
    if (fs.existsSync(hit.p) && (/^local_/.test(id) || stillIs(hit.p, id))) return hit;
    byId.delete(id);
  }
  if (Date.now() - (missAt.get(id) || 0) < 600e3) return null;
  for (const d of DRIVES) { walk(d.dir, d.id, 6, () => byId.has(id)); const h = byId.get(id); if (h && fs.existsSync(h.p)) return h; }
  missAt.set(id, Date.now());
  return null;
}
function walk(dir, parentId, depth, stop, visit) {
  if (depth < 0 || (stop && stop())) return;
  for (const f of listDir(dir, parentId)) {
    if (visit && visit(f) === false) return;
    if (f.mimeType === FOLDER) walk(byId.get(f.id).p, f.id, depth - 1, stop, visit);
    if (stop && stop()) return;
  }
}
function allFiles() {   /* 各个盘的全部条目（最多 6 层、2 万条），搜索用 */
  const out = []; let n = 0;
  for (const d of DRIVES) walk(d.dir, d.id, 6, () => n > 20000, f => { out.push(f); n++; });
  return out;
}

/* ── 查询：页面只用三种写法（parentId = 'x' or …／title contains 'x'／fullText contains 'x'），和连接器一样 ── */
function parseQuery(q) {
  q = String(q || '');
  const un = s => s.replace(/\\'/g, "'");
  return {
    parents: [...q.matchAll(/parentId\s*=\s*'([^']+)'/g)].map(m => m[1]),
    titles: [...q.matchAll(/title contains '((?:[^'\\]|\\.)*)'/g)].map(m => un(m[1]).toLowerCase()),
    full: [...q.matchAll(/fullText contains '((?:[^'\\]|\\.)*)'/g)].map(m => un(m[1]).toLowerCase()),
    folderOnly: /mimeType\s*=\s*'application\/vnd\.google-apps\.folder'/.test(q),
    trashed: /trashed\s*=\s*true/.test(q),
  };
}
function searchFiles(input) {
  const q = parseQuery(input.query), max = Math.min(200, Number(input.pageSize) || 100);
  if (q.trashed) return J({ files: [] });
  let files = [];
  if (q.parents.length) {
    for (const id of q.parents) { const h = resolve(id); if (!h) return null; files.push(...listDir(h.p, id, 60e3)); }   /* 有一个文件夹本机找不到（不是共享硬盘的、或还没同步到）：整条交给连接器，不给残缺的结果 */
  }
  else if (q.titles.length || q.full.length) {
    const all = allFiles();
    files = all.filter(f => {
      const t = f.title.toLowerCase();
      if (q.titles.length && q.titles.every(k => t.includes(k))) return true;
      if (q.full.length && q.full.every(k => t.includes(k))) return true;
      return false;
    });
    if (q.full.length && files.length < max) {   /* 正文：只翻文字类的小文件，最多 200 个、8 秒 */
      const seen = new Set(files.map(f => f.id)), t0 = Date.now(); let n = 0;
      for (const f of all) {
        if (seen.has(f.id) || !TEXTLIKE.test(f.mimeType) || (f.size || 0) > 256000) continue;
        if (++n > 200 || Date.now() - t0 > 8000) break;
        try { const t = fs.readFileSync(byId.get(f.id).p, 'utf8').toLowerCase(); if (q.full.every(k => t.includes(k))) { files.push(f); if (files.length >= max) break; } } catch {}
      }
    }
  } else return null;   /* 看不懂的查询：交给连接器 */
  if (q.titles.length && q.parents.length) files = files.filter(f => q.titles.every(k => f.title.toLowerCase().includes(k)));
  if (!q.parents.length) files.sort((a, b) => depthOf(byId.get(a.id).p) - depthOf(byId.get(b.id).p) || String(b.modifiedTime).localeCompare(String(a.modifiedTime)));   /* 按名字找：浅的在前（根目录那份总表排第一） */
  if (q.folderOnly) files = files.filter(f => f.mimeType === FOLDER);
  return J({ files: files.slice(0, max) });
}

/* ── 读内容：文字类直接读；PDF 用本机 PyMuPDF 抽字；docx 解开取正文；Google 文档只给链接（正文要开浏览器） ── */
function textOf(h, f) {
  const p = h.p, mime = f.mimeType;
  if (TEXTLIKE.test(mime)) return fs.readFileSync(p, 'utf8').slice(0, 60000);
  if (mime === 'application/pdf') {
    const r = spawnSync('python3', ['-c', 'import sys,fitz\nd=fitz.open(sys.argv[1])\nprint("\\n".join(pg.get_text() for pg in d)[:60000])', p], { encoding: 'utf8', maxBuffer: 8e6, timeout: 20000 });
    if (r.status === 0) return String(r.stdout || '');
    throw Object.assign(new Error('这台电脑读不了 PDF 正文'), { code: 'view' });
  }
  if (/wordprocessingml/.test(mime)) {
    const r = spawnSync('unzip', ['-p', p, 'word/document.xml'], { encoding: 'utf8', maxBuffer: 16e6, timeout: 20000 });
    if (r.status === 0) return String(r.stdout || '').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').slice(0, 60000);
  }
  return null;   /* Google 文档／表格本机只有一个指针文件，正文交给连接器去取 */
}
function fileOf(id) { const h = resolve(id); if (!h) return null; const parent = path.dirname(h.p); const items = listDir(parent, h.parentId || parentIdOf(parent), 60e3); return { h, f: items.find(x => x.id === id) || null }; }
function parentIdOf(dir) { for (const [id, v] of byId) if (v.p === dir) return id; return xattrOne(dir) || localId(dir); }
function readContent(input) {
  const r = fileOf(String(input.fileId || '')); if (!r || !r.f) throw Object.assign(new Error('没有这个文件'), { code: 'not_found' });
  const t = textOf(r.h, r.f); if (t == null) return null;
  return J({ fileContent: t });
}
function download(input) {
  const r = fileOf(String(input.fileId || '')); if (!r || !r.f) throw Object.assign(new Error('没有这个文件'), { code: 'not_found' });
  if (r.f.mimeType === FOLDER) throw Object.assign(new Error('这是文件夹'), { code: 'tool_error' });
  if (/vnd\.google-apps\./.test(r.f.mimeType)) return null;
  const st = fs.statSync(r.h.p); if (st.size > 4e6) throw Object.assign(new Error('文件太大，到 Drive 里看'), { code: 'view' });
  return J({ content: fs.readFileSync(r.h.p).toString('base64'), mimeType: r.f.mimeType, title: r.f.title });
}
function metadata(input) { const r = fileOf(String(input.fileId || '')); if (!r || !r.f) throw Object.assign(new Error('没有这个文件'), { code: 'not_found' }); return J(r.f); }

/* ── 写：建文件、改名、移动、复制、放进回收站（删掉本机文件＝Drive 里进回收站） ── */
const cleanName = s => String(s || '').replace(/[\/\\:\x00-\x1f]/g, '-').replace(/^\.+/, '').trim().slice(0, 200) || '未命名';
function depthOf(p) { for (const d of DRIVES) if (p === d.dir || p.startsWith(d.dir + path.sep)) return p === d.dir ? 0 : path.relative(d.dir, p).split(path.sep).length; return -1; }
function inDrives(p) { return depthOf(p) >= 0; }
function uniquePath(dir, name) { let p = path.join(dir, name), k = 2; const ext = path.extname(name), base = name.slice(0, name.length - ext.length); while (fs.existsSync(p)) { p = path.join(dir, `${base}（${k++}）${ext}`); } return p; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
/* 新建的文件要等 Drive 传上去才有编号，最多等 5 秒；没等到先按路径给一个本机编号，下一轮列出来时就换成真编号了 */
const REAL = () => /CloudStorage\/GoogleDrive-/.test(MOUNT);   /* 不是真的 Drive 挂载（测试用的临时文件夹）就不用等编号 */
async function idAfter(p, tries = REAL() ? 16 : 1) { for (let i = 0; i < tries; i++) { const v = xattrOne(p); if (v) return v; await sleep(300); } return localId(p); }
function forget(dir) { dirCache.delete(dir); }
async function createFile(input) {
  const parent = resolve(String(input.parentId || '')); if (!parent) throw Object.assign(new Error('没有这个文件夹'), { code: 'not_found' });
  if (!isDir(parent.p)) throw Object.assign(new Error('目标不是文件夹'), { code: 'tool_error' });
  const name = cleanName(input.title), p = uniquePath(parent.p, name);
  if (input.base64Content) fs.writeFileSync(p, Buffer.from(String(input.base64Content), 'base64'));
  else fs.writeFileSync(p, String(input.textContent || ''), 'utf8');
  forget(parent.p);
  const id = await idAfter(p); byId.set(id, { p, parentId: String(input.parentId) });
  const ext = path.extname(name).toLowerCase(), mimeType = MIME[ext] || String(input.contentMimeType || 'text/plain');
  return J({ id, title: path.basename(p), parentId: String(input.parentId), mimeType, modifiedTime: new Date().toISOString(), viewUrl: urlOf(id, mimeType) });
}
async function updateFile(input) {
  const id = String(input.fileId || ''), h = resolve(id); if (!h) throw Object.assign(new Error('没有这个文件'), { code: 'not_found' });
  let p = h.p;
  if (isDir(p) && depthOf(p) <= 2 && (input.title || input.parentId)) throw Object.assign(new Error('板块和状态文件夹不能改名或移动'), { code: 'tool_error' });   /* 和 trashFile 一样的保护 */
  if (input.title) {
    const ext = path.extname(p).toLowerCase(), pointer = POINTER[ext] ? ext : '';
    const np = path.join(path.dirname(p), cleanName(input.title) + pointer);
    if (np !== p) {
      if (fs.existsSync(np)) throw Object.assign(new Error('已有同名文件：' + path.basename(np)), { code: 'tool_error' });   /* 改名不覆盖别人 */
      fs.renameSync(p, np); forget(path.dirname(p)); byId.set(id, { p: np, parentId: h.parentId }); p = np;
    }
  }
  if (input.parentId) {
    const dest = resolve(String(input.parentId)); if (!dest || !isDir(dest.p)) throw Object.assign(new Error('没有这个目标文件夹'), { code: 'not_found' });
    const np = uniquePath(dest.p, path.basename(p));
    try { fs.renameSync(p, np); } catch (e) { throw Object.assign(new Error('移不过去：' + e.message), { code: 'tool_error' }); }
    forget(path.dirname(p)); forget(dest.p); byId.set(id, { p: np, parentId: String(input.parentId) }); p = np;
  }
  return J({ id, title: path.basename(p), parentId: input.parentId || h.parentId });
}
async function copyFile(input) {
  const h = resolve(String(input.fileId || '')); if (!h) throw Object.assign(new Error('没有这个文件'), { code: 'not_found' });
  if (POINTER[path.extname(h.p).toLowerCase()]) return null;   /* Google 文档／表格本机只是个指针，复制指针不会生成新文档：交给连接器做真正的副本 */
  const dest = resolve(String(input.parentId || '')); if (!dest || !isDir(dest.p)) throw Object.assign(new Error('没有这个目标文件夹'), { code: 'not_found' });
  const np = uniquePath(dest.p, input.title ? cleanName(input.title) + (POINTER[path.extname(h.p).toLowerCase()] ? path.extname(h.p) : '') : path.basename(h.p));
  fs.cpSync(h.p, np, { recursive: true }); forget(dest.p);
  const id = await idAfter(np); byId.set(id, { p: np, parentId: String(input.parentId) });
  return J({ id, title: path.basename(np), parentId: String(input.parentId) });
}
async function trashFile(input) {
  const h = resolve(String(input.fileId || '')); if (!h) throw Object.assign(new Error('没有这个文件'), { code: 'not_found' });
  if (!inDrives(h.p)) throw Object.assign(new Error('不在共享硬盘里'), { code: 'tool_error' });
  if (isDir(h.p) && depthOf(h.p) <= 2) throw Object.assign(new Error('板块和状态文件夹不能删'), { code: 'tool_error' });
  fs.rmSync(h.p, { recursive: true, force: true }); forget(path.dirname(h.p)); byId.delete(String(input.fileId));
  return J({ ok: true, trashed: String(input.fileId) });
}

const TOOLS = { search_files: searchFiles, read_file_content: readContent, download_file_content: download, get_file_metadata: metadata, create_file: createFile, update_file: updateFile, copy_file: copyFile, trash_file: trashFile };
export const driveCan = tool => !!TOOLS[tool];
/* 一项调用：{ok,text}／{ok:false,code,error}；返回 null＝这项交给连接器 */
export async function driveDirect(tool, input) {
  if (!onFlag || !TOOLS[tool]) return null;
  try { const t = await TOOLS[tool](input || {}); return t == null ? null : { ok: true, text: t }; }
  catch (e) { return { ok: false, code: e.code || 'tool_error', error: String(e.message || e) }; }
}
export const _test = { parseQuery, listDir, resolve, byId, dirCache };
