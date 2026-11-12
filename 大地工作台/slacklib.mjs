// 大地工作台 · Slack 直连
// 用你自己建的 Slack 应用（Dadi Workbench）的用户令牌（xoxp-），本机直接调 Slack Web API，不经过 Claude。
// 返回的文字和 claude.ai Slack 连接器一模一样（页面的解析器不用改）；令牌失效时由 server 退回连接器。
// 令牌存在 data/slack.json（0600，仅本人可读）；不写日志、不交给模型。
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.DADI_SLACK_API || 'https://slack.com/api/';
let FILE = '';
let saved = null;                  // { token, user, userId, team, teamId, at }
let bad = '';                      // 令牌被 Slack 拒绝的原因（invalid_auth 等）；有值时不再直连
export function slackInit(dataDir) {
  FILE = path.join(dataDir, 'slack.json');
  try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (!saved || !saved.token) saved = null; } catch { saved = null; }
}
export const slackOn = () => !!(saved && !bad);
const missing = new Set();   /* 用的时候才发现缺的读权限（比如以前存的令牌没验过）：系统窗口直接显示缺哪个 */
export const slackInfo = () => (saved ? { on: !bad, user: saved.user, team: saved.team, at: saved.at, bad, missing: [...missing] } : null);

/* 这几种错误＝令牌本身不能用了：停用直连，退回连接器（每 5 分钟再试一次，好了自动恢复） */
const DEAD = /^(invalid_auth|not_authed|token_revoked|token_expired|account_inactive|ekm_access_denied)$/;
/* 这几种只是「这一项没权限」：只把这一项退回连接器，令牌照用 */
const SKIP = /^(missing_scope|no_permission|not_allowed_token_type)$/;
let badAt = 0;
setInterval(async () => {
  if (!bad || !saved || Date.now() - badAt < 300e3) return;
  badAt = Date.now();
  try { await web('auth.test', {}); bad = ''; } catch {}
}, 60e3).unref();
const limitUntil = new Map();   /* 每个方法被限速到什么时候（Slack 的限额按方法算：搜索被限不影响发消息）：期间这个方法不再发请求，直接报 limit */
async function web(method, args, token = saved && saved.token) {
  const gate = saved && token === saved.token, lu = gate ? limitUntil.get(method) || 0 : 0;   /* 只管用着的令牌；保存新令牌时的检查不受影响 */
  if (Date.now() < lu) { const ra = Math.ceil((lu - Date.now()) / 1000); throw Object.assign(new Error('Slack 限速中，' + ra + ' 秒后再试'), { code: 'limit', retryAfter: ra }); }
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(args || {})) if (v !== undefined && v !== '') body.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  const r = await fetch(API + method, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' }, body, signal: AbortSignal.timeout(20000) });
  if (r.status === 429) { const ra = Math.min(600, Number(r.headers.get('retry-after')) || 30); if (gate) limitUntil.set(method, Date.now() + ra * 1000); throw Object.assign(new Error('Slack 说请求太频繁，' + ra + ' 秒后再试'), { code: 'limit', retryAfter: ra }); }   /* 按 Retry-After 停手 */
  const j = await r.json().catch(() => ({ ok: false, error: 'HTTP ' + r.status }));
  if (!j.ok) {
    if (j.error === 'ratelimited' && gate) limitUntil.set(method, Date.now() + 30e3);
    const e = Object.assign(new Error(j.error || 'unknown_error'), { code: DEAD.test(j.error || '') ? 'dead' : SKIP.test(j.error || '') ? 'skip' : j.error === 'ratelimited' ? 'limit' : 'tool_error', needed: j.needed, retryAfter: j.error === 'ratelimited' ? 30 : undefined });
    throw e;
  }
  return j;
}

