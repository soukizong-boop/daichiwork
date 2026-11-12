// 商品模版：alaco.ai 后台「编辑商品」整页字段的表单、默认值、校验、卡片生成、上传与回读。
// 原则：机械活（字段对照、校验、生成卡片、上传、回读比对）由这里的程序做，一字不差地照后台 admin 页面的保存逻辑；
//       Claude Code 只负责「起草」——填表单里的文案字段，存成商品稿（draft_put），由人在工作台审核后一键上传。
// 字段、枚举、默认值来源：后台 admin 商品编辑页源码（20261106 抓取）＋金样 g-2026011（キーボード M1）／g-2026014（NeoSander）（20261109 读出）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { adminCall, adminUpload, DATA, ROOT, readJson, writeJson } from './adminlib.mjs';

const HOME = os.homedir();
const str = (v, n = 4000) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, n);
const num = v => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const JA = /[぀-ヿ一-鿿]/;

/* ───── 枚举（照后台页面，一字不差） ───── */
export const ENUMS = {
  badges: ['検品済み', 'プライバシー検証', '新着', '限定', 'ギフト対応'],
  icons: [['chat', '对话'], ['bolt', '闪电'], ['wifi', '无线'], ['battery', '电池'], ['gem', '宝石'], ['shield', '盾牌'], ['drop', '水滴'], ['sun', '太阳'], ['lock', '锁']],
  colors: [['c-blue', '蓝'], ['c-green', '绿'], ['c-purple', '紫'], ['c-wine', '酒红']],
  trustIcons: [['truck', '配送'], ['shield', '认证・合规'], ['lock', '隐私・安全'], ['gem', '礼品・特典'], ['drop', '其他']],
  optionGroups: [['色', '颜色'], ['デザイン', '款式'], ['サイズ', '尺寸'], ['構成', '套装构成'], ['長さ', '长度'], ['容量', '容量'], ['出力', '功率'], ['規格', '规格']],
  returnType: [['normal', '通常品'], ['made_to_order', '定制／受注生产'], ['electronics', '电器'], ['hygiene', '卫生用品']],
  shippingType: [['in_stock', '国内现货'], ['made_to_order', '受注生产'], ['battery', '含锂电池'], ['no_overseas', '不支持海外配送']],
  status: [['draft', '草稿（前台不可见）'], ['active', '公开中'], ['archived', '已下架']],
  taxRate: [[10, '10%（標準税率）'], [8, '8%（軽減税率：飲食料品等）']],
  certPresets: [['電気類', [['技適番号', 'R-2026-XXXXX'], ['PSE', '適合（菱形／丸形）'], ['PL 保険', '加入済み']]], ['ジュエリー', [['素材・品位', 'K18 ／ Pt950 など'], ['石・鑑別書', '鑑別書付き'], ['原産地', ''], ['サイズ', '']]], ['ギフト・雑貨', [['素材', ''], ['サイズ', ''], ['セット内容', '']]]],
  cardTypes: ['main', 'point', 'triple', 'grid', 'spec', 'setcard'],
};
/* 后台给 X 轨的默认（页面「↺ 用直营轨道默认」按钮给的那三条）——留着备用；模版默认值用金样 */
export const TRACK_X_DEFAULT = {
  serviceTrust: [{ icon: 'truck', title: 'ご注文確定後 {dispatchDays} 営業日以内に発送', note: '発送元：{shopAddress}。追跡番号付きでお届けします。' }, { icon: 'gem', title: '一点もの・ギフト対応', note: '専用ボックス入り。ギフト包装を無料で承ります。' }, { icon: 'shield', title: '素材証明つき', note: '素材証明カードを同梱。返品特約もご利用いただけます。' }],
  assurance: [{ en: 'Quality', title: '出荷前に一点ずつ品質確認', desc: '大阪の店舗で状態を確認してからお届けします。' }, { en: 'Returns', title: '返品特約', desc: '返品条件と受付期限は返品特約をご確認ください。返送先：{returnAddress}。' }],
  trustTags: ['ギフト包装可', '追跡番号あり', '返品特約あり'],
};

