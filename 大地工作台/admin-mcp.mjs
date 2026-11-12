// 给 Claude Code 用的「网站后台」工具（走标准输入输出的 MCP 服务，由桥接程序挂给 Claude Code）。
// admin_get 只读；admin_write 会真的改数据——大地工作台页面会先弹确认，代表点了才执行。
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { adminCall, adminUpload, closedPath, DATA, readJson } from './adminlib.mjs';
import { SECTIONS, ENUMS, DEFAULT_FORM, DRAFT_RULES, loadForm, findProduct, fetchCategories, validate, draftPut, draftsLoad, listPhotos, renderCards } from './product.mjs';

/* 商品模版（工作台 templates.json 里 kind=product 的那条）：默认值表单和起草规则 */
const productTpl = () => { const d = readJson(path.join(DATA, 'templates.json')); const items = d && Array.isArray(d.items) ? d.items : []; return items.find(x => x.kind === 'product') || null; };
/* 回头调工作台自己的接口（服务在本机 127.0.0.1:端口；口令在数据目录 secret） */
async function wb(p, body) {
  const tok = fs.readFileSync(path.join(DATA, 'secret'), 'utf8').trim(); const port = Number(process.env.DADI_PORT || 8850);
  const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dadi': '1', 'x-dadi-token': tok }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(8000) });
  let data = {}; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
async function notifyDraft(slug, warnings) { try { await wb('/api/drafts/notify', { slug, warnings }); } catch {} }

const PATHS = `常用路径（线上版本可能和这份清单略有出入，以实际返回为准）：
订单 /admin/orders?page=1&per=20&flt=pending（flt：pending 待发货／moving 运送中／done 已送达／cancelled 已取消；q= 搜订单号、姓名、运单号、商品名）；/admin/orders/<id>；/admin/orders/<id>/events
咨询 /admin/inquiries?page=1&per=50　退货 /admin/returns　退款待办 /admin/refund-tasks
商品 /admin/products；/admin/products/<id>；/admin/categories　顾客 /admin/users
仪表盘 /admin/dashboard　顶栏数字 /admin/purchase/nav-badges　分析 /admin/analytics
采购 /admin/purchase/overview；/admin/purchase/pos；/admin/purchase/inventory；/admin/purchase/new-arrivals；/admin/purchase/stock-overview；/admin/purchase/transfer-requests；/admin/purchase/internal-cases
店铺 /admin/store/receipts；/admin/store/refund-pending
审计 /admin/audit；/admin/audit/sensitive-pending　内容 /admin/content　规则 /admin/config`;

const TOOLS = [
  {
    name: 'admin_get',
    description: `读 alaco.ai 网站后台的数据（只读，不改任何东西）。path 以 /admin/ 开头，可以带查询参数。返回 HTTP 状态和 JSON。403＝当前登录的后台账号没有这个权限；401＝代表还没有在大地工作台里登录后台。\n${PATHS}`,
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: '例如 /admin/orders?page=1&per=20&flt=pending' } }, required: ['path'] },
  },
  {
    name: 'admin_write',
    description: `改 alaco.ai 网站后台的数据，会在线上真的生效。只在代表明确要改的时候用；页面会先让代表确认，他不同意就不执行。先用 admin_get 看清现状再改。常用：POST /admin/orders/<id>/tracking {carrier,trackingNo}；POST /admin/orders/<id>/advance {note}；POST /admin/inquiries/<id>/thread {dir:"out",text}（只留档，不会发邮件给顾客）；POST /admin/inquiries/<id>/status {status:"open"|"in_progress"|"done"}；PUT /admin/products/<id> {...}。`,
    inputSchema: {
      type: 'object',
      properties: { method: { type: 'string', enum: ['POST', 'PUT', 'DELETE'] }, path: { type: 'string' }, body: { type: 'object', description: '请求内容；DELETE 不需要' } },
      required: ['method', 'path'],
    },
  },
  {
    name: 'product_schema',
    description: '商品模版「ALA 商品页」的字段说明：后台「编辑商品」整页的分区与字段（sections）、枚举（enums：徽章・图标・颜色・退货／配送类型・卡片类型等）、模版默认值（defaults）、起草规则（rules）、分类清单（categories，只能选 parent_id 非空的小类）。填表单前先看一遍。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'product_load',
    description: '按款号读后台现状，并成商品模版的表单（camelCase；空位已用模版默认值补上）。返回 form（要填的表单）、meta（商品 id、库存来源、是否检证用）、draft（已有的商品稿）。slug、stock、价格、options 的 group／label、variants 来自采购区，不要改。',
    inputSchema: { type: 'object', properties: { slug: { type: 'string', description: '采购款号，如 g-2026017' } }, required: ['slug'] },
  },
  {
    name: 'draft_put',
    description: '把填好的表单存成商品稿（只存在工作台本机，不碰后台；人审核后在工作台点「上传到后台」）。会按后台规则校验：返回 errors 就按提示改了再存；warnings 只是提醒。images 每张写 {card:{type:"main|point|triple|grid|spec|setcard", img:"本机绝对路径", title, sub, n, tiles, lines, mode}} 让工作台按金样版式生成，或 {file:"本机绝对路径"} 用原图；已在后台的图写 {url:"/files/…"}。',
    inputSchema: { type: 'object', properties: { slug: { type: 'string' }, form: { type: 'object', description: 'product_load 给的 form 改好后整个传回来' }, note: { type: 'string', description: '给审核人的话：哪些数据素材里没有、选图理由、要人确认的点' } }, required: ['slug', 'form'] },
  },
  {
    name: 'tpl_result',
    description: '任务型模版做完后，把成品交回工作台（一屏结果卡，人在「模版」窗口里看）。no＝模版编号；title＝一句标题；body＝给人看的成品（Markdown：邮件草稿就写 宛先／件名／本文／添付；分析就写结论和依据）；slug 可选（商品款号等）。交回后再用一两句话说明留空项即可。',
    inputSchema: { type: 'object', properties: { no: { type: 'number' }, title: { type: 'string' }, body: { type: 'string' }, slug: { type: 'string' }, data: { type: 'object' } }, required: ['no', 'title', 'body'] },
  },
  {
    name: 'tpl_rule_add',
    description: '把已经确认的口径（例如税理士的回信结论）加进某条模版的「已确认口径」。每条一句中文、带日期和来源；只收事实与结论。会弹确认卡，管理员点了才写入；写入后模版版本号加一。',
    inputSchema: { type: 'object', properties: { no: { type: 'number', description: '模版编号' }, rules: { type: 'array', items: { type: 'string' }, description: '每条一句，例：「2026-11-09 税理士回信：直送交易 NA 票不含 10% 消费税」' } }, required: ['no', 'rules'] },
  },
  {
    name: 'list_photos',
    description: '列出本机一个文件夹里的照片／文件（名字、路径、大小），省得跑 Bash。只能看本人用户目录下、非隐藏的文件夹。看图内容用 Read 读 path。',
    inputSchema: { type: 'object', properties: { dir: { type: 'string', description: '文件夹绝对路径' } }, required: ['dir'] },
  },
  {
    name: 'admin_upload',
    description: '把本机的一张图片传到 alaco.ai 后台的图片库（商品相册、同梱物、内容区块用），返回后台给的地址 url（形如 /files/xxxx.jpg）。只收 png／jpg／gif／webp、12MB 以内、本人用户目录下的文件。传完要把 url 写进商品（admin_write PUT /admin/products/<id>，images 数组里）才会显示。页面会先让代表确认。',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: '本机图片的绝对路径' } }, required: ['path'] },
  },
];