/* 保存前先试：令牌对不对、是不是用户令牌、各项权限能不能用 */
export async function slackSetToken(token) {
  token = String(token || '').trim();
  if (!token) { saved = null; bad = ''; users.at = 0; convs.at = 0; try { fs.unlinkSync(FILE); } catch {} return { ok: true, off: true }; }
  if (!/^xoxp-[\w-]{20,}$/.test(token)) return { ok: false, error: '要的是 xoxp- 开头的 User OAuth Token（不是 xoxb-）' };
  let a;
  try { a = await web('auth.test', {}, token); } catch (e) { return { ok: false, error: 'Slack 不认这个令牌：' + e.message }; }
  /* 核心权限（列会话、成员名单、搜索、读一个频道和一个私聊的消息）缺一个就不保存：否则「直连」名存实亡，每一轮都悄悄退回 Claude 取数 */
  const check = {}, core = [], picks = { pub: '', priv: '', im: '' }, note = e => e.message + (e.needed ? '（缺 ' + e.needed + '）' : '');
  let limited = 0;
  const one = async (k, m, args) => { try { const j = await web(m, args, token); check[k] = 'ok'; return j; } catch (e) { check[k] = note(e); if (e.code === 'limit') limited = Math.max(limited, e.retryAfter || 30); else core.push(k); return null; } };
  const lj = await one('频道和私聊列表', 'users.conversations', { limit: 200, exclude_archived: true, types: 'public_channel,private_channel,im' });
  if (lj) { const l = lj.channels || []; picks.pub = (l.find(c => !c.is_im && !c.is_mpim && !c.is_private) || {}).id || ''; picks.priv = (l.find(c => !c.is_im && !c.is_mpim && c.is_private) || {}).id || ''; picks.im = (l.find(c => c.is_im) || {}).id || ''; }
  await one('成员名单', 'users.list', { limit: 1 });
  await one('搜索', 'search.messages', { query: 'after:2000-01-01', count: 1 });
  for (const [k, id] of [['读公开频道消息', picks.pub], ['读私有频道消息', picks.priv], ['读私聊消息', picks.im]]) if (id) await one(k, 'conversations.history', { channel: id, limit: 1 });   /* 有哪种就验哪种 */
  if (limited) return { ok: false, error: 'Slack 说请求太频繁，没验完权限，' + limited + ' 秒后再保存一次', check };
  if (core.length) return { ok: false, error: '应用缺权限，没有保存：' + core.map(k => k + '＝' + check[k]).join('；') + '。到 api.slack.com/apps 给 Dadi Workbench 补上再重新粘贴令牌', check };
  saved = { token, user: a.user, userId: a.user_id, team: a.team, teamId: a.team_id, at: Date.now(), check };
  bad = ''; users.at = 0; convs.at = 0; limitUntil.clear(); missing.clear();
  fs.writeFileSync(FILE, JSON.stringify(saved), { mode: 0o600 });
  loadUsers(true).catch(() => {}); loadConvs(true).catch(() => {});   /* 顺手把名单预热，第一轮不用各自去拉 */
  return { ok: true, user: a.user, team: a.team, check };
}