/* ───── 表单的分区与字段（页面照这个画；Claude Code 也照这个填） ───── */
export const SECTIONS = [
  { key: 'basic', title: '基本信息', fields: [
    { k: 'slug', label: 'slug（采购款号・不可更改）', type: 'ro' },
    { k: 'name', label: '商品名（日文）', type: 'text', req: true, ja: true, max: 60, hint: '（品牌）＋型号＋品类，全日文。例：マグネット式ミニキーボード M1' },
    { k: 'subtitle', label: '副标（一句话卖点）', type: 'text', ja: true, max: 60 },
    { k: 'track', label: '轨道', type: 'ro', show: 'X · 直营（大地为卖家）' },
    { k: 'categoryId', label: '分类（直接选小类，自动归到它的大类）', type: 'category', req: true },
    { k: 'basePriceJpy', label: '价格（税抜・日元）', type: 'int', hint: '税込由后台按税率切り捨て算出' },
    { k: 'taxRate', label: '消費税率', type: 'select', opts: ENUMS.taxRate },
    { k: 'stock', label: '库存（采购款・自动）', type: 'ro', hint: '采购款的库存＝采购可售件数，这里改不了' },
    { k: 'status', label: '状态', type: 'ro', show: '草稿（前台不可见）── 公开由人在后台点' },
    { k: 'weightG', label: '本体重量（g）', type: 'int' },
    { k: 'sizeCm', label: 'サイズ（cm，例 9.9×6.2×0.9）', type: 'text', max: 40 },
    { k: 'badges', label: '徽章（点选）', type: 'chips', opts: ENUMS.badges },
  ] },
  { key: 'images', title: '图库（第一张作主图；可放本机照片，或让工作台按金样版式生成卡片）', type: 'images' },
  { key: 'sku', title: 'SKU（规格选项与库存来自采购区，这里只填顾客看到的日文名和配图）', type: 'sku' },
  { key: 'trust', title: '配送 / 适配 / 隐私（商品页三点信任块）', fields: [
    { k: 'contentBlocks.serviceTrust', label: '信任块（图标 ＋ 标题 ＋ 说明）', type: 'rows', max: 3, cols: [{ k: 'icon', label: '图标', type: 'select', opts: ENUMS.trustIcons }, { k: 'title', label: '标题（可用 {dispatchDays} 等占位符）', ja: true }, { k: 'note', label: '说明', ja: true }] },
    { k: 'contentBlocks.trustTags', label: '信任标签（商品名下的打勾行，顿号分隔）', type: 'tags' },
  ] },
  { key: 'features', title: '卖点区块（详情页大标题 ＋ 特性卡）', fields: [
    { k: 'contentBlocks.featTitle', label: '卖点大标题（日文一句）', type: 'text', ja: true, max: 40 },
    { k: 'contentBlocks.features', label: '卖点（眉标 ＋ 一句日文 ＋ 图标 ＋ 颜色）', type: 'rows', max: 6, cols: [{ k: 'eyebrow', label: '眉标（英文／数字，如 65g）' }, { k: 't', label: '一句卖点（日文）', ja: true }, { k: 'icon', label: '图标', type: 'select', opts: ENUMS.icons }, { k: 'c', label: '颜色', type: 'select', opts: ENUMS.colors }] },
  ] },
  { key: 'bundle', title: '同梱物（箱子里有什么；带图）', fields: [
    { k: 'contentBlocks.bundle', label: '每套一条：「【ベーシックセット】本体／…／取扱説明書」，单套不加【】；说明书只写 取扱説明書', type: 'rows', max: 4, cols: [{ k: 'label', label: '物品清单（／分隔）', ja: true }, { k: 'img', label: '图片（后台地址 /files/… 或本机路径）', type: 'img' }] },
  ] },
  { key: 'specs', title: '规格参数（详情页规格表；数值带单位，只写素材里有的）', fields: [
    { k: 'specs', label: '项目 ＋ 内容', type: 'pairs', max: 24 },
  ] },
  { key: 'assurance', title: '安心へのこだわり（详情页「安心」卡片）', fields: [
    { k: 'contentBlocks.assurance', label: '小标签（英文）＋ 标题 ＋ 说明', type: 'rows', max: 4, cols: [{ k: 'en', label: '小标签（英文）' }, { k: 'title', label: '标题（日文）', ja: true }, { k: 'desc', label: '说明（日文）', ja: true }] },
  ] },
  { key: 'desc', title: '商品介绍与认证信息', fields: [
    { k: 'description', label: '介绍正文（日文丁寧語，三段：是什么→怎么用→注意）', type: 'textarea', ja: true, max: 4000 },
    { k: 'contentBlocks.importer', label: '进口商（輸入者）', type: 'text', max: 60 },
    { k: 'contentBlocks.returnType', label: '退货类型', type: 'select', opts: ENUMS.returnType },
    { k: 'contentBlocks.shippingType', label: '配送类型', type: 'select', opts: ENUMS.shippingType },
    { k: 'contentBlocks.leadTimeText', label: '纳期（受注生产才填）', type: 'text', max: 80 },
    { k: 'contentBlocks.warrantyText', label: '厂家保修期限／窗口（电器）', type: 'text', max: 200 },
    { k: 'contentBlocks.certItems', label: '认证・検品信息（详情页认证区；按品类预设或自由项目）', type: 'rows', max: 8, presets: ENUMS.certPresets, cols: [{ k: 'label', label: '项目（如 技適番号）' }, { k: 'value', label: '内容（如 R-2026-XXXXX）' }] },
  ] },
];

