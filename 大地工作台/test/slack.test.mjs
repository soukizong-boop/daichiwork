// Slack 直连：用一个假的 Slack Web API，检查输出能被页面的解析器原样读懂
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const U = {
  U0ME: { id: 'U0ME', name: 'souki', profile: { real_name: 'RunJay', display_name: '', email: 'souki@ala.jp' } },
  U0TING: { id: 'U0TING', name: 'htliu', profile: { real_name: 'Ht Liu', display_name: '阿婷', email: 'htliu@ala.jp' } },
  U0BOT: { id: 'U0BOT', name: 'claude', is_bot: true, profile: { real_name: 'Claude', display_name: '' } },
};
const now = Math.floor(Date.now() / 1000);
const H = {
  'auth.test': () => ({ user: 'souki', user_id: 'U0ME', team: '大地', team_id: 'T0' }),
  'users.list': () => ({ members: Object.values(U) }),
  'users.conversations': () => ({ channels: [{ id: 'C0MAIN', name: 'alaco-ai-daily-tasks', is_private: false }, { id: 'D0TING', is_im: true, user: 'U0TING' }, { id: 'D0BOT', is_im: true, user: 'U0BOT' }] }),
  'conversations.members': () => ({ members: ['U0ME', 'U0TING', 'U0BOT'] }),
  'conversations.history': () => ({ messages: [
    { user: 'U0TING', ts: `${now}.000200`, text: '<@U0ME> 报告放好了', reply_count: 2, latest_reply: `${now + 5}.000100` },
    { user: 'U0ME', ts: `${now - 60}.000100`, text: '收到', files: [{ name: '截图.png' }] },
  ] }),
  'conversations.replies': () => ({ messages: [{ user: 'U0TING', ts: `${now}.000200`, text: '父' }, { user: 'U0BOT', ts: `${now + 5}.000100`, text: '回复一' }] }),
  'search.messages': () => ({ messages: { matches: [
    { user: 'U0TING', ts: `${now}.000200`, text: '新消息\n第二行', channel: { id: 'D0TING', is_im: true, name: 'U0TING' } },
    { user: 'U0TING', ts: `${now - 1}.000200`, text: '频道里', channel: { id: 'C0MAIN', name: 'alaco-ai-daily-tasks' } },
    { user: 'U0TING', ts: `${now - 99999}.000200`, text: '太旧', channel: { id: 'C0MAIN', name: 'alaco-ai-daily-tasks' } },
  ] } }),
  'conversations.open': () => ({ channel: { id: 'D0TING' } }),
  'chat.postMessage': p => (/^D0/.test(p.get('channel')) ? { channel: p.get('channel'), ts: '1.2' } : { ok: false, error: 'channel_not_found' }),
};
let dead = false;
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', d => (b += d)); req.on('end', () => {
    const m = req.url.replace('/api/', ''), p = new URLSearchParams(b);
    const out = dead ? { ok: false, error: 'token_revoked' } : Object.assign({ ok: true }, (H[m] || (() => ({ ok: false, error: 'unknown_method' })))(p));
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out));
  });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