/* ── 名单缓存：谁是谁（一小时）、我在哪些会话里（十分钟）── */
const users = { at: 0, map: new Map(), loading: null };
async function loadUsers(force) {
  if (!force && Date.now() - users.at < 3600e3 && users.map.size) return users.map;
  if (users.loading) return users.loading;   /* 几个并行调用同时发现过期：只拉一遍（users.list 限速紧） */
  users.loading = (async () => {
    const map = new Map(); let cursor = '';
    do {
      const j = await web('users.list', { limit: 200, cursor });
      for (const u of j.members || []) {
        const p = u.profile || {};
        map.set(u.id, { id: u.id, username: u.name || '', display: p.display_name || '', real: p.real_name || u.real_name || '', email: p.email || '', bot: !!u.is_bot || u.id === 'USLACKBOT', deleted: !!u.deleted });
      }
      cursor = (j.response_metadata && j.response_metadata.next_cursor) || '';
    } while (cursor);
    users.map = map; users.at = Date.now();
    return map;
  })().finally(() => { users.loading = null; });
  return users.loading;
}
async function who(uid) {
  let u = (await loadUsers()).get(uid);
  if (!u && /^[UW]/.test(uid)) { try { const j = await web('users.info', { user: uid }); const p = j.user.profile || {}; u = { id: uid, username: j.user.name || '', display: p.display_name || '', real: p.real_name || '', email: p.email || '', bot: !!j.user.is_bot }; users.map.set(uid, u); } catch {} }
  return u || { id: uid, username: uid, display: '', real: '', email: '', bot: false };
}
const nameOf = u => u.display || u.real || u.username || u.id;
/* 机器人没有邮箱：给一个 slack-bots.com 的假地址，页面就是靠它认出「这是机器人」的（和连接器一致） */
const mailOf = u => u.email || (u.bot ? `bot-${u.id}@slack-bots.com` : '');
const convs = { at: 0, list: [], loading: null };
async function loadConvs(force) {
  if (!force && Date.now() - convs.at < 600e3 && convs.list.length) return convs.list;
  if (convs.loading) return convs.loading;
  convs.loading = (async () => {
    const list = []; let cursor = '';
    do {
      const j = await web('users.conversations', { types: 'public_channel,private_channel,im', exclude_archived: true, limit: 200, cursor });
      list.push(...(j.channels || []));
      cursor = (j.response_metadata && j.response_metadata.next_cursor) || '';
    } while (cursor);
    convs.list = list; convs.at = Date.now();
    return list;
  })().finally(() => { convs.loading = null; });
  return convs.loading;
}
/* 搜索结果里的私聊只给了用户名（不一定给编号）：先按编号，再按用户名／显示名在名单里找 */
async function whoLoose(uid, name) {
  if (uid) return who(uid);
  if (!name) return { id: '', username: '（未知）', display: '', real: '', email: '', bot: false };
  const byName = [...(await loadUsers()).values()].find(u => u.username === name || u.display === name || u.real === name);
  return byName || who(name);
}
/* 给某人发东西要的私聊编号：有现成的用现成的（不需要 im:write），没有才开一个 */
export async function slackDm(uid) {
  if (!slackOn()) return null;
  const im = (await loadConvs()).find(c => c.is_im && c.user === uid) || (await loadConvs(true)).find(c => c.is_im && c.user === uid);
  if (im) return im.id;
  const j = await web('conversations.open', { users: uid }); convs.at = 0; return j.channel.id;
}

/* ── 和连接器同样的文字格式 ── */
const jst = ts => new Date(Number(ts) * 1000 + 9 * 3600e3).toISOString().slice(0, 19).replace('T', ' ') + ' JST';
/* <@U123> → <@U123|名字>（页面的 slackText 认这种写法） */
async function named(text) {
  const ids = [...new Set([...String(text || '').matchAll(/<@([UW][A-Z0-9]+)>/g)].map(m => m[1]))];
  let out = String(text || '');
  for (const id of ids) { const u = await who(id); out = out.split(`<@${id}>`).join(`<@${id}|${nameOf(u)}>`); }
  return out;
}
async function author(m) {
  if (m.user) { const u = await who(m.user); return { name: nameOf(u), email: mailOf(u), id: m.user }; }
  const bp = m.bot_profile || {};
  return { name: m.username || bp.name || 'bot', email: `bot-${m.bot_id || 'x'}@slack-bots.com`, id: m.bot_id || bp.id || 'B0' };
}
async function bodyOf(m) {
  let t = await named(m.text);
  const files = (m.files || []).map(f => f.name || f.title).filter(Boolean);
  if (files.length) t = (t ? t + '\n' : '') + '📎 ' + files.join('、');
  return t;
}
async function messageBlock(m) {
  const a = await author(m);
  let s = `=== Message from ${a.name}${a.email ? ` <${a.email}>` : ''} (${a.id}) at ${jst(m.ts)} === \nMessage TS: ${m.ts}\n${await bodyOf(m)}`;
  if (m.reply_count) s += `\nThread: ${m.reply_count} replies (latest: ${jst(m.latest_reply || m.ts)})`;
  if (Array.isArray(m.reactions) && m.reactions.length) s += `\nReactions: ${m.reactions.map(r => `${r.name} (${r.count})`).join(', ')}`;
  return s;
}
const J = v => JSON.stringify(v);