/* ───── 「ALA 商品页」默认值：取自金样（20261106 定稿） ───── */
export const DEFAULT_FORM = {
  track: 'X', taxRate: 10, status: 'draft', badges: ['検品済み', '新着'], weightG: null, sizeCm: '', specs: [], description: '', name: '', subtitle: '',
  contentBlocks: {
    featTitle: '',
    features: [{ eyebrow: '', t: '', icon: 'bolt', c: 'c-blue' }, { eyebrow: '', t: '', icon: 'wifi', c: 'c-green' }, { eyebrow: '', t: '', icon: 'chat', c: 'c-purple' }, { eyebrow: '', t: '', icon: 'battery', c: 'c-wine' }],
    bundle: [{ label: '', img: '' }],
    importer: '大地株式会社', returnType: 'electronics', shippingType: 'battery', leadTimeText: '',
    warrantyText: 'ご購入日から 12 か月。保証のお問い合わせは販売者（大地株式会社）が承ります。',
    trustTags: ['追跡番号あり', '初期不良対応', '12 か月保証'],
    serviceTrust: [{ icon: 'truck', title: 'ご注文確定後 {dispatchDays} 営業日以内に発送', note: '大阪の店舗より追跡番号付きでお届けします。' }, { icon: 'shield', title: '12 か月保証', note: 'ご購入日から 12 か月間、通常使用での故障に対応します（消耗品・お客様の過失による故障を除く）。' }],
    assurance: [{ en: 'Quality', title: '出荷前に動作を確認', desc: '大阪の店舗で外装と動作を確認してからお届けします。' }, { en: 'Returns', title: '返品特約', desc: '初期不良・破損・誤配送は到着後 {defectDays} 日以内にご連絡ください。送料当社負担で修補・交換または返金いたします。お客様都合の返品条件は返品ポリシーをご確認ください。' }],
    certItems: [], certInfo: '', compliance: {}, recommend: [],
  },
  images: [], options: [], variants: [],
};

/* 给 Claude Code 的起草规则（只管文案和选图；字段对照、校验、上传都不归它） */
export const DRAFT_RULES = `1. 后台正文一律日文（商品名・副标・说明・规格・选项显示名・同梱物・卖点）。商品名＝（品牌）＋型号＋品类；副标一句卖点。
2. 数字（重量・尺寸・电池・时间・规格）只从供应商资料、报价单、官方页面取，标明来自哪个文件；取不到的项不填、不编。没有数字就不做数字卡。
3. 分类只选一个小类（gifts：デジタルガジェット・PC周辺機器／フィットネス・トレーニンググッズ／カメラ・カメラグッズ／ゲーム・ゲームグッズ／DIY・ホビー工具／その他ギフト；designers：ネックレス／ピアス・イヤリング／リング／ブレスレット）。
4. 说明文日文丁寧語三段：是什么→怎么用→注意；不写夸大词、医疗或效果承诺；不写发行方・代理商名字；不写他社商标（Nintendo 等），游戏机类写「Switch 2 対応」这种対応表述。
5. 同梱物每套一条，格式「【ベーシックセット】本体／…／取扱説明書」，单套不加【】，说明书只写「取扱説明書」；配图用相册里的セット内容卡。
6. 相册约 8～12 张 1200×1200：① 主图整机无字 → ② 外观／手持 → ③ 数字卡（有数字才做）→ ④ 场景 → POINT 卡 3～6 张（每张一个卖点，标题 ≤14 字＋副标一句）→ 众筹实绩卡（输入里给了金额・人数才做）→ 仕様卡 → セット内容卡。卡片用 images[].card 规格（type main／point／triple／grid／spec／setcard，img 填本机照片绝对路径），工作台会按金样版式生成，不要自己画图。
7. 照片只用供应商素材包的实拍和官方渲染图；出现他社游戏画面、他社商标、看得清脸的人像、众筹页截图、徽章的一律不用；没有替代就少一张。同类款主图背景保持一致。
8. 卖点 4 条：眉标英文／数字（65g、3 DEVICES）＋一句日文；icon 从 bolt／wifi／chat／battery／gem／shield／drop／sun／lock 选；颜色按 c-blue→c-green→c-purple→c-wine 轮。
9. 展示品（输入说明是展示品时）：副标「クラウドファンディング段階の製品です（展示のみ・販売しておりません）。」，徽章只留 新着，不写同梱物。
10. 规格选项的 label、SKU、库存、价格、slug 来自采购区，一律不改；只填 options[].displayName（顾客看到的日文）和 imageIdx（哪张相册图）。`;