process.env.DADI_SLACK_API = `http://127.0.0.1:${srv.address().port}/api/`;
const L = await import('../slacklib.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dadi-slack-'));
L.slackInit(dir);
after(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

/* 页面 app.js 里的同款正则 */
const msgRe = /^(.*?)(?: <([^>]*)>)? \((\w+)\) at (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)[^\n]*\n(?:Message TS: ([\d.]+)\n)?([\s\S]*)$/;
const thrRe = /^From: (.*?)(?: <([^>]*)>)? \((\w+)\)\nTime: (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)[^\n]*\n(?:Message TS: ([\d.]+)\n)?([\s\S]*)$/;
const run = async (tool, input) => { const r = await L.slackDirect(tool, input); assert.ok(r && r.ok, tool + ' ' + JSON.stringify(r)); return JSON.parse(r.text); };

test('令牌格式不对不保存；保存后开启', async () => {
  assert.equal((await L.slackSetToken('xoxb-123')).ok, false);
  const r = await L.slackSetToken('xoxp-1111111111-2222222222-abcdefghijkl');
  assert.equal(r.ok, true); assert.equal(r.user, 'souki'); assert.equal(L.slackOn(), true);
  assert.equal((fs.statSync(path.join(dir, 'slack.json')).mode & 0o777).toString(8), '600');
  assert.equal(JSON.stringify(L.slackInfo()).includes('xoxp'), false);
});
test('频道列表、成员、个人资料：和连接器同格式', async () => {
  const ch = (await run('slack_list_user_channels', {})).result;
  assert.match(ch, /### #alaco-ai-daily-tasks\n- \*\*ID:\*\* C0MAIN\n- \*\*Type:\*\* Public Channel/);
  assert.match(ch, /### DM with 阿婷\n- \*\*ID:\*\* D0TING\n- \*\*Type:\*\* Direct Message\n- \*\*User ID:\*\* U0TING/);
  const mem = (await run('slack_list_channel_members', { channel_id: 'C0MAIN', include_bots: true })).members;
  assert.match(mem, /Members \(3\)/); assert.equal(mem.split(/\n## Member \d+\n/).length, 4); assert.match(mem, /slack-bots\.com/);
  const prof = (await run('slack_read_user_profile', {})).result;
  assert.equal(prof.split('\n')[0].replace(/\s*\(.*$/, ''), 'souki'); assert.match(prof, /souki@ala\.jp/);
});
test('读频道与线程：页面解析器读得出名字、邮箱、时间、回复数', async () => {
  const raw = (await run('slack_read_channel', { channel_id: 'C0MAIN', limit: 25 })).messages;
  const parts = raw.split(/=== Message from /).slice(1).map(p => p.match(msgRe));
  assert.equal(parts.length, 2); assert.ok(parts.every(Boolean));
  assert.equal(parts[0][1], '阿婷'); assert.equal(parts[0][2], 'htliu@ala.jp'); assert.match(parts[0][6], /<@U0ME\|RunJay> 报告放好了\nThread: 2 replies/);
  assert.match(parts[1][6], /收到\n📎 截图\.png/);
  const th = (await run('slack_read_thread', { channel_id: 'C0MAIN', message_ts: `${now}.000200` })).messages;
  const rs = th.split(/--- Reply \d+ of \d+ ---\n/).slice(1).map(p => p.match(thrRe));
  assert.equal(rs.length, 1); assert.match(rs[0][2], /slack-bots\.com/); assert.match(rs[0][6], /^回复一/);
});
test('搜索：DM 写成「DM with 名字」，按 after 过滤旧消息，每条一行', async () => {
  const res = (await run('slack_search_public_and_private', { filters: 'after:2026-10-01', after: String(now - 600), limit: 20 })).results;
  const items = ('\n' + res).split(/\n(?=\d+\.\s)/).map(x => x.match(/^\d+\.\s+(.+?) - [\s\S]*?(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) JST\s*$/)).filter(Boolean);
  assert.deepEqual(items.map(m => m[1]), ['DM with 阿婷', '#alaco-ai-daily-tasks']);
});
test('发消息：给人发先开私聊；Slack 报错原样交回', async () => {
  assert.equal((await run('slack_send_message', { channel_id: 'U0TING', message: 'hi' })).ts, '1.2');
  const r = await L.slackDirect('slack_send_message', { channel_id: 'C0NONE', message: 'x' });
  assert.equal(r.ok, false); assert.match(r.error, /channel_not_found/);
});
test('缺某项权限：只把这一项退回连接器，直连不关', async () => {
  H['conversations.open'] = () => ({ ok: false, error: 'missing_scope', needed: 'im:write' });
  assert.equal((await run('slack_send_message', { channel_id: 'U0BOT', message: '问一句' })).ok, undefined);   /* 有私聊 D0BOT：不用开 */
  assert.equal(await L.slackDirect('slack_send_message', { channel_id: 'U0NEW', message: 'x' }), null);
  assert.equal(L.slackOn(), true);
});
test('缺核心权限不保存；读的缺权限明说不退回 Claude；私聊编号解析', async () => {
  const keep = H['search.messages']; H['search.messages'] = () => ({ ok: false, error: 'missing_scope', needed: 'search:read' });
  const r = await L.slackSetToken('xoxp-1111111111-2222222222-abcdefghijkl'); assert.equal(r.ok, false); assert.match(r.error, /search:read/);
  H['search.messages'] = keep;
  assert.ok((await L.slackSetToken('xoxp-1111111111-2222222222-abcdefghijkl')).ok);
  const kh = H['conversations.history']; H['conversations.history'] = () => ({ ok: false, error: 'missing_scope', needed: 'groups:history' });
  const rd = await L.slackDirect('slack_read_channel', { channel_id: 'C0MAIN' }); assert.equal(rd.ok, false); assert.equal(rd.code, 'skip'); assert.match(rd.error, /groups:history/);
  H['conversations.history'] = kh;
  assert.equal(await L.slackDm('U0TING'), 'D0TING');
});
test('限速按方法记：搜索被限，发消息照常；读的缺权限会记到系统窗口', async () => {
  const keep = H['search.messages']; H['search.messages'] = () => ({ ok: false, error: 'ratelimited' });
  const s = await L.slackDirect('slack_search_public_and_private', { query: 'x' }); assert.equal(s.ok, false); assert.equal(s.code, 'limit');
  H['search.messages'] = keep;
  const s2 = await L.slackDirect('slack_search_public_and_private', { query: 'x' }); assert.equal(s2.code, 'limit', '限速期间不再发请求');
  const m = await L.slackDirect('slack_send_message', { channel_id: 'D0TING', message: 'hi' }); assert.ok(m && m.ok, '发消息不受搜索限速影响：' + JSON.stringify(m));
  const kh = H['conversations.history']; H['conversations.history'] = () => ({ ok: false, error: 'missing_scope', needed: 'groups:history' });
  await L.slackDirect('slack_read_channel', { channel_id: 'C0MAIN' }); H['conversations.history'] = kh;
  assert.deepEqual(L.slackInfo().missing, ['groups:history']);
});
test('令牌被撤销：返回 null（退回连接器），之后不再直连', async () => {
  dead = true;
  assert.equal(await L.slackDirect('slack_read_channel', { channel_id: 'C0MAIN' }), null);
  assert.equal(L.slackOn(), false); assert.equal(L.slackInfo().bad, 'token_revoked');
  dead = false;
});