async function readUserProfile() {
  const u = await who(saved.userId);
  return J({ result: `${u.username} (${u.real})\n${saved.team || ''}\n\n${u.email}\n` });
}
async function listUserChannels() {
  const list = await loadConvs(true);
  const blocks = [];
  for (const c of list) {
    if (c.is_im) { const u = await who(c.user); if (u.deleted) continue; blocks.push(`### DM with ${nameOf(u)}\n- **ID:** ${c.id}\n- **Type:** Direct Message\n- **User ID:** ${c.user}\n- **Archived:** No`); }
    else blocks.push(`### #${c.name}\n- **ID:** ${c.id}\n- **Type:** ${c.is_private ? 'Private' : 'Public'} Channel${c.purpose && c.purpose.value ? `\n- **Purpose:** ${String(c.purpose.value).replace(/\s+/g, ' ')}` : ''}\n- **Archived:** ${c.is_archived ? 'Yes' : 'No'}`);
  }
  return J({ result: `## My Channels (showing ${blocks.length} of ${blocks.length} total)\n\n` + blocks.join('\n\n') + '\n' });
}
async function listMembers(i) {
  const ids = []; let cursor = '';
  do { const j = await web('conversations.members', { channel: i.channel_id, limit: 200, cursor }); ids.push(...(j.members || [])); cursor = (j.response_metadata && j.response_metadata.next_cursor) || ''; } while (cursor && ids.length < 400);
  const rows = [];
  for (const [k, id] of ids.entries()) { const u = await who(id); if (!i.include_bots && u.bot) continue; rows.push(`## Member ${k + 1}\nUser ID: ${id}\nUsername: @${u.username}\nDisplay Name: ${u.display}\nReal Name: ${u.real}\nEmail: ${mailOf(u) || 'N/A'}\n`); }
  return J({ members: `# Channel Members (${rows.length})\n\n` + rows.join('\n'), pagination_info: 'No more members available.\n' });
}
async function readChannel(i) {
  const j = await web('conversations.history', { channel: i.channel_id, limit: Math.min(100, Number(i.limit) || 25), oldest: i.oldest, latest: i.latest });
  const parts = [];
  for (const m of j.messages || []) parts.push(await messageBlock(m));
  return J({ messages: `Channel: ${i.channel_id} (${i.channel_id})\n\n` + parts.join('\n\n') });
}
async function readThread(i) {
  const j = await web('conversations.replies', { channel: i.channel_id, ts: i.message_ts, limit: Math.min(200, Number(i.limit) || 40) });
  const [head, ...rest] = j.messages || [];
  if (!head) return J({ messages: '' });
  const line = async m => { const a = await author(m); return `From: ${a.name}${a.email ? ` <${a.email}>` : ''} (${a.id})\nTime: ${jst(m.ts)}\nMessage TS: ${m.ts}\n${await bodyOf(m)}`; };
  let s = `=== THREAD PARENT MESSAGE ===\n${await line(head)}\n\n=== THREAD REPLIES (${rest.length} total) ===\n`;
  for (const [k, m] of rest.entries()) s += `\n--- Reply ${k + 1} of ${rest.length} ---\n${await line(m)}\n`;
  return J({ messages: s });
}
/* 搜索：连接器的写法是「after:日期」＋ after（秒）；这里按同样的意思查，再按秒数过滤 */
async function search(i) {
  const words = String(i.query || i.natural_language_query || '').trim();
  const q = [words, String(i.filters || '').trim()].filter(Boolean).join(' ') || 'after:' + new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10);
  const j = await web('search.messages', { query: q, sort: 'timestamp', sort_dir: i.sort_dir || 'desc', count: Math.min(100, Number(i.limit) || 20) });
  const after = Number(i.after) || 0, list = await loadConvs();
  const lines = []; let n = 0;
  for (const m of (j.messages && j.messages.matches) || []) {
    if (after && Number(m.ts) <= after) continue;
    const ch = m.channel || {}, mine = list.find(c => c.id === ch.id);
    let where;
    if (ch.is_im || (mine && mine.is_im)) { const u = await whoLoose((mine && mine.user) || ch.user || '', ch.name || ''); where = `DM with ${nameOf(u)}`; }
    else if (ch.is_mpim) continue;
    else where = '#' + (ch.name || (mine && mine.name) || ch.id);
    const a = await author(m);
    lines.push(`${++n}. ${where} - ${a.name}: ${(await named(m.text)).replace(/\s+/g, ' ').slice(0, 300)} ${jst(m.ts)}`);
  }
  return J({ results: `# Search Results for: ${words}\n\n## Messages (${n} results)\n` + lines.join('\n') + '\n', pagination_info: '' });
}
async function send(i) {
  let ch = String(i.channel_id || '');
  /* 给某人发：先用已有的私聊（不需要 im:write 权限）；没有私聊过才去开一个 */
  if (/^[UW]/.test(ch)) ch = await slackDm(ch);
  const j = await web('chat.postMessage', { channel: ch, text: i.message, thread_ts: i.thread_ts });
  return J({ result: 'Message sent', channel: j.channel, ts: j.ts });
}
async function uploadUrl(i) {
  const j = await web('files.getUploadURLExternal', { filename: i.filename, length: i.content_length });
  return J({ upload_url: j.upload_url, file_id: j.file_id });
}
async function completeUpload(i) {
  const j = await web('files.completeUploadExternal', { files: [{ id: i.file_id, title: i.title || '' }], channel_id: i.channel_id, initial_comment: i.initial_comment, thread_ts: i.thread_ts });
  return J({ ok: true, files: j.files });
}