/* ───── GET 形状 → 表单（camelCase）；模版默认值补空位 ───── */
const unwrap = r => { const d = r && r.data ? r.data : r; return d && d.product ? d.product : d; };
export function fromProduct(p, tplForm) {
  const base = JSON.parse(JSON.stringify(tplForm || DEFAULT_FORM));
  const cb0 = p.content_blocks || {};
  const has = k => cb0[k] != null && (!Array.isArray(cb0[k]) || cb0[k].length) && !(typeof cb0[k] === 'string' && !cb0[k].trim());
  const cb = { ...base.contentBlocks };
  for (const k of Object.keys(cb0)) if (has(k)) cb[k] = cb0[k];
  if (Array.isArray(cb.bundle)) cb.bundle = cb.bundle.map(b => typeof b === 'string' ? { label: b, img: '' } : { label: b.label || '', img: b.img || '' });
  if (!Array.isArray(cb.certItems)) cb.certItems = [];
  if (!Array.isArray(cb.trustTags)) cb.trustTags = [];
  const form = {
    id: p.id, slug: p.slug || '', name: p.name || '', subtitle: p.subtitle || '', track: p.track || 'X', sellerId: p.sellerId || p.seller_id || '',
    categoryId: p.category_id || p.categoryId || '', basePriceJpy: p.base_price_jpy != null ? p.base_price_jpy : (p.price_jpy != null ? Math.round(p.price_jpy / 1.1) : null),
    priceJpy: p.price_jpy != null ? p.price_jpy : null, taxRate: p.tax_rate != null ? p.tax_rate : base.taxRate, stock: p.stock != null ? p.stock : 0,
    status: 'draft', isTest: !!p.is_test, weightG: p.weight_g != null ? p.weight_g : null, sizeCm: p.size_cm || '',
    badges: Array.isArray(p.badges) && p.badges.length ? p.badges : base.badges, specs: Array.isArray(p.specs) && p.specs.length ? p.specs.map(x => [String(x[0] || ''), String(x[1] || '')]) : (base.specs || []),
    description: p.description || '', contentBlocks: cb,
    images: (p.images || []).map(im => ({ kind: im.kind || 'gallery', url: im.url || '', label: im.label || '', optionLabel: im.option_label != null ? im.option_label : (im.optionLabel || null) })),
    options: (p.options || []).map(o => ({ group: o.group_name || o.group || '', label: o.label || '', displayName: o.display_name != null ? o.display_name : (o.displayName || ''), priceJpy: o.price_jpy != null ? o.price_jpy : (o.priceJpy != null ? o.priceJpy : null), imageIdx: o.image_idx != null ? o.image_idx : (o.imageIdx != null ? o.imageIdx : null), stock: o.stock != null ? o.stock : null, soldOut: !!o.sold_out, sort: o.sort || 0 })),
    variants: (p.variants || []).map(v => ({ combo: v.combo || {}, stock: v.stock != null ? v.stock : 0, basePriceJpy: v.base_price_jpy != null ? v.base_price_jpy : (v.price_jpy != null ? Math.round(v.price_jpy / (1 + ((p.tax_rate != null ? p.tax_rate : 10) / 100))) : null), lowStock: v.low_stock_threshold != null ? v.low_stock_threshold : null, soldOut: !!v.sold_out, sort: v.sort || 0 })),
  };
  return { form, meta: { id: p.id, slug: p.slug, status: p.status, isTest: !!p.is_test, stockSource: p.stockSource || '', purchaseAvailable: p.purchaseAvailable, sellerName: p.seller_name || '', updatedAt: p.updated_at || '' } };
}

/* ───── 表单 → PUT 的完整 DTO（照后台页面 eQ() 的算法） ───── */
const taxOf = f => (Number(f.taxRate) || 10);
const T = (f, v) => Math.floor((Number(v) || 0) * (1 + taxOf(f) / 100));
export function toDto(form, meta) {
  const f = form, cb = f.contentBlocks || {};
  const rows = a => (Array.isArray(a) ? a : []);
  const certItems = rows(cb.certItems).filter(e => str(e.label)).map(e => ({ label: str(e.label, 60), value: str(e.value, 200) }));
  const { featTitle, features, bundle, certInfo, compliance, recommend, serviceTrust, trustTags, assurance, importer, returnType, shippingType, leadTimeText, warrantyText, ...rest } = cb;
  const dto = {
    name: str(f.name, 120), subtitle: str(f.subtitle, 200), slug: str(f.slug, 60), track: f.track || 'X', sellerId: f.sellerId || '', categoryId: f.categoryId || null,
    basePriceJpy: Number(f.basePriceJpy || 0), priceJpy: T(f, f.basePriceJpy || 0), taxRate: taxOf(f),
    stock: meta && meta.stockSource === 'purchase' && meta.purchaseAvailable != null ? Number(meta.purchaseAvailable) : Number(f.stock || 0),
    status: 'draft', isTest: !!(meta ? meta.isTest : f.isTest), weightG: f.weightG === '' || f.weightG == null ? null : Number(f.weightG), sizeCm: str(f.sizeCm, 40),
    badges: rows(f.badges).map(x => str(x, 20)).filter(Boolean),
    specs: rows(f.specs).filter(x => Array.isArray(x) && str(x[0])).map(x => [str(x[0], 60), str(x[1], 300)]),
    description: str(f.description, 8000),
    contentBlocks: {
      ...rest,
      featTitle: str(featTitle, 80),
      features: rows(features).filter(e => str(e.t)).map(e => ({ eyebrow: str(e.eyebrow, 30), t: str(e.t, 120), icon: str(e.icon, 20) || 'bolt', c: str(e.c, 20) || 'c-blue' })),
      bundle: rows(bundle).filter(e => str(e.label)).map(e => ({ label: str(e.label, 300), img: str(e.img, 300) })),
      importer: str(importer, 60), returnType: str(returnType, 20) || 'normal', shippingType: str(shippingType, 20) || 'in_stock', leadTimeText: str(leadTimeText, 80), warrantyText: str(warrantyText, 200),
      certInfo: certItems.map(e => `${e.label}：<b>${e.value}</b>`).join('　／　'), certItems,
      compliance: compliance && typeof compliance === 'object' ? compliance : {}, recommend: rows(recommend).map(String),
      serviceTrust: rows(serviceTrust).filter(e => str(e.title)).map(e => ({ icon: str(e.icon, 20) || 'truck', title: str(e.title, 120), note: str(e.note, 300) })),
      trustTags: rows(trustTags).map(x => str(x, 30)).filter(Boolean),
      assurance: rows(assurance).filter(e => str(e.title)).map(e => ({ en: str(e.en, 30), title: str(e.title, 80), desc: str(e.desc, 400) })),
    },
    options: rows(f.options).map((o, i) => ({ group: str(o.group, 20), label: str(o.label, 60), displayName: str(o.displayName, 60), priceJpy: num(o.priceJpy), imageIdx: num(o.imageIdx), stock: o.stock == null ? null : Number(o.stock), soldOut: !!o.soldOut, sort: i })),
    images: rows(f.images).filter(e => str(e.url)).map((e, i) => ({ kind: /\.(mp4|webm|mov)(\?|$)/i.test(e.url) ? 'video' : (i === 0 ? 'main' : 'gallery'), url: str(e.url, 300), label: str(e.label, 80), optionLabel: str(e.optionLabel, 60) || null, sort: i })),
    variants: rows(f.variants).map((v, i) => ({ combo: v.combo && typeof v.combo === 'object' ? v.combo : {}, stock: v.stock == null || v.stock === '' ? 0 : Number(v.stock), basePriceJpy: num(v.basePriceJpy), priceJpy: num(v.basePriceJpy) == null ? null : T(f, v.basePriceJpy), lowStock: num(v.lowStock), soldOut: !!v.soldOut, sort: i })),
  };
  return dto;
}

