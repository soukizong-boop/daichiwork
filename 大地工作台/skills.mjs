// 指令 skill 的两样底层：①「今日」提醒引擎（提醒型模版的规则 → 每天早上按后台数据和日历算出要处理的事）②任务型模版的结果卡（Claude Code 做完交回来的一屏成品）。
// 规则正文由人在工作台里改（管理员）；这里只负责把规则算成提醒，以及存取结果。
import fs from 'node:fs';
import path from 'node:path';
import { adminCall, adminUser, DATA, readJson, writeJson } from './adminlib.mjs';

const str = (v, n = 4000) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);
const unwrap = r => (r && r.data && r.data.data !== undefined ? r.data.data : r && r.data);
export const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysBetween = (a, b) => Math.round((b - a) / 86400e3);

/* ───── 结果卡：任务型模版做完的成品 ───── */
const RESULTS = path.join(DATA, 'results.json');
export function resultsLoad() { const v = readJson(RESULTS); return v && Array.isArray(v.items) ? v : { items: [] }; }
export function resultPut({ tplId, no, name, module, title, body, data, by, slug }) {
  const d = resultsLoad(); const now = new Date().toISOString();
  const item = { id: 'r-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), tplId: str(tplId, 40), no: Number(no) || 0, name: str(name, 60), module: str(module, 10), title: str(title, 120), body: String(body == null ? '' : body).slice(0, 60000), data: data && typeof data === 'object' ? data : null, by: str(by, 40) || 'Claude Code', slug: str(slug, 40), at: now, status: '待看' };
  d.items.unshift(item); if (d.items.length > 100) d.items.length = 100; writeJson(RESULTS, d); return item;
}
export function resultMark(id, status, extra = {}) { const d = resultsLoad(); const it = d.items.find(x => x.id === id); if (it) { Object.assign(it, { status, ...extra }); writeJson(RESULTS, d); } return it; }
export function resultDelete(id) { const d = resultsLoad(); const i = d.items.findIndex(x => x.id === id); if (i < 0) return false; d.items.splice(i, 1); writeJson(RESULTS, d); return true; }

/* ───── 提醒规则：提醒型模版的 checks 里写的是这里的名字 ───── */
/* 日历规则：从模版规则正文里读「MM-DD｜事项｜提前N天」或「每月DD｜事项｜提前N天」的行；别的行是说明，不算 */
export function parseCalendar(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/^\s*(?:[-*・]|\d+[.、)])\s*/, '').trim(); if (!line.includes('｜') && !line.includes('|')) continue;   /* 只去掉列表符号，别把日期里的数字也吃掉 */
    const [when, what, lead] = line.split(/[｜|]/).map(s => s.trim());
    if (!when || !what) continue;
    const n = Number((lead || '').replace(/[^\d]/g, '')) || 7;
    let m;
    if ((m = /^(\d{1,2})[-\/月](\d{1,2})日?$/.exec(when))) out.push({ month: +m[1], day: +m[2], what, lead: n });
    else if ((m = /^每月\s*(\d{1,2})\s*日?$/.exec(when))) out.push({ month: 0, day: +m[1], what, lead: n });
    else if ((m = /^月末$/.exec(when))) out.push({ month: 0, day: 99, what, lead: n });
  }
  return out;
}
function calendarItems(rules, today = new Date()) {
  const items = []; const y = today.getFullYear();
  for (const r of parseCalendar(rules)) {
    const cands = [];
    if (r.month === 0) { for (const mo of [today.getMonth() - 1, today.getMonth(), today.getMonth() + 1]) { const d = new Date(y, mo + 1, 0).getDate(); cands.push(new Date(y, mo, r.day === 99 ? d : Math.min(r.day, d))); } }
    else { for (const yy of [y - 1, y, y + 1]) cands.push(new Date(yy, r.month - 1, r.day)); }
    for (const due of cands) {
      const left = daysBetween(new Date(y, today.getMonth(), today.getDate()), due);
      if (left < 0 || left > r.lead) continue;
      items.push({ id: `cal:${r.what}:${ymd(due)}`, level: left === 0 ? '今天' : left <= 2 ? '急' : '提前', text: `${r.what}：${left === 0 ? '就是今天' : `还有 ${left} 天（${due.getMonth() + 1}/${due.getDate()}）`}`, due: ymd(due) });
      break;
    }
  }
  return items;
}
async function get(p) { try { const r = await adminCall('GET', p); return r && r.status >= 200 && r.status < 300 ? unwrap(r) : null; } catch { return null; } }
const CHECKS = {
  /* 服务：待发货超时、咨询未回、退货、退款（数据来自后台 dashboard.todo，口径由后台定） */
  async service() {
    const d = await get('/admin/dashboard'); if (!d) return [{ id: 'svc:nodata', level: '提前', text: '后台 dashboard 读不到（没登录？）' }];
    const t = d.todo || {}, out = [];
    if (t.toShipOverdue > 0) out.push({ id: 'svc:ship', level: '急', text: `待发货超时 ${t.toShipOverdue} 单（待发货共 ${t.toShip || 0}）`, open: 'https://alaco.ai/admin/orders?flt=pending' });
    else if (t.toShip > 0) out.push({ id: 'svc:ship0', level: '今天', text: `待发货 ${t.toShip} 单`, open: 'https://alaco.ai/admin/orders?flt=pending' });
    if (t.inquiryOverdue > 0) out.push({ id: 'svc:inq', level: '急', text: `咨询超时未回 ${t.inquiryOverdue} 条（未回共 ${t.inquiryOpen || 0}）`, open: 'https://alaco.ai/admin/inquiries' });
    else if (t.inquiryOpen > 0) out.push({ id: 'svc:inq0', level: '今天', text: `咨询未回 ${t.inquiryOpen} 条`, open: 'https://alaco.ai/admin/inquiries' });
    if (t.returnsOverdue > 0) out.push({ id: 'svc:ret', level: '急', text: `退货处理超时 ${t.returnsOverdue} 件（处理中 ${t.returnsPending || 0}）`, open: 'https://alaco.ai/admin/returns' });
    else if (t.returnsPending > 0) out.push({ id: 'svc:ret0', level: '今天', text: `退货处理中 ${t.returnsPending} 件`, open: 'https://alaco.ai/admin/returns' });
    if (t.refundsPending > 0) out.push({ id: 'svc:ref', level: '今天', text: `退款待办 ${t.refundsPending} 件`, open: 'https://alaco.ai/admin/refunds' });
    const b = await get('/admin/purchase/nav-badges'); if (!b) out.push({ id: 'svc:sref:nodata', level: '提前', text: '后台 nav-badges 读不到：店铺退款这一项这次没查' }); if (b && b.storeRefunds > 0) out.push({ id: 'svc:sref', level: '今天', text: `店铺退款待审批 ${b.storeRefunds} 件`, open: 'https://alaco.ai/admin/store' });
    const low = (d.alerts && d.alerts.lowStock) || []; if (low.length) out.push({ id: 'svc:low', level: '提前', text: `库存预警 ${low.length} 款：${low.slice(0, 30).map(x => `${x.name}${x.combo ? '（' + Object.values(x.combo).join('/') + '）' : ''} 剩 ${x.stock}`).join('；')}`, open: 'https://alaco.ai/admin/products' });
    return out;
  },
  /* 选品：有库存却还没商品页（无图／还是 draft）→ 跑模版 1 */
  async no_page(ctx) {
    const rows = await get('/admin/purchase/stock-overview'); if (!Array.isArray(rows)) return [{ id: 'page:nodata', level: '提前', text: '后台 stock-overview 读不到：商品页这一类这次没查' }];
    const out = [];
    for (const r of rows) {
      const stock = Number(r.site || 0) + Number(r.unallocated || 0) + Number(r.locked || 0);
      if (!(stock > 0)) continue;
      if (!r.image) out.push({ id: `page:${r.slug}`, level: '今天', text: `${r.slug} ${r.name}：有库存 ${stock} 件，商品页还没做（没有图）`, run: { tplId: ctx.productTplId, input: `款号 ${r.slug}（${r.name}）。照片在：` } });
      else if (r.productStatus === 'draft') out.push({ id: `draft:${r.slug}`, level: '提前', text: `${r.slug} ${r.name}：商品页是 draft，有库存 ${stock} 件还没公开`, open: 'https://alaco.ai/admin/products' });
    }
    return out;
  },
  /* 渠道：月末 mospace 月结＋役員借入 */
  async month_end(ctx, today = new Date()) {
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate(); const d = today.getDate();
    const out = [];
    if (d >= last - 1) out.push({ id: `me:${ymd(today).slice(0, 7)}`, level: d === last ? '今天' : '急', text: `月末：mospace 寄售按本月实售出结算单；木子付款当天在采购区「财务→新增借入」记役員借入（金额・付款日・李江木子・发票号）` });
    if (d <= 2) out.push({ id: `ms:${ymd(today).slice(0, 7)}`, level: '今天', text: `月初：核对上月 mospace 结算是否已付款、役員借入是否已记` });
    return out;
  },
  /* 运营：税务・行政日历，规则正文里的日期行 */
  async calendar(ctx, today = new Date()) { return calendarItems(ctx.rules || '', today); },
};
/* 把所有启用的提醒型模版算一遍。tpls：模版清单；返回 [{id, tplNo, tplId, module, name, level, text, run?, open?}] */
export async function computeToday(tpls, opts = {}) {
  const today = opts.today || new Date();
  const productTpl = tpls.find(t => t.program === 'product');
  const out = [];
  if (!adminUser()) out.push({ id: 'login', tplNo: 0, module: '系统', name: '工作台', level: '急', text: '后台没有登录：提醒里和后台有关的都算不出来。菜单 → 后台 → 登录。' });
  for (const t of tpls) {
    if (t.kind !== 'remind' || t.status === '停用') continue;
    for (const c of (Array.isArray(t.checks) ? t.checks : [])) {
      const fn = CHECKS[c]; if (!fn) continue;
      let items = [];
      try { items = await fn({ rules: t.rules || t.body || '', productTplId: productTpl && productTpl.id }, today); } catch (e) { items = [{ id: `${c}:err`, level: '提前', text: `规则「${c}」算失败：${(e && e.message) || e}` }]; }
      for (const it of items) out.push({ ...it, tplNo: t.no, tplId: t.id, module: t.module, name: t.name });
    }
  }
  const rank = { '急': 0, '今天': 1, '提前': 2 };
  return out.sort((a, b) => (rank[a.level] ?? 3) - (rank[b.level] ?? 3));
}
/* 给 Slack／ask ala 的一段话 */
export function todayText(items, date) {
  if (!items.length) return `今日提醒 ${date}：没有要处理的。`;
  const g = {}; for (const it of items) (g[it.module] ||= []).push(it);
  return [`今日提醒 ${date}`, ...Object.entries(g).map(([m, l]) => `【${m}】\n` + l.map(it => `・${it.level === '急' ? '⚠ ' : ''}${it.text}`).join('\n'))].join('\n');
}