/* 点表情：reactions.add 要 reactions:write 权限；应用没开这个权限时 missing_scope → 退回连接器 */
async function addReaction(i) {
  await web('reactions.add', { channel: String(i.channel_id || ''), timestamp: String(i.timestamp || i.message_ts || ''), name: String(i.emoji || i.emoji_name || i.name || '').replace(/^:|:$/g, '') });
  return J({ result: 'Reaction added' });
}
const TOOLS = {
  slack_read_user_profile: readUserProfile, slack_list_user_channels: listUserChannels, slack_list_channel_members: listMembers,
  slack_read_channel: readChannel, slack_read_thread: readThread, slack_search_public_and_private: search,
  slack_send_message: send, slack_get_file_upload_url: uploadUrl, slack_complete_file_upload: completeUpload, slack_add_reaction: addReaction,
};
const READS = new Set(['slack_read_user_profile', 'slack_list_user_channels', 'slack_list_channel_members', 'slack_read_channel', 'slack_read_thread', 'slack_search_public_and_private']);
export const slackCan = tool => !!TOOLS[tool];
/* 一项调用：返回和 batch() 一样的 {ok,text} / {ok:false,code,error}；令牌死了返回 null（让 server 退回连接器） */
export async function slackDirect(tool, input) {
  if (!slackOn() || !TOOLS[tool]) return null;
  try { return { ok: true, text: await TOOLS[tool](input || {}) }; }
  catch (e) {
    if (e.code === 'dead') { bad = e.message; badAt = Date.now(); return null; }
    if (e.code === 'skip') { if (!READS.has(tool)) return null; missing.add(e.needed || tool); return { ok: false, code: 'skip', error: 'Slack 应用缺权限' + (e.needed ? '：' + e.needed : '') + '，到 api.slack.com/apps 给 Dadi Workbench 补上' }; }   /* 读的缺权限要明说，不悄悄退回 Claude（那样每 15 秒起一个取数进程）；写的（点表情这类）退回连接器 */
    return { ok: false, code: e.code === 'limit' ? 'limit' : e.name === 'TimeoutError' ? 'timeout' : 'tool_error', error: String(e.message || e) + (e.needed ? '（缺权限 ' + e.needed + '）' : ''), ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}) };
  }
}
export const _test = { jst, setSaved: v => { saved = v; bad = ''; users.at = 0; convs.at = 0; } };