/* ───── 校验：errors 挡住上传；warnings 只提醒 ───── */
const BRANDS = /Nintendo|任天堂|ニンテンドー|PlayStation|プレイステーション|Xbox|Sony|ソニー|Makuake|マクアケ|Kickstarter|Indiegogo|GREEN FUNDING|CAMPFIRE|mospace|モスペース|ＮＡ株式会社|NA株式会社/i;
const isLocal = p => typeof p === 'string' && path.isAbsolute(p);
const localOk = p => { try { const r = fs.realpathSync(p); return r.startsWith(HOME + path.sep) && !r.split(path.sep).some(s => s.startsWith('.')) && /\.(png|jpe?g|gif|webp)$/i.test(r) && fs.statSync(r).isFile(); } catch { return false; } };
export function validate(form, ctx = {}) {
  const E = [], W = [];
  const err = (p, m) => E.push({ path: p, msg: m }), warn = (p, m) => W.push({ path: p, msg: m });
  const f = form || {}, cb = f.contentBlocks || {}, p = ctx.product || null, cats = Array.isArray(ctx.categories) ? ctx.categories : null;
  const ja = (v, where) => { if (str(v) && !JA.test(String(v))) err(where, '要用日文'); };
  if (!str(f.name)) err('name', '商品名不能空'); else ja(f.name, 'name');
  if (!str(f.subtitle)) warn('subtitle', '副标还是空的'); else ja(f.subtitle, 'subtitle');
  if (!f.categoryId) err('categoryId', '要选一个小类');
  else if (cats) { const c = cats.find(x => x.id === f.categoryId); if (!c) err('categoryId', '分类 id 后台没有'); else if (!c.parent_id) err('categoryId', '只能选小类，不能选大类'); }
  if (f.basePriceJpy == null || f.basePriceJpy === '' || Number(f.basePriceJpy) < 0 || !Number.isInteger(Number(f.basePriceJpy))) err('basePriceJpy', '税抜价格要是 0 或正整数');
  if (p && p.base_price_jpy != null && Number(f.basePriceJpy) !== Number(p.base_price_jpy)) warn('basePriceJpy', `和采购区分配时的税抜价 ${p.base_price_jpy} 不同`);
  if (![10, 8].includes(Number(f.taxRate))) err('taxRate', '税率只能 10 或 8');
  if (f.weightG != null && f.weightG !== '' && !(Number(f.weightG) > 0)) err('weightG', '重量要是正数（克）');
  if (f.weightG == null || f.weightG === '') warn('weightG', '没填重量');
  if (!str(f.sizeCm)) warn('sizeCm', '没填尺寸');
  for (const b of (f.badges || [])) if (!ENUMS.badges.includes(b)) err('badges', `徽章「${b}」不在清单里`);
  /* 图库 */
  const ims = Array.isArray(f.images) ? f.images : [];
  if (!ims.length) err('images', '至少要有 1 张图（第一张作主图）');
  if (ims.length && ims.length < 6) warn('images', `只有 ${ims.length} 张，金样是 10～12 张`);
  ims.forEach((im, i) => {
    const where = `images.${i}`;
    if (im.card) {
      const c = im.card; if (!ENUMS.cardTypes.includes(c.type)) err(where, `卡片类型「${c.type}」不认识`);
      const need = ['triple', 'grid'].includes(c.type) ? (c.imgs || []) : [c.img];
      for (const q of need) { if (!q) err(where, '卡片缺照片'); else if (!isLocal(q)) err(where, `卡片照片要是本机绝对路径：${q}`); else if (!localOk(q)) err(where, `照片读不到或不是图片：${q}`); }
      if (['point', 'triple', 'grid'].includes(c.type) && !str(c.title)) err(where, 'POINT 卡要有标题');
      if (str(c.title).length > 16) warn(where, '卡片标题超过 14 字，可能被缩小');
      if (c.type === 'spec' && !(Array.isArray(c.tiles) && c.tiles.length)) err(where, '仕様卡要有 tiles');
      if (BRANDS.test(`${c.title || ''} ${c.sub || ''}`)) err(where, '卡片文字里有他社商标或发行方名');
    } else if (im.file) { if (!isLocal(im.file) || !localOk(im.file)) err(where, `本机照片读不到或不是图片：${im.file}`); }
    else if (!str(im.url)) err(where, '这张图既没有后台地址也没有本机照片');
    else if (!/^\/files\//.test(im.url) && !/^https?:\/\//.test(im.url)) err(where, `图片地址不像后台地址：${im.url}`);
  });
  /* SKU：来自采购区的部分不许动 */
  if (p) {
    const key = o => `${o.group_name || o.group}｜${o.label}`;
    const a = (p.options || []).map(key).sort().join('\n'), b = (f.options || []).map(key).sort().join('\n');
    if (a !== b) err('options', '规格选项的 group／label 和后台（采购区同步）不一致，不能改');
    const ka = (p.variants || []).map(v => JSON.stringify(v.combo)).sort().join('\n'), kb = (f.variants || []).map(v => JSON.stringify(v.combo)).sort().join('\n');
    if (ka !== kb) err('variants', 'SKU 组合和后台不一致，不能改');
    if (p.is_test) warn('isTest', '后台这款是「检证用」，保存多少次都不会公开');
  }
  (f.options || []).forEach((o, i) => { if (!str(o.displayName)) warn(`options.${i}`, `选项「${o.label}」没有顾客显示名（日文）`); else ja(o.displayName, `options.${i}`); if (o.imageIdx != null && o.imageIdx !== '' && !(Number(o.imageIdx) >= 0 && Number(o.imageIdx) < ims.length)) err(`options.${i}`, `选项「${o.label}」指向的相册序号 ${o.imageIdx} 不存在`); });
  /* 文案区块 */
  const feats = Array.isArray(cb.features) ? cb.features.filter(e => str(e.t) || str(e.eyebrow)) : [];
  if (feats.length < 3) warn('contentBlocks.features', `卖点只有 ${feats.length} 条，金样是 4 条`);
  feats.forEach((e, i) => { if (!str(e.t)) err(`contentBlocks.features.${i}`, '卖点缺一句日文'); else ja(e.t, `contentBlocks.features.${i}`); if (!str(e.eyebrow)) warn(`contentBlocks.features.${i}`, '卖点缺眉标'); if (!ENUMS.icons.some(x => x[0] === e.icon)) err(`contentBlocks.features.${i}`, `图标「${e.icon}」不在清单里`); if (!ENUMS.colors.some(x => x[0] === e.c)) err(`contentBlocks.features.${i}`, `颜色「${e.c}」不在清单里`); });
  if (!str(cb.featTitle)) warn('contentBlocks.featTitle', '卖点大标题是空的'); else ja(cb.featTitle, 'contentBlocks.featTitle');
  const bund = Array.isArray(cb.bundle) ? cb.bundle.filter(e => str(e.label) || str(e.img)) : [];
  if (!bund.length) warn('contentBlocks.bundle', '没写同梱物（展示品可以不写）');
  bund.forEach((e, i) => { const w = `contentBlocks.bundle.${i}`; if (!str(e.label)) err(w, '同梱物缺清单文字'); else { ja(e.label, w); if (/説明書/.test(e.label) && !/取扱説明書/.test(e.label)) err(w, '说明书只写「取扱説明書」'); } if (bund.length > 1 && !/^【.+】/.test(str(e.label))) err(w, '多套时每条要以【套餐名】开头'); if (str(e.img) && !/^\/files\//.test(e.img) && !(isLocal(e.img) && localOk(e.img))) err(w, '同梱物图片要是后台地址或本机图片'); if (!str(e.img)) warn(w, '同梱物没配图'); });
  (Array.isArray(f.specs) ? f.specs : []).forEach((x, i) => { const k = str(x && x[0]), v = str(x && x[1]); if (!k && !v) return; if (!k || !v) err(`specs.${i}`, '规格行要项目和内容都有'); else ja(k, `specs.${i}`); });
  if (!(Array.isArray(f.specs) && f.specs.some(x => str(x && x[0]) && str(x && x[1])))) warn('specs', '规格表是空的');
  (Array.isArray(cb.serviceTrust) ? cb.serviceTrust : []).forEach((e, i) => { if (!str(e.title)) err(`contentBlocks.serviceTrust.${i}`, '信任块缺标题'); if (!ENUMS.trustIcons.some(x => x[0] === e.icon)) err(`contentBlocks.serviceTrust.${i}`, `图标「${e.icon}」不在清单里`); });
  (Array.isArray(cb.assurance) ? cb.assurance : []).forEach((e, i) => { if (!str(e.title)) err(`contentBlocks.assurance.${i}`, '安心卡缺标题'); });
  if (!ENUMS.returnType.some(x => x[0] === cb.returnType)) err('contentBlocks.returnType', '退货类型不在清单里');
  if (!ENUMS.shippingType.some(x => x[0] === cb.shippingType)) err('contentBlocks.shippingType', '配送类型不在清单里');
  if (cb.shippingType === 'made_to_order' && !str(cb.leadTimeText)) warn('contentBlocks.leadTimeText', '受注生产要写纳期');
  if (!str(f.description)) warn('description', '介绍正文是空的'); else { ja(f.description, 'description'); if (str(f.description).length < 60) warn('description', '介绍正文太短'); }
  const textAll = [f.name, f.subtitle, f.description, cb.featTitle, ...feats.map(e => e.t), ...bund.map(e => e.label), ...(f.specs || []).map(x => (x || []).join(' '))].join('\n');
  if (BRANDS.test(textAll)) { const m = textAll.match(BRANDS); err('text', `文案里有他社商标或发行方名：「${m && m[0]}」`); }
  if (/(^|[^a-z])(最高|最強|No\.?1|ナンバーワン|完全|絶対|必ず|治る|治療|効果保証)/i.test(textAll)) warn('text', '文案里有夸大词或效果承诺，景表法风险');
  if (f.status && f.status !== 'draft') err('status', '状态只能是 draft，公开由人在后台点');
  return { ok: !E.length, errors: E, warnings: W };
}

/* ───── 卡片：按金样版式生成（tools/album_cards.py），输出到 数据目录/cards/<slug>/ ───── */
const PY = fs.existsSync('/usr/bin/python3') ? '/usr/bin/python3' : 'python3';
const CARDS_DIR = path.join(DATA, 'cards');
export function cardsDir(slug) { const d = path.join(CARDS_DIR, String(slug || 'x').replace(/[^\w.-]/g, '_')); fs.mkdirSync(d, { recursive: true }); return d; }
const statKey = f => { try { const st = fs.statSync(f); return `${st.size}:${Math.round(st.mtimeMs)}`; } catch { return '0'; } };
const cardKey = c => { const { preview, ...spec } = c || {}; const srcs = [spec.img, ...(Array.isArray(spec.imgs) ? spec.imgs.map(x => (typeof x === 'string' ? x : x && x.img)) : [])].filter(Boolean); return crypto.createHash('sha1').update(JSON.stringify(spec) + '|' + srcs.map(statKey).join(',') + '|v2').digest('hex').slice(0, 12); };   /* 规格＋源图的大小/改期一起算：源图换了就重画；preview 字段不参与 */
export function renderCards(cards, slug) {   /* cards：[{...spec}]；同一规格只画一次（按内容哈希命名） */
  return new Promise((resolve, reject) => {
    const dir = cardsDir(slug), todo = [], files = [];
    cards.forEach((c, i) => { const k = cardKey(c), f = path.join(dir, `${k}.jpg`); files[i] = f; if (!fs.existsSync(f)) todo.push({ ...c, name: `${k}.jpg` }); });
    if (!todo.length) return resolve(files);
    const spec = path.join(dir, `spec-${Date.now()}.json`); fs.writeFileSync(spec, JSON.stringify({ cards: todo }));
    execFile(PY, [path.join(ROOT, 'tools', 'album_cards.py'), spec, dir], { timeout: 180000, maxBuffer: 4e6, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (e, out, errOut) => {
      try { fs.rmSync(spec); } catch {}
      if (e) return reject(new Error('生成卡片失败：' + String(errOut || e.message).trim().split('\n').pop()));
      for (const f of files) if (!fs.existsSync(f)) return reject(new Error('卡片没有生成出来：' + path.basename(f)));
      resolve(files);
    });
  });
}

/* ───── 后台读写 ───── */
export async function fetchCategories() { const r = await adminCall('GET', '/admin/categories'); const d = unwrap(r); if (!(r.status >= 200 && r.status < 300)) throw new Error(`读分类失败 HTTP ${r.status}`); return Array.isArray(d) ? d : (d.items || []); }
export async function findProduct(slug) {
  const r = await adminCall('GET', '/admin/products?limit=500'); if (r.status === 401) throw new Error('后台没有登录：先在工作台「后台」窗口里登录');
  const d = unwrap(r); const arr = Array.isArray(d) ? d : (d.items || d.products || []);
  const hit = arr.find(x => x.slug === slug); if (!hit) return null;
  const full = await adminCall('GET', `/admin/products/${hit.id}`); if (!(full.status >= 200 && full.status < 300)) throw new Error(`读商品失败 HTTP ${full.status}`);
  return unwrap(full);
}
export async function loadForm(slug, tplForm) {
  const p = await findProduct(slug); if (!p) throw new Error(`后台没有款号 ${slug} 的商品（先在采购区分配到网站）`);
  const { form, meta } = fromProduct(p, tplForm); return { form, meta, product: p };
}
const summary = p => ({ name: p.name, status: p.status, images: (p.images || []).length, options: (p.options || []).length, variants: (p.variants || []).length, bundle: ((p.content_blocks || {}).bundle || []).length, features: ((p.content_blocks || {}).features || []).length, specs: (p.specs || []).length, categoryId: p.category_id, priceJpy: p.price_jpy, stock: p.stock });
/* 上传：生成卡片 → 传图 → PUT 完整 DTO → 回读比对。onStep 用来给页面报进度 */
export async function pushProduct(slug, form, { onStep = () => {}, upload = adminUpload } = {}) {
  const product = await findProduct(slug); if (!product) throw new Error(`后台没有款号 ${slug} 的商品`);
  const cats = await fetchCategories();
  const v = validate(form, { product, categories: cats }); if (!v.ok) { const e = new Error('校验没过：' + v.errors.map(x => x.msg).join('；')); e.validation = v; throw e; }
  const f = JSON.parse(JSON.stringify(form));
  const cardIdx = f.images.map((im, i) => (im.card ? i : -1)).filter(i => i >= 0);
  if (cardIdx.length) { onStep(`生成 ${cardIdx.length} 张卡片…`); const files = await renderCards(cardIdx.map(i => f.images[i].card), slug); cardIdx.forEach((i, j) => { f.images[i].file = files[j]; }); }
  let n = 0; const toUp = f.images.filter(im => im.file && !/^\/files\//.test(im.url || '')).length + (f.contentBlocks.bundle || []).filter(b => isLocal(b.img)).length;
  for (const im of f.images) { if (im.file && !/^\/files\//.test(im.url || '')) { onStep(`传图 ${++n}/${toUp}…`); const r = await upload(im.file), u = r && r.data && r.data.url; if (!(r.status >= 200 && r.status < 300) || !u) throw new Error(`传图失败 ${path.basename(im.file)}：HTTP ${r.status}`); im.url = u; } }
  for (const b of (f.contentBlocks.bundle || [])) { if (isLocal(b.img)) { onStep(`传图 ${++n}/${toUp}…`); const r = await upload(b.img), u = r && r.data && r.data.url; if (!(r.status >= 200 && r.status < 300) || !u) throw new Error(`传同梱物图失败：HTTP ${r.status}`); b.img = u; } }
  const { meta } = fromProduct(product); const dto = toDto(f, meta);
  onStep('写入后台…');
  const put = await adminCall('PUT', `/admin/products/${product.id}`, dto);
  if (!(put.status >= 200 && put.status < 300)) { const m = put.data && (put.data.message || put.data.error); throw new Error(`后台拒绝：HTTP ${put.status} ${Array.isArray(m) ? m.join('；') : (m || '')}`); }
  onStep('回读核对…');
  const after = unwrap(await adminCall('GET', `/admin/products/${product.id}`));
  const want = { name: dto.name, status: 'draft', images: dto.images.length, options: dto.options.length, variants: dto.variants.length, bundle: dto.contentBlocks.bundle.length, features: dto.contentBlocks.features.length, specs: dto.specs.length, categoryId: dto.categoryId, priceJpy: dto.priceJpy, stock: dto.stock };
  const got = summary(after); const diff = Object.keys(want).filter(k => String(want[k]) !== String(got[k])).map(k => ({ k, want: want[k], got: got[k] }));
  return { id: product.id, before: summary(product), after: got, diff, dto, imagesUploaded: n, images: f.images.map(im => im.url), url: `https://alaco.ai/admin/products/${product.id}` };
}

/* ───── 商品稿（Claude Code 起草 → 人审 → 上传） ───── */
const DRAFTS = path.join(DATA, 'drafts.json');
export function draftsLoad() { const v = readJson(DRAFTS); return v && Array.isArray(v.items) ? v : { items: [] }; }
function draftsSave(d) { writeJson(DRAFTS, d); }
export function draftPut({ slug, form, note, by, source, tplId }) {
  const d = draftsLoad(); const now = new Date().toISOString(); const id = 'd-' + str(slug, 40);
  const old = d.items.find(x => x.id === id);
  const item = { id, slug: str(slug, 40), tplId: tplId || (old && old.tplId) || '', form, note: str(note, 400), by: str(by, 40), source: source || 'ai', status: '待审', at: now, createdAt: (old && old.createdAt) || now, rev: ((old && old.rev) || 0) + 1 };
  if (old) Object.assign(old, item); else d.items.unshift(item);
  if (d.items.length > 100) d.items.length = 100;
  draftsSave(d); return item;
}
export function draftMark(slug, status, extra = {}) { const d = draftsLoad(); const it = d.items.find(x => x.slug === slug); if (it) { Object.assign(it, { status, ...extra, at: new Date().toISOString() }); draftsSave(d); } return it; }
export function draftDelete(id) { const d = draftsLoad(); const i = d.items.findIndex(x => x.id === id); if (i < 0) return false; d.items.splice(i, 1); draftsSave(d); return true; }

/* 列本机照片（给 Claude Code 用，省得它跑 Bash）：只看本人目录、不进隐藏目录 */
export function listPhotos(dir) {
  let r; try { r = fs.realpathSync(String(dir || '')); } catch { return { error: '目录不存在：' + dir }; }
  if (!r.startsWith(HOME + path.sep) || r.split(path.sep).some(s => s.startsWith('.'))) return { error: '只能看本人用户目录下、非隐藏的文件夹' };
  let st; try { st = fs.statSync(r); } catch { return { error: '读不到' }; }
  if (!st.isDirectory()) return { error: '不是文件夹' };
  const files = fs.readdirSync(r).filter(n => !n.startsWith('.')).sort().map(n => { const p = path.join(r, n); let s; try { s = fs.statSync(p); } catch { return null; } return s.isDirectory() ? { dir: n } : (/\.(png|jpe?g|gif|webp|mp4|mov|pdf|txt|md|xlsx|docx)$/i.test(n) ? { file: n, path: p, kb: Math.round(s.size / 1024) } : null); }).filter(Boolean);
  return { dir: r, count: files.length, files: files.slice(0, 300) };
}
/* 工作台页面要显示本机图片时的安全检查 */
export const previewOk = p => isLocal(p) && (localOk(p) || (() => { try { const r = fs.realpathSync(p); return r.startsWith(CARDS_DIR + path.sep) && /\.jpg$/i.test(r); } catch { return false; } })());
