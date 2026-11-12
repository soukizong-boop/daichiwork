// 大地工作台 · 报告生成：Markdown → A4 样式的 HTML → PDF（用本机 Google Chrome 无头打印）
// 零依赖，只用 Node 自带模块；server.mjs 调用 markdownToPdf()。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CHROME = process.env.DADI_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ───────── 一、很小的 Markdown 渲染：和页面里的 md() 同一套规则。先转义，再加标签，原文一律不直接注入 ─────────
   代码块→<pre>，表格→<table>（跳过 |---| 分隔行），#／## →<h2>，###以下→<h3>，---→<hr>，> →<blockquote>，
   -／*／1. →<ul><li>，连续的普通行合成一个 <p>（空行分段），**粗体**→<b>，`代码`→<code> */
export function mdToHtml(src) {
  const inl = s => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const LI = /^\s*([-*•]|\d+[.、])\s+/, BLOCK = /^\s*(```|\||#{1,6}\s|-{3,}\s*$|\*{3,}\s*$|>|([-*•]|\d+[.、])\s)/;
  const lines = String(src == null ? '' : src).replace(/\r/g, '').split('\n'), out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]); i++; out.push('<pre>' + esc(buf.join('\n')) + '</pre>'); continue; }
    if (/^\s*\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { const c = lines[i].trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(x => x.trim()); if (!c.every(x => /^:?-*:?$/.test(x))) rows.push(c); i++; }
      if (rows.length) out.push('<table>' + rows.map((r, k) => '<tr>' + r.map(x => (k ? `<td>${inl(x)}</td>` : `<th>${inl(x)}</th>`)).join('') + '</tr>').join('') + '</table>');
      continue;
    }
    const h = /^\s*(#{1,6})\s+(.*)$/.exec(l);   // 允许缩进，和下面 BLOCK 的判定一致，否则段落分支吃不到这行会死循环
    if (h) out.push(h[1].length <= 2 ? '<h2>' + inl(h[2]) + '</h2>' : '<h3>' + inl(h[2]) + '</h3>');
    else if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) out.push('<hr>');
    else if (/^\s*>\s?/.test(l)) out.push('<blockquote>' + inl(l.replace(/^\s*>\s?/, '')) + '</blockquote>');
    else if (LI.test(l)) { const it = []; while (i < lines.length && LI.test(lines[i])) { it.push('<li>' + inl(lines[i].replace(LI, '')) + '</li>'); i++; } out.push('<ul>' + it.join('') + '</ul>'); continue; }
    else if (l.trim()) { const p = []; do p.push(inl(lines[i++].trim())); while (i < lines.length && lines[i].trim() && !BLOCK.test(lines[i])); out.push('<p>' + p.join('\n') + '</p>'); continue; }   // 至少吃一行，保证一定前进
    i++;
  }
  return out.join('\n');
}

/* ───────── 二、拼成整份 A4 文档：浅色、系统字体，和工作台页面同一套颜色 ─────────
   body 已经是 HTML（调用方传 mdToHtml 的结果）；title／meta／footer 是纯文字，这里转义 */
const CSS = ':root{--ink:#0f1728;--ink-2:#4a5568;--ink-3:#8a94a6;--line:rgba(15,23,40,.10);--accent:#0866ff;--soft:#f2f5fa;--bad:#c2372c;--ok:#1f9d55;--warn:#d98a00} @page{size:A4;margin:18mm 16mm} body{font-family:-apple-system,"PingFang SC","Hiragino Sans","Noto Sans SC",sans-serif;color:var(--ink);font-size:11pt;line-height:1.6;font-variant-numeric:tabular-nums;margin:0} h1{font-size:20pt;font-weight:700;margin:0 0 2pt} .meta{color:var(--ink-3);font-size:9.5pt;margin-bottom:14pt} h2{font-size:13pt;font-weight:700;margin:16pt 0 6pt;padding-bottom:4pt;border-bottom:1px solid var(--line)} h3{font-size:11.5pt;font-weight:700;margin:10pt 0 4pt} .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:8pt;margin:8pt 0} .card{border:1px solid var(--line);border-radius:8pt;padding:8pt 10pt} .card b{display:block;font-size:18pt;font-weight:700;line-height:1.2} .card small{color:var(--ink-3);font-size:9pt} .card em{font-style:normal;color:var(--bad);font-size:9pt;margin-left:4pt} ul{margin:4pt 0 4pt 16pt;padding:0} li{margin:2pt 0} table{border-collapse:collapse;width:100%;font-size:10pt;margin:6pt 0} th,td{border:1px solid var(--line);padding:4pt 6pt;text-align:left;vertical-align:top} th{background:var(--soft);font-weight:600} pre,code{font-family:ui-monospace,Menlo,monospace;font-size:9.5pt} pre{background:var(--soft);border-radius:6pt;padding:6pt 8pt;white-space:pre-wrap} blockquote{border-left:2px solid var(--line);margin:4pt 0;padding-left:8pt;color:var(--ink-2)} .tag{display:inline-block;padding:0 6pt;border-radius:99pt;font-size:8.5pt;font-weight:600;line-height:14pt;vertical-align:1pt} .tag.ok{background:rgba(31,157,85,.12);color:var(--ok)} .tag.bad{background:rgba(194,55,44,.12);color:var(--bad)} .tag.warn{background:rgba(217,138,0,.14);color:var(--warn)} .note{color:var(--ink-2);font-size:10pt} .footer{color:var(--ink-3);font-size:9pt;margin-top:16pt}';
export function reportHtml({ title = '', meta = '', body = '', footer = '' } = {}) {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>` +
    `<h1>${esc(title)}</h1>${meta ? `<div class="meta">${esc(meta)}</div>` : ''}${body || ''}${footer ? `<div class="footer">${esc(footer)}</div>` : ''}</body></html>`;
}
/* 数字卡片块：items = [{ label, value, warn }]，warn 是字符串就红字跟在数字后面，是 true 就标「需处理」 */
export function cardsHtml(items) {
  return '<div class="cards">' + (Array.isArray(items) ? items : []).map(c => `<div class="card"><small>${esc(c.label)}</small><b>${esc(c.value)}${c.warn ? `<em>${esc(c.warn === true ? '需处理' : c.warn)}</em>` : ''}</b></div>`).join('') + '</div>';
}

/* ───────── 三、HTML → PDF：写到临时文件，叫 Google Chrome 无头打印 ─────────
   Chrome 位置可用环境变量 DADI_CHROME_PATH 改。不另开配置文件夹：实测另开会让 Chrome 打印完后挂着不退出，
   用默认配置即使你正开着 Chrome 也能在一秒内打完。保险起见，看到它报「bytes written」就等一下主动收工 */
export function htmlToPdf(html, outPath) {
  return new Promise((resolve, reject) => {
    const out = path.resolve(outPath), tmp = path.join(os.tmpdir(), `dadi-report-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`);
    const clean = () => { try { fs.unlinkSync(tmp); } catch {} };
    try { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.rmSync(out, { force: true }); fs.writeFileSync(tmp, String(html), { mode: 0o600 }); }   // 先删旧 PDF，免得 Chrome 没写出来却拿旧文件当成功
    catch (e) { clean(); return reject(new Error('生成 PDF 失败：写不了临时文件：' + e.message)); }
    /* 临时文件路径走 pathToFileURL：目录里有空格、#、%、中文时直接拼 file:// 会让 Chrome 打不开 */
    const args = ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--print-to-pdf=' + out, pathToFileURL(tmp).href];
    const t0 = Date.now();
    let written = false, nudge = null;
    const child = execFile(CHROME, args, { timeout: 90000, maxBuffer: 4e6 }, (e, so, se) => {
      clearTimeout(nudge); clean();
      let size = 0; try { size = fs.statSync(out).size; } catch {}
      if (size > 1000 && (!e || e.killed || written)) return resolve(out);
      const why = e && e.code === 'ENOENT' ? '找不到 Google Chrome：' + CHROME
        : Date.now() - t0 >= 89000 ? '等了 90 秒 Chrome 还没打印完'
        : e && !e.killed ? (String(se || '').trim().split('\n').pop() || e.message)
        : 'Chrome 没有写出有效的 PDF（' + size + ' 字节）';
      reject(new Error('生成 PDF 失败：' + why));
    });
    /* Chrome 写完会在 stderr 报一句「N bytes written to file …」；之后若它赖着不走，1.5 秒后请它退出 */
    if (child.stderr) child.stderr.on('data', d => { if (!written && /bytes written to file/.test(String(d))) { written = true; nudge = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, 1500); } });
  });
}

/* ───────── 四、一步到位：Markdown → PDF ─────────
   opts = { title, meta, footer, cards }；cards（可选）= 数字卡片的 items，放在正文最前面 */
export async function markdownToPdf(md, outPath, opts = {}) {
  const body = (opts.cards ? cardsHtml(opts.cards) : '') + mdToHtml(md);
  return htmlToPdf(reportHtml({ title: opts.title, meta: opts.meta, footer: opts.footer, body }), outPath);
}