const out = m => process.stdout.write(JSON.stringify(m) + '\n');
const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n…（共 ${s.length} 字，已截断。用 page/per 或更具体的路径缩小范围）` : s);

async function callTool(name, a) {
  if (name === 'product_schema') { const t = productTpl(); let categories = []; try { categories = await fetchCategories(); } catch (e) { return { status: 401, data: { message: '读分类失败（后台没登录？）：' + ((e && e.message) || e) } }; } return { status: 200, data: { template: t ? { no: t.no, name: t.name, version: t.version } : null, sections: SECTIONS, enums: ENUMS, defaults: (t && t.form) || DEFAULT_FORM, rules: (t && t.rules) || DRAFT_RULES, categories: categories.map(c => ({ id: c.id, slug: c.slug, name: c.name, parent_id: c.parent_id })) } }; }
  if (name === 'product_load') { const slug = String(a.slug || '').trim(); if (!/^[a-z]-\d{7}$/.test(slug)) return { status: 400, data: { message: '款号格式不对（如 g-2026017）' } }; try { const t = productTpl(); const r = await loadForm(slug, t && t.form); const draft = draftsLoad().items.find(x => x.slug === slug) || null; return { status: 200, data: { form: r.form, meta: r.meta, draft: draft && { status: draft.status, at: draft.at, by: draft.by, note: draft.note, form: draft.form } } }; } catch (e) { return { status: 502, data: { message: String((e && e.message) || e) } }; } }
  if (name === 'draft_put') {
    const slug = String(a.slug || '').trim(); if (!/^[a-z]-\d{7}$/.test(slug)) return { status: 400, data: { message: '款号格式不对' } };
    if (!a.form || typeof a.form !== 'object') return { status: 400, data: { message: '要把整个 form 传回来' } };
    let product = null, categories = [];
    try { product = await findProduct(slug); categories = await fetchCategories(); } catch (e) { return { status: 502, data: { message: String((e && e.message) || e) } }; }
    if (!product) return { status: 404, data: { message: `后台没有款号 ${slug}` } };
    const form = { ...a.form, slug, status: 'draft' };
    const v = validate(form, { product, categories });
    if (!v.ok) return { status: 422, data: { message: '校验没过，按 errors 改了再存', errors: v.errors, warnings: v.warnings } };
    /* 顺手把卡片按金样版式先画出来，审核人打开商品稿就能看到缩略图（上传时按内容哈希复用，不会重画） */
    let previewNote = '';
    try { const idx = (form.images || []).map((im, i) => (im && im.card ? i : -1)).filter(i => i >= 0); if (idx.length) { const files = await renderCards(idx.map(i => form.images[i].card), slug); idx.forEach((i, j) => { form.images[i].card.preview = files[j]; }); previewNote = `，${idx.length} 张卡片已生成预览`; } }
    catch (e) { previewNote = '，卡片预览没生成：' + ((e && e.message) || e); }
    const t = productTpl(); const item = draftPut({ slug, form, note: a.note, by: 'Claude Code', source: 'ai', tplId: t && t.id });
    await notifyDraft(slug, v.warnings.length);
    return { status: 200, data: { ok: true, saved: { slug, rev: item.rev, at: item.at, status: item.status }, warnings: v.warnings, next: `商品稿已存${previewNote}。人会在工作台「模版 → ALA 商品页 → 商品稿」里审核并上传。你回复相册计划表和留空项即可。` } };
  }
  if (name === 'tpl_result') { try { const r = await wb('/api/results/notify', { no: Number(a.no) || 0, title: String(a.title || '').slice(0, 120), body: String(a.body || '').slice(0, 60000), slug: a.slug ? String(a.slug).slice(0, 40) : '', data: a.data && typeof a.data === 'object' ? a.data : null }); return { status: r.status, data: r.status === 200 ? { ok: true, id: r.data.id, next: '成品已交回工作台「模版」窗口。' } : r.data }; } catch (e) { return { status: 502, data: { message: '连不上工作台：' + ((e && e.message) || e) } }; } }
  if (name === 'tpl_rule_add') { try { const r = await wb('/api/templates/rule-add', { no: Number(a.no) || 0, rules: Array.isArray(a.rules) ? a.rules : [a.rules] }); return { status: r.status, data: r.data }; } catch (e) { return { status: 502, data: { message: '连不上工作台：' + ((e && e.message) || e) } }; } }
  if (name === 'list_photos') { const r = listPhotos(String(a.dir || '')); return { status: r.error ? 400 : 200, data: r.error ? { message: r.error } : r }; }
  const p = String(a.path || '');
  if (closedPath(p)) return { status: 403, data: { message: '账号和登录相关的接口不能从这里读写，请代表到后台页面里操作。' } };
  if (name === 'admin_upload') return adminUpload(p);
  if (name === 'admin_get') return adminCall('GET', p);
  const method = String(a.method || '').toUpperCase();
  if (!['POST', 'PUT', 'DELETE'].includes(method)) return { status: 400, data: { message: 'method 只能是 POST、PUT、DELETE' } };
  return adminCall(method, p, method === 'DELETE' ? undefined : (a.body || {}));
}

readline.createInterface({ input: process.stdin }).on('line', async line => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  const { id, method, params } = m;
  if (method === 'initialize') return out({ jsonrpc: '2.0', id, result: { protocolVersion: (params && params.protocolVersion) || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'alaco', version: '1.0.0' } } });
  if (method === 'tools/list') return out({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  if (method === 'ping') return out({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/call') {
    const name = params && params.name;
    if (!TOOLS.some(t => t.name === name)) return out({ jsonrpc: '2.0', id, error: { code: -32602, message: '没有这个工具' } });
    let r;
    try { r = await callTool(name, (params && params.arguments) || {}); }
    catch (e) { r = { status: 0, data: { message: '连不上后台：' + ((e && e.message) || e) } }; }
    const text = clip(typeof r.data === 'string' ? r.data : JSON.stringify(r.data), 60000);
    return out({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `HTTP ${r.status}\n${text}` }], isError: !(r.status >= 200 && r.status < 300) } });
  }
  if (id !== undefined) out({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
});
