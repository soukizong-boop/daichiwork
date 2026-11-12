#!/usr/bin/env node
// 替身 claude：只给测试用。mcp add/remove 时什么都不做；-p 时读 stdin：
//   普通的（自动小结）→ 回一段固定的小结 JSON；
//   派活智能体的（带 --mcp-config，提示里有「派活智能体」）→ 真的去调任务表的工具：看全员、建一个任务、定一条提醒、试一次不该有的工具、写简报。
import fs from 'node:fs';
const a = process.argv.slice(2);
if (a[0] === 'mcp') process.exit(0);
if (a[0] === 'auth') { console.log(JSON.stringify({ loggedIn: !process.env.FAKE_LOGGED_OUT })); process.exit(0); }
if (!a.includes('-p')) { process.stdin.resume(); setTimeout(() => process.exit(0), 600000); }   /* 工作台常驻的那种进程：不说话，等着被关 */
else {
  let s = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', d => s += d); process.stdin.on('end', async () => {
    const i = a.indexOf('--mcp-config');
    if (process.env.FAKE_AUTH_FAIL) { process.stdout.write(JSON.stringify({ type: 'result', is_error: true, result: 'Failed to authenticate: OAuth session expired and could not be refreshed' }) + '\n'); return; }
    if (i < 0 || !/派活智能体/.test(s)) {
      const result = JSON.stringify({ done: ['建好 PO-2026-012（mospace 第二批）'], learned: [{ title: '报价单币种要先确认', text: '深圳公司的报价单默认人民币，建单前先问汇率。', category: '采购单' }], unfinished: ['g-2026101 等供应商照片'], todo: process.env.FAKE_TODO ? JSON.parse(process.env.FAKE_TODO) : [], gaps: process.env.FAKE_GAPS ? JSON.parse(process.env.FAKE_GAPS) : [] });
      process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: '```json\n' + result + '\n```' }) + '\n'); return;
    }
    const m = JSON.parse(fs.readFileSync(a[i + 1], 'utf8')).mcpServers['dadi-brain']; let n = 0;
    const tool = async (name, args) => { const r = await fetch(m.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: m.headers.Authorization }, body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args || {} } }) }); return JSON.parse((await r.json()).result.content[0].text); };
    const ov = await tool('team_overview'); const b = ov.people.find(x => x.role === '成员' && !x.off_today) || ov.people[0];
    const t = await tool('task_create', { title: '跟进 g-2026200 的供应商照片', category: '商品页', assignee: b.name, detail: '上次小结里没做完' });
    const d = new Date(Date.now() + 3 * 60000), at = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const r = await tool('remind', { to: b.name, at, text: '看一下 g-2026200 的照片到了没有' });
    const bad = await tool('admin_write', { method: 'PUT', path: '/admin/products/abc', body: {} });
    await tool('brief', { text: `${b.name}：今天跟进 g-2026200 的照片。\n要你决定的事：没有。` });
    process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: `排好了。看到 ${ov.people.length} 个人；建任务：${t.ok ? t.task.id : t.error}；提醒：${r.ok ? r.at : r.error}；试改后台：${bad.error}` }) + '\n');
  });
}
