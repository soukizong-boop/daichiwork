// 协作部分的联调测试（任务窗口背后那一套）：起一个临时工作台（临时数据目录、随机端口、替身 Claude），
// 走一遍 钥匙→任务→固定做法（＝模版）→经验批准写进模版→流程链→守门→留言通知→取代复查→文件存档→钩子→自动小结→安装器。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.dirname(HERE);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wbbrain-')); const DATA = path.join(TMP, 'data'), CHOME = path.join(TMP, 'dadi-home'), CCONF = path.join(TMP, 'claude');
const PORT = 8700 + Math.floor(Math.random() * 100), U = `http://127.0.0.1:${PORT}`;
const FAKE = path.join(HERE, 'fake-claude-brain.mjs');
const srv = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], { env: { ...process.env, DADI_PORT: String(PORT), DADI_DATA: DATA, DADI_CLAUDE: FAKE, DADI_FAKE_DIR: TMP, DADI_TEST_ITEMS: path.join(TMP, 'items.json'), DADI_TEST_CHECKS: path.join(TMP, 'checks.json'), DADI_TEST_SCAN_DELAY: path.join(TMP, 'slow.flag'), DADI_TRANSCRIPTS: path.join(TMP, 'transcripts'), DADI_CHROME: '0', DADI_DRIVE_MOUNT: path.join(TMP, 'nodrive'), DADI_IMAP_HOST: '127.0.0.1', DADI_IMAP_PORT: '1', DADI_BK_QUOTA: '200000' }, stdio: 'ignore' });
let up = false; for (let i = 0; i < 60 && !up; i++) { await new Promise(r => setTimeout(r, 250)); try { up = (await fetch(U + '/')).status === 200 && fs.existsSync(path.join(DATA, 'brain', 'owner.key')); } catch {} }
const ownerKey = fs.readFileSync(path.join(DATA, 'brain', 'owner.key'), 'utf8').trim();
const TOKEN = fs.readFileSync(path.join(DATA, 'secret'), 'utf8').trim();
const H = { 'content-type': 'application/json', 'x-dadi': '1', 'x-dadi-token': TOKEN };
let n = 0;
const rpc = async (key, method, params) => { const r = await fetch(U + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method, params }) }); return { status: r.status, json: await r.json().catch(() => null) }; };
const tool = async (key, name, args) => { const r = await rpc(key, 'tools/call', { name, arguments: args || {} }); return JSON.parse(r.json.result.content[0].text); };
const web = async (p, body, headers = H) => { const r = await fetch(U + p, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; };
const state = async () => (await web('/api/brain/state')).json;
const practice = async cat => ((await web('/api/templates')).json.items.find(t => t.category === cat && t.kind !== 'remind') || {});
const hookGet = async (key, p) => (await fetch(U + p, { headers: { authorization: 'Bearer ' + key } })).text();
const OLDHOME = path.join(TMP, 'oldhome'), NEWHOME = path.join(TMP, 'newhome'); fs.mkdirSync(OLDHOME, { recursive: true }); fs.mkdirSync(NEWHOME, { recursive: true });
const enc = x => x.replace(/[^a-zA-Z0-9]/g, '-');
const cli = (args, env = {}, input) => execFileSync(process.execPath, [path.join(env.DADI_BRAIN_HOME || CHOME, 'brain-hook.mjs'), ...args], { env: { ...process.env, DADI_BRAIN_HOME: CHOME, DADI_BRAIN_HOOK: '', DADI_NO_NOTIFY: '1', CLAUDE_CONFIG_DIR: CCONF, HOME: OLDHOME, ...env }, input, encoding: 'utf8' });
const beatsOf = async id => until(() => { try { return JSON.parse(fs.readFileSync(path.join(DATA, 'brain', 'beats.json'), 'utf8'))[id]; } catch { return null; } }, 9000);   /* 心跳攒 5 秒才落盘 */
const until = async (fn, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 150)); } };
test.after(() => { srv.kill(); fs.rmSync(TMP, { recursive: true, force: true }); });
let bKey, bId, tid;
const meDo = async (key, body) => { const r = await fetch(U + '/me/task', { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; };

test('钥匙：没有或错的钥匙进不来；初始化带规矩说明；工具清单完整', async () => {
  assert.ok(up, '工作台没起来');
  assert.equal((await rpc('wrong', 'tools/list')).status, 401);
  const init = await rpc(ownerKey, 'initialize', { protocolVersion: '2025-06-18' });
  assert.match(init.json.result.instructions, /brain_start/);
  const names = (await rpc(ownerKey, 'tools/list')).json.result.tools.map(t => t.name);
  for (const x of ['brain_start', 'task_get', 'task_update', 'task_create', 'task_comment', 'file_list', 'recall', 'remember', 'propose_practice', 'daily_digest', 'admin_get', 'admin_write', 'product_check']) assert.ok(names.includes(x), x);
});
test('页面接口：要带工作台口令；加人、分工、批准要管理员人物', async () => {
  assert.equal((await web('/api/brain/state', undefined, {})).status, 401);
  assert.equal((await web('/api/role', { key: 'kisou' })).status, 200);
  assert.equal((await web('/api/brain/person/add', { name: '不该成功' })).status, 403);
  assert.equal((await web('/api/role', { key: 'boss' })).status, 200);
  const r = await web('/api/brain/person/add', { name: '同事B' }); assert.equal(r.status, 200); bKey = r.json.key; bId = r.json.id; assert.match(bKey, /^dk_/);
  const st = await state(); assert.equal(st.manage, true); assert.ok(st.categories.includes('商品页'));
  assert.equal((await web('/api/brain/duties/save', { map: { ...st.duties.map, 商品页: bId } })).status, 200);
});
test('安装器：装小助手、加连接、写四个钩子，原有设置不丢', async () => {
  fs.mkdirSync(CCONF, { recursive: true }); fs.writeFileSync(path.join(CCONF, 'settings.json'), JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo keep' }] }] } }));
  const out = execFileSync(process.execPath, [path.join(ROOT, 'client', 'install.mjs'), U, bKey], { env: { ...process.env, DADI_BRAIN_HOME: CHOME, CLAUDE_CONFIG_DIR: CCONF, DADI_CLAUDE_BIN: FAKE, DADI_NO_LAUNCHD: '1', DADI_LAUNCHD_DIR: path.join(TMP, 'agents') }, encoding: 'utf8' });
  assert.match(out, /钩子已装/); assert.match(out, /你自己确认了才传的[\s\S]*对话精简版/); assert.match(out, /不会传：对话里的文件内容和命令输出/);
  assert.match(fs.readFileSync(path.join(TMP, 'agents', 'ai.alaco.dadi-sync.plist'), 'utf8'), /brain-hook\.mjs<\/string><string>tick/);
  const s = JSON.parse(fs.readFileSync(path.join(CCONF, 'settings.json'), 'utf8'));
  assert.equal(s.model, 'opus'); assert.ok(s.hooks.Stop); assert.equal(s.hooks.Stop.length, 2); for (const ev of ['SessionStart', 'UserPromptSubmit', 'Stop', 'SessionEnd', 'PreCompact']) assert.match(JSON.stringify(s.hooks[ev]), /brain-hook\.mjs/);
  assert.equal((fs.statSync(path.join(CHOME, 'config.json')).mode & 0o777), 0o600); assert.ok(fs.existsSync(path.join(CHOME, 'dadi')));
});
test('派活即通知：按分工表派；对方开对话时钩子自动带入任务和新通知；领任务时模版里的固定做法一起给；别人的任务领不了', async () => {
  const mk = await tool(ownerKey, 'task_create', { title: '给 g-2026200 做商品页', category: '商品页', ref: 'g-2026200' }); tid = mk.task.id;
  assert.equal(mk.task.assignee, '同事B');
  const start = cli(['start']); assert.match(start, /今天要做 1 件/); assert.match(start, new RegExp(tid)); assert.match(start, /新任务/);
  assert.equal(cli(['prompt']).trim(), '');   /* 一分钟内不重复查 */
  assert.doesNotMatch(await hookGet(bKey, '/hook/start'), /新通知/);
  const b = await tool(bKey, 'brain_start'); assert.equal(b.my_open_tasks.length, 1); assert.match(b.company_facts, /T8120001253998/);
  const pack = await tool(bKey, 'task_get', { id: tid }); const tp = await practice('商品页');
  assert.ok(tp.id, '商品页这一类应该有自带模版'); assert.equal(pack.practice.version, tp.version); assert.ok(pack.practice.text.length > 50);
  const mine = await tool(ownerKey, 'task_create', { title: '问税理士一件事', category: '税务行政' });
  assert.match((await tool(bKey, 'task_get', { id: mine.task.id })).error, /不在你名下/);
});
test('越用越懂：经验先是待验证 → 管理员在页面批准 → 写进这一类的模版、版本加一 → 下一个领任务的人直接拿到', async () => {
  const v0 = (await practice('商品页')).version;
  const r = await tool(bKey, 'remember', { title: '规格无出处留空', text: '供应商资料里没有的规格不填，不要估。', category: '商品页', evidence: 'g-2026017 的重量是估的，和实物不符' });
  assert.equal(r.status, '待验证');
  assert.ok((await tool(ownerKey, 'recall', { query: '规格 出处' })).results.some(x => x.kind === '待验证经验'));
  assert.equal((await web('/api/brain/note/decide', { id: r.id, ok: true })).status, 200);
  const tp = await practice('商品页'); assert.match(tp.rules, /规格无出处留空/); assert.equal(tp.version, v0 + 1);
  const mk = await tool(ownerKey, 'task_create', { title: '给 g-2026201 做商品页', category: '商品页', ref: 'g-2026201' });
  assert.match((await tool(bKey, 'task_get', { id: mk.task.id })).practice.text, /规格无出处留空/);
  assert.match((await tool(bKey, 'remember', { title: 'x', text: '后台密码: abcd1234', category: '其他' })).error, /密码/);
  /* 还没有模版的类别：批准时新建一条 */
  const r2 = await tool(bKey, 'remember', { title: '退货先看是不是不良', text: 'ジュエリー非不良不可退换，先问照片。', category: '退换货退款' }); await web('/api/brain/note/decide', { id: r2.id, ok: true });
  assert.match((await practice('退换货退款')).rules, /退货先看是不是不良/);
});
test('留言来回：负责人留言→派的人收到；管理员在页面回复→负责人下一句话前收到；做完派的人收到', async () => {
  assert.equal((await tool(bKey, 'task_comment', { id: tid, text: '照片在哪个文件夹？' })).ok, true);
  assert.ok((await state()).inbox.some(x => /照片在哪个文件夹/.test(x.text)));
  assert.equal((await web('/api/brain/task/comment', { id: tid, text: '在共享盘 mospace/第二批' })).status, 200);
  fs.writeFileSync(path.join(CHOME, 'state.json'), JSON.stringify({ sessions: {}, inboxAt: 0 }));
  assert.match(cli(['prompt']), /在共享盘 mospace/);
  assert.match((await tool(bKey, 'task_update', { id: tid, status: '完成' })).error, /要写 result/);   /* 做完必须写结果 */
  const fin = await tool(bKey, 'task_update', { id: tid, status: '完成', result: '回读一致' }); assert.equal(fin.ok, true); assert.match(fin.next, /待你检查/);
  assert.equal((await state()).tasks.find(t => t.id === tid).status, '等确认'); assert.ok(!(await state()).inbox.some(x => /标为完成/.test(x.text)));   /* Claude 说做完≠完成 */
  assert.equal((await meDo(bKey, { id: tid, action: 'ok' })).status, 200);
  assert.ok((await state()).inbox.some(x => /标为完成/.test(x.text)));
  assert.equal((await web('/api/brain/inbox/read', {})).status, 200); assert.equal((await state()).inbox.length, 0);
});
test('流程链：采购单做完自动建商品页任务并派给分工表上的人；小结里没做完的成任务', async () => {
  const po = await tool(ownerKey, 'task_create', { title: '建 mospace 第二批采购单', category: '采购单' });
  await tool(ownerKey, 'task_update', { id: po.task.id, status: '完成', result: 'PO-2026-012 已建，回读一致', refs: ['g-2026101'] });
  assert.ok(!(await state()).tasks.some(t => t.ruleKey === 'chain:商品页:g-2026101'), '本人还没检查，不该先派下一步');
  await meDo(ownerKey, { id: po.task.id, action: 'ok' });
  const nx = (await state()).tasks.find(t => t.ruleKey === 'chain:商品页:g-2026101'); assert.ok(nx); assert.equal(nx.assigneeName, '同事B'); assert.match(nx.title, /g-2026101/);
  const dg = await tool(bKey, 'daily_digest', { done: ['g-2026200 商品页起草'], learned: [{ title: '同梱物照供应商清单', text: '同梱物只写供应商清单里有的。', category: '商品页' }], unfinished: [{ title: 'g-2026200 等照片', category: '商品页' }] });
  assert.equal(dg.saved.pending, 1); assert.equal(dg.saved.notes.length, 1); assert.ok(!(await state()).tasks.some(t => t.title === 'g-2026200 等照片'), '没做完的不直接变任务');
  { const r0 = await fetch(U + '/me/state', { headers: { authorization: 'Bearer ' + bKey } }); assert.ok((await r0.json()).pending.includes('g-2026200 等照片')); }
});
test('取代与复查：新经验取代旧的，旧的作废并从模版里拿掉；到复查日自动建任务', async () => {
  const a = await tool(bKey, 'remember', { title: '主图用浅灰底', text: '主图背景用浅灰。', category: '商品页' }); await web('/api/brain/note/decide', { id: a.id, ok: true });
  const b = await tool(bKey, 'remember', { title: '主图统一白底', text: '主图背景统一白底。', category: '商品页', supersedes: a.id, recheck_days: 90 }); await web('/api/brain/note/decide', { id: b.id, ok: true });
  const tp = await practice('商品页'); assert.match(tp.rules, /主图统一白底/); assert.doesNotMatch(tp.rules, /主图用浅灰底/);
  const st = await state(); assert.equal(st.notes.find(x => x.id === a.id).status, '作废'); assert.match(st.notes.find(x => x.id === b.id).recheckBy, /^\d{4}-\d{2}-\d{2}$/);
  await web('/api/brain/note/decide', { id: b.id, only: 'recheck', recheckBy: '2026-01-01' }); assert.equal((await web('/api/brain/scan', {})).status, 200);
  assert.ok((await state()).tasks.some(t => t.title.startsWith(`复查经验 ${b.id}`)));
});
test('文件存档：从电脑存到工作台、挂到任务、按编号取回；页面能下载；无关的人取不到', async () => {
  const f = path.join(TMP, '报价单 第二批.txt'); fs.writeFileSync(f, 'NeoBlade x6 @ 88 CNY');
  const out = cli(['put', f, '--task', tid, '--note', 'mospace 第二批报价']); const id = /F-\d{4}/.exec(out)[0];
  const list = await tool(bKey, 'file_list', { task_id: tid }); assert.equal(list.count, 1); assert.equal(list.files[0].note, 'mospace 第二批报价');
  const dest = path.join(TMP, 'back.txt'); cli(['get', id, dest]); assert.equal(fs.readFileSync(dest, 'utf8'), 'NeoBlade x6 @ 88 CNY');
  assert.equal(await (await fetch(`${U}/api/brain/file?id=${id}&t=${TOKEN}`)).text(), 'NeoBlade x6 @ 88 CNY');
  const c = (await web('/api/brain/person/add', { name: '同事C' })).json; assert.equal((await fetch(`${U}/files/${id}`, { headers: { authorization: 'Bearer ' + c.key } })).status, 404);
});
test('自动小结：对话结束时把记录整理成小结交上来；学到的进待批准，没做完的下次开工时提醒；不会套娃', async () => {
  const tr = path.join(TMP, 't.jsonl'); const row = (type, text) => JSON.stringify({ type, message: { role: type, content: [{ type: 'text', text }] } });
  fs.writeFileSync(tr, [row('user', '帮我按报价单建 mospace 第二批的采购单，报价单在桌面。' + '细节'.repeat(120)), row('assistant', '已读报价单，共 6 件。' + '说明'.repeat(120)), row('user', '可以，建吧。汇率按 21.5。'), row('assistant', 'PO-2026-012 建好了，回读一致。')].join('\n'));
  assert.equal(cli(['end'], { DADI_BRAIN_HOOK: '1' }, JSON.stringify({ session_id: 's1', transcript_path: tr })).trim(), '');   /* 钩子里再触发的不处理 */
  cli(['summarize', tr, 's1', '/tmp'], { DADI_CLAUDE_BIN: FAKE });
  const st = await state(); const d = st.digests.find(x => x.auto && x.session === 's1');
  assert.ok(d); assert.equal(d.done.length, 1); assert.equal(d.pending.length, 1); assert.equal(d.learned.length, 1);
  assert.equal(st.notes.find(x => x.id === d.learned[0]).status, '待验证');
  { const r0 = await fetch(U + '/me/state', { headers: { authorization: 'Bearer ' + bKey } }); assert.ok((await r0.json()).pending.some(x => /等供应商照片/.test(x))); }   /* 没做完的：在清单上等本人定 */
  { const o = await hookGet(bKey, '/hook/start'); assert.match(o, /另有 \d+ 条待定的/); assert.doesNotMatch(o, /等供应商照片/); }   /* 开场只报条数，不当任务念 */
  cli(['summarize', tr, 's1', '/tmp'], { DADI_CLAUDE_BIN: FAKE });   /* 同一段没新内容：不重复交 */
  assert.equal((await state()).digests.filter(x => x.session === 's1').length, 1);
});
test('心跳和时间：钩子报一声就算在线；连续的算工作时间；线下的活自己报', async () => {
  cli(['beat', 'prompt', 's9', '/tmp/shop']); await new Promise(r => setTimeout(r, 300));
  assert.match(Object.values((await beatsOf(bId)).days)[0].e, /^s?p$/);   /* 开对话 s、说话 p 各记一次种类 */
  let v = (await state()).team.find(x => x.id === bId); assert.equal(v.status, 'on'); assert.equal(v.where, 'shop'); assert.ok(v.time.today >= 1);
  assert.equal((await tool(bKey, 'work_log', { minutes: 60, what: '打包 mospace 第二批' })).ok, true);
  v = (await state()).team.find(x => x.id === bId); assert.equal(v.time.offline, 60); assert.ok(v.time.today >= 61); assert.equal(v.care.activeDays, 1);
  assert.equal(v.tasks.open >= 1, true); assert.ok(Array.isArray(v.solved) && Array.isArray(v.unsolved));
});
test('定时提醒：自己定；到点进通知箱并在电脑上弹出；不能替别人定；所有者能在页面给别人定和取消', async () => {
  const r = await tool(bKey, 'remind', { at: new Date().toISOString(), text: '给 g-2026200 的供应商回信' }); assert.equal(r.ok, true);
  assert.match((await tool(bKey, 'remind', { to: 'Souki', at: '23:59', text: 'x' })).error, /只能给自己/);
  assert.match((await tool(bKey, 'remind', { at: '25 点', text: 'x' })).error, /时间写成/);
  cli(['tick'], { DADI_BRAIN_HOME: CHOME }); assert.match(fs.readFileSync(path.join(CHOME, 'notify.log'), 'utf8'), /提醒：给 g-2026200 的供应商回信/);
  fs.writeFileSync(path.join(CHOME, 'state.json'), JSON.stringify({ sessions: {}, inboxAt: 0, syncAt: Date.now() })); assert.match(cli(['prompt']), /提醒：给 g-2026200/);
  const p = await web('/api/brain/remind/add', { to: bId, at: '23:58', text: 'T-0001 发货前拍照' }); assert.equal(p.status, 200); assert.equal(p.json.to, '同事B');
  let st = await state(); const rem = st.reminders.find(x => x.text === 'T-0001 发货前拍照'); assert.ok(rem); assert.match(await hookGet(bKey, '/hook/start'), /今天定好的提醒[\s\S]*23:58 T-0001 发货前拍照/);
  assert.equal((await web('/api/brain/remind/cancel', { id: rem.id })).status, 200); assert.ok(!(await state()).reminders.some(x => x.id === rem.id));
});
test('电脑备份：记忆・规则・技能和指定的工作文件夹自动传；凭证和钥匙不传；只传有变化的；旧版留一份', async () => {
  const pj = path.join(CCONF, 'projects', enc(OLDHOME) + '-Desktop', 'memory'); fs.mkdirSync(pj, { recursive: true }); fs.mkdirSync(path.join(CCONF, 'skills', 'ship'), { recursive: true });
  fs.writeFileSync(path.join(CCONF, 'CLAUDE.md'), '# 规则\n后台正文一律日文'); fs.writeFileSync(path.join(pj, 'MEMORY.md'), '- [发货口径](ship.md)'); fs.writeFileSync(path.join(pj, 'ship.md'), '佐川，货到 306 自己打包'); fs.writeFileSync(path.join(CCONF, 'skills', 'ship', 'SKILL.md'), '发货技能');
  fs.writeFileSync(path.join(CCONF, '.credentials.json'), '{"token":"sk-ant-xxxx"}'); fs.writeFileSync(path.join(pj, '..', 's1.jsonl'), '{"type":"user"}');
  const st0 = JSON.parse(fs.readFileSync(path.join(CCONF, 'settings.json'), 'utf8')); st0.env = { ANTHROPIC_API_KEY: 'sk-ant-secret-123' }; fs.writeFileSync(path.join(CCONF, 'settings.json'), JSON.stringify(st0));
  const work = path.join(TMP, '商品素材'); fs.mkdirSync(path.join(work, 'node_modules', 'x'), { recursive: true }); fs.writeFileSync(path.join(work, '报价.txt'), 'NeoBlade 88'); fs.writeFileSync(path.join(work, '.env'), 'KEY=1'); fs.writeFileSync(path.join(work, 'node_modules', 'x', 'i.js'), '1'); fs.writeFileSync(path.join(work, 'api-token.txt'), 'x');
  assert.match(cli(['folder', 'add', work]), /商品素材/);
  assert.match(cli(['sync']), /这次传了 6 个/);   /* CLAUDE.md・settings・MEMORY・ship・SKILL・报价 */
  const list = await (await fetch(U + '/backup/list', { headers: { authorization: 'Bearer ' + bKey } })).json(); const names = list.files.map(f => f.path);
  assert.ok(names.includes('claude/CLAUDE.md') && names.includes(`claude/projects/${enc(OLDHOME)}-Desktop/memory/ship.md`) && names.includes('claude/skills/ship/SKILL.md') && names.includes('work-商品素材/报价.txt'));
  assert.ok(!names.some(n => /credential|\.env|node_modules|jsonl|token/.test(n)), names.join(','));
  const set = await (await fetch(U + '/backup/file?path=' + encodeURIComponent('claude/settings.json'), { headers: { authorization: 'Bearer ' + bKey } })).text(); assert.ok(!set.includes('sk-ant-secret')); assert.match(set, /已隐藏/); assert.match(set, /brain-hook/);
  assert.match(cli(['sync']), /这次传了 0 个/);
  fs.writeFileSync(path.join(pj, 'ship.md'), '佐川，货到 306 自己打包；箱内不放 LINE 卡'); assert.match(cli(['sync']), /这次传了 1 个/);
  const day = new Date(), ymd = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  assert.equal(fs.readFileSync(path.join(DATA, 'brain', 'backup', bId, 'history', ymd, 'claude', 'projects', enc(OLDHOME) + '-Desktop', 'memory', 'ship.md'), 'utf8'), '佐川，货到 306 自己打包');
  const v = (await state()).team.find(x => x.id === bId); assert.equal(v.backup.files, 6); assert.ok(v.backup.at); assert.equal(v.backup.roots.claude, 5);
  assert.equal((await fetch(U + '/backup/file?root=claude&path=' + encodeURIComponent('../../x'), { method: 'POST', headers: { authorization: 'Bearer ' + bKey }, body: 'x' })).status, 400);
  /* 后台定时那一条路：到时间了 tick 自己备份 */
  fs.writeFileSync(path.join(work, '新图.txt'), 'x'); fs.writeFileSync(path.join(CHOME, 'state.json'), JSON.stringify({ sessions: {}, inboxAt: 0, syncAt: 0 })); cli(['tick']);
  assert.ok((await (await fetch(U + '/backup/list', { headers: { authorization: 'Bearer ' + bKey } })).json()).files.some(f => f.path === 'work-商品素材/新图.txt'));
});
test('恢复：新电脑一条命令取回，记忆放回 Claude 里（用户名不同也对得上）；别人的备份只有所有者能取', async () => {
  const NEWCONF = path.join(TMP, 'newclaude'); fs.mkdirSync(NEWCONF, { recursive: true }); fs.writeFileSync(path.join(NEWCONF, 'CLAUDE.md'), '新电脑自己的规则');
  const out = cli(['restore', '--apply'], { HOME: NEWHOME, CLAUDE_CONFIG_DIR: NEWCONF }); assert.match(out, /取回 7 个文件/); assert.match(out, /1 个这台电脑上已经有，没有覆盖/);
  assert.equal(fs.readFileSync(path.join(NEWCONF, 'projects', enc(NEWHOME) + '-Desktop', 'memory', 'ship.md'), 'utf8'), '佐川，货到 306 自己打包；箱内不放 LINE 卡');
  assert.equal(fs.readFileSync(path.join(NEWCONF, 'CLAUDE.md'), 'utf8'), '新电脑自己的规则'); assert.ok(fs.existsSync(path.join(NEWCONF, 'settings.restored.json'))); assert.ok(!fs.existsSync(path.join(NEWCONF, 'settings.json')));
  assert.ok(fs.readdirSync(path.join(NEWHOME, 'dadi-restore')).length === 1);
  const OH = path.join(TMP, 'owner-home'); fs.mkdirSync(OH, { recursive: true }); fs.copyFileSync(path.join(CHOME, 'brain-hook.mjs'), path.join(OH, 'brain-hook.mjs')); fs.writeFileSync(path.join(OH, 'config.json'), JSON.stringify({ url: U, key: ownerKey }));
  assert.match(cli(['restore', '--person', '同事B', '--to', path.join(TMP, 'takeover')], { DADI_BRAIN_HOME: OH }), /取回 7 个文件/); assert.ok(fs.existsSync(path.join(TMP, 'takeover', 'work-商品素材', '报价.txt')));
  const c = (await web('/api/brain/person/add', { name: '同事D' })).json; assert.equal((await fetch(U + '/backup/list?person=' + encodeURIComponent('同事B'), { headers: { authorization: 'Bearer ' + c.key } })).status, 403);
  /* 交接：所有者让同事D 接手同事B 的工作 → D 能取 B 的备份；取消后又取不到 */
  assert.equal((await web('/api/brain/person/update', { id: c.id, takeover: [bId] })).status, 200);
  assert.equal((await (await fetch(U + '/backup/list?person=' + encodeURIComponent('同事B'), { headers: { authorization: 'Bearer ' + c.key } })).json()).files.length, 7);
  assert.equal((await fetch(U + '/backup/file?person=' + bId + '&path=' + encodeURIComponent('work-商品素材/报价.txt'), { headers: { authorization: 'Bearer ' + c.key } })).status, 200);
  assert.equal((await fetch(U + '/backup/list?person=Souki', { headers: { authorization: 'Bearer ' + c.key } })).status, 403);
  await web('/api/brain/person/update', { id: c.id, takeover: [] }); assert.equal((await fetch(U + '/backup/list?person=' + bId, { headers: { authorization: 'Bearer ' + c.key } })).status, 403);
  /* 主机上的上限：超了拒收 */
  const big = await fetch(U + '/backup/file?root=claude&path=big.bin', { method: 'POST', headers: { authorization: 'Bearer ' + bKey }, body: Buffer.alloc(250000) }); assert.equal(big.status, 400); assert.match((await big.json()).error, /上限/);
  assert.equal((await web('/api/brain/backup?person=' + bId)).json.files.length, 7);
});
test('派活智能体：读全员数据，给人建任务、定提醒、写简报；不能改后台；同一件事不重复建', async () => {
  assert.equal((await web('/api/brain/dispatch/save', { enabled: false, times: '9:05，13:00 abc', model: 'haiku' })).status, 200);
  let st = await state(); assert.deepEqual(st.dispatch.times, ['09:05', '13:00']); assert.equal(st.dispatch.enabled, false); assert.ok(!st.people.some(p => p.role === 'agent'));
  assert.equal((await web('/api/brain/dispatch/run', {})).status, 200);
  st = await until(async () => { const x = await state(); return x.dispatch.last && !x.dispatch.running ? x : null; }, 20000); assert.ok(st, '没排完');
  assert.equal(st.dispatch.last.ok, true, st.dispatch.last.text); assert.equal(st.dispatch.last.tasks, 1); assert.equal(st.dispatch.last.reminders, 1); assert.match(st.dispatch.last.text, /派活智能体不能用这个工具/);
  const t = st.tasks.find(x => x.title === '跟进 g-2026200 的供应商照片'); assert.equal(t.source, '智能体'); assert.equal(t.assigneeName, '同事B'); assert.match(st.brief.text, /同事B：今天跟进/);
  assert.ok(st.reminders.some(r => r.toName === '同事B' && /照片到了没有/.test(r.text))); assert.ok(st.inbox.some(x => /今日简报/.test(x.text)));
  await web('/api/brain/dispatch/run', {}); await new Promise(r => setTimeout(r, 400));
  st = await until(async () => { const x = await state(); return !x.dispatch.running && x.dispatch.log.length >= 2 ? x : null; }, 20000); assert.equal(st.dispatch.last.tasks, 0); assert.match(st.dispatch.last.text, /没有重复建/);
  assert.match((await tool(bKey, 'team_overview')).error, /只有所有者和派活智能体/);
});
test('审查修复：文件被删后再取不崩；提醒时间校验；只读人物不能替别人定提醒；两段对话的「没做完」都留着', async () => {
  const f = path.join(TMP, 'gone.txt'); fs.writeFileSync(f, 'x'); const id = /F-\d{4}/.exec(cli(['put', f]))[0];
  const rel = JSON.parse(fs.readFileSync(path.join(DATA, 'brain', 'files.json'), 'utf8')).find(x => x.id === id).rel; fs.rmSync(path.join(DATA, 'brain', 'files', rel));
  assert.equal((await fetch(`${U}/files/${id}`, { headers: { authorization: 'Bearer ' + bKey } })).status, 404);
  assert.equal((await fetch(`${U}/api/brain/file?id=${id}&t=${TOKEN}`)).status, 404);
  assert.equal((await web('/api/brain/state')).status, 200);   /* 服务还活着 */
  for (const at of ['25:00', '9:75', '2026-11-31 15:00', '2026-11-11', 'tomorrow']) assert.match((await tool(bKey, 'remind', { at, text: 'x' })).error, /时间写成/, at);
  await web('/api/role', { key: 'kisou' });
  assert.equal((await web('/api/brain/remind/add', { to: bId, at: '23:57', text: 'x' })).status, 403);
  assert.equal((await web('/api/brain/remind/add', { at: '23:57', text: '只读也能给自己定' })).status, 200);
  await web('/api/role', { key: 'boss' });
  const dg = (session, pending) => fetch(U + '/hook/digest', { method: 'POST', headers: { authorization: 'Bearer ' + bKey, 'content-type': 'application/json' }, body: JSON.stringify({ session, carry: true, done: ['x'], unfinished: pending }) });   /* carry＝小助手把上一份没做完的给模型看过 */
  await dg('A', ['A 那段没做完']); await dg('B', ['B 那段没做完']); await dg('B', []);
  const st = JSON.stringify((await (await fetch(U + '/me/state', { headers: { authorization: 'Bearer ' + bKey } })).json()).pending); assert.match(st, /A 那段没做完/); assert.doesNotMatch(st, /B 那段没做完/);
});
test('审查修复：备份内容里像钥匙的一段打码；Claude 连续干活时后台报心跳；智能体一次最多建 8 个任务', async () => {
  const pj = path.join(CCONF, 'projects', enc(OLDHOME) + '-Desktop', 'memory');
  fs.writeFileSync(path.join(pj, 'api.md'), '后台：Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789\nAnthropic sk-ant-api03-ABCDEFGHIJKLMNOP\n普通内容照常');
  cli(['sync']);
  const txt = await (await fetch(U + '/backup/file?path=' + encodeURIComponent(`claude/projects/${enc(OLDHOME)}-Desktop/memory/api.md`), { headers: { authorization: 'Bearer ' + bKey } })).text();
  assert.doesNotMatch(txt, /abcdefghijklmnop|sk-ant-api03-ABC/); assert.match(txt, /（已隐藏）/); assert.match(txt, /普通内容照常/);
  const live = path.join(CCONF, 'projects', '-tmp-shop'); fs.mkdirSync(live, { recursive: true }); fs.writeFileSync(path.join(live, 's.jsonl'), '{}');
  const wb = path.join(CCONF, 'projects', '-x-dadi-workbench-box'); fs.mkdirSync(wb, { recursive: true });
  fs.writeFileSync(path.join(CHOME, 'state.json'), JSON.stringify({ sessions: {}, inboxAt: 0, syncAt: Date.now() })); cli(['tick']); await new Promise(r => setTimeout(r, 300));
  assert.ok(await until(async () => /w/.test(Object.values((await beatsOf(bId)).days)[0].e), 9000), '后台没报「在干活」');
  const ak = fs.readFileSync(path.join(DATA, 'brain', 'agent.key'), 'utf8').trim(); let capped = 0;
  for (let i = 0; i < 9; i++) { const r = await tool(ak, 'task_create', { title: `上限测试 ${i}`, category: '其他' }); if (/上限/.test(r.error || '')) capped++; }
  assert.ok(capped >= 1, '智能体建任务没有上限');
});
test('守门：成员默认不能改后台；有权限也过硬规则（不许删商品）；账号接口封死；成员停用后钥匙失效；都留记录', async () => {
  assert.match((await tool(bKey, 'admin_write', { method: 'PUT', path: '/admin/products/abc', body: {} })).data.message, /没有改后台的权限/);
  const del = await tool(ownerKey, 'admin_write', { method: 'DELETE', path: '/admin/products/abc' }); assert.equal(del.http, 403); assert.match(del.data.message, /硬规则/);
  assert.equal((await tool(ownerKey, 'admin_get', { path: '/admin/auth/me' })).http, 403);
  assert.equal((await web('/api/brain/person/update', { id: bId, disabled: true })).status, 200);
  assert.equal((await rpc(bKey, 'tools/list')).status, 401);
  const audit = (await web('/api/brain/audit')).json.items; assert.ok(audit.some(a => a.what === '批准经验')); assert.ok(audit.some(a => a.what === '硬规则拦下'));
});

/* ═════ v27 第 1 步：三段开场・桌面提示器・发送资料・离线补交・一键交接 ═════ */
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const hm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const tickJson = async key => (await fetch(U + '/hook/tick', { headers: { authorization: 'Bearer ' + key } })).json();
const resetState = () => fs.writeFileSync(path.join(CHOME, 'state.json'), JSON.stringify({ sessions: {}, inboxAt: 0, syncAt: Date.now() }));
const readState = () => JSON.parse(fs.readFileSync(path.join(CHOME, 'state.json'), 'utf8'));
test('v27 开场三段：昨天做完／今天要做／还差；早晚简报；弹窗时间按人定，tick 到点弹一次、错过补弹、过了下班只弹晚上那条', async () => {
  assert.equal((await web('/api/brain/person/update', { id: bId, disabled: false })).status, 200);   /* 上一条把他停用了，恢复 */
  const st = await hookGet(bKey, '/hook/start');
  assert.match(st, /昨天没有工作记录|昨天做完 \d+ 件|上次（/); assert.match(st, /今天要做 \d+ 件|今天名下没有任务/); assert.match(st, /还差/); assert.match(st, /规矩/);
  const m = await hookGet(bKey, '/hook/brief?part=morning'); assert.match(m, /今天要做|今天名下/); assert.doesNotMatch(m, /规矩/);
  const e = await hookGet(bKey, '/hook/brief?part=evening'); assert.match(e, /今天做完 \d+ 件|今天还没有做完/); assert.match(e, /还差|没有还差/);
  assert.match((await tool(bKey, 'brain_start')).brief, /还差/);
  assert.deepEqual((await tickJson(bKey)).prompt, { on: true, morning: '09:00', evening: '18:00' });
  assert.equal((await web('/api/brain/person/update', { id: bId, prompt: { on: true, morning: '08:30', evening: '19:00' } })).status, 200);
  assert.equal((await web('/api/brain/person/update', { id: bId, prompt: { morning: '8点' } })).status, 400);
  assert.equal((await tickJson(bKey)).prompt.evening, '19:00');
  assert.match(cli(['brief']), /今天要做|今天名下/);
  assert.match(cli(['popup', 'morning']), /早上好[\s\S]*还差/);   /* 测试里不弹真窗，只打印 */
  assert.match(cli(['popup', 'evening']), /收尾[\s\S]*发送资料/);
  const past = hm(new Date(Date.now() - 60000)), later = hm(new Date(Date.now() + 3600000));
  await web('/api/brain/person/update', { id: bId, prompt: { on: true, morning: past, evening: later } }); resetState(); cli(['tick']);
  let s = readState(); assert.equal(s.morningDay, today()); assert.ok(!s.eveningDay); assert.equal(s.prompt.morning, past);
  cli(['tick']); assert.equal(readState().morningDay, today());   /* 一天只弹一次 */
  await web('/api/brain/person/update', { id: bId, prompt: { on: true, morning: past, evening: past } }); resetState(); cli(['tick']);
  s = readState(); assert.ok(!s.morningDay); assert.equal(s.eveningDay, today());
  await web('/api/brain/person/update', { id: bId, prompt: { on: false, morning: past, evening: past } }); resetState(); cli(['tick']);
  s = readState(); assert.ok(!s.morningDay && !s.eveningDay);   /* 关了就不弹 */
  await web('/api/brain/person/update', { id: bId, prompt: { on: true, morning: '09:00', evening: '18:00' } });
});
test('v27 发送资料：整理今天的对话→备份→存当天的交接报告；同一天再发是覆盖；同事卡上看得到', async () => {
  const pdir = path.join(CCONF, 'projects', enc(OLDHOME) + '-Desktop'); fs.mkdirSync(pdir, { recursive: true });
  const row = (type, text) => JSON.stringify({ type, message: { role: type, content: [{ type: 'text', text }] } });
  fs.writeFileSync(path.join(pdir, 'send1.jsonl'), [row('user', '把 mospace 第二批的采购单建好。' + '细节'.repeat(120)), row('assistant', '读了报价单。' + '说明'.repeat(120)), row('user', '建吧'), row('assistant', 'PO-2026-012 建好了')].join('\n'));
  resetState();
  const out = cli(['send'], { DADI_CLAUDE_BIN: FAKE }); assert.match(out, /已收到：交接报告 1 份/); assert.match(out, /小结 1 份/);
  let st = await state(); let rp = st.reports.filter(r => r.by === bId); assert.equal(rp.length, 1); assert.ok(rp[0].done.some(x => /PO-2026-012/.test(x))); assert.equal(rp[0].date, today());
  const v = st.team.find(x => x.id === bId); assert.equal(v.report.done, rp[0].done.length); assert.equal(readState().eveningDay, today());
  assert.match(cli(['send'], { DADI_CLAUDE_BIN: FAKE }), /小结 0 份/);   /* 同一段没新内容不再整理 */
  st = await state(); rp = st.reports.filter(r => r.by === bId); assert.equal(rp.length, 1);
  assert.match(cli(['status']), /今天的资料已发送/);
  /* claude 命令行没登录：小结整理不成要说清楚，不能装作没事 */
  fs.writeFileSync(path.join(pdir, 'send2.jsonl'), [row('user', '另一段没登录时的对话。' + '细节'.repeat(120)), row('assistant', '好。' + '说明'.repeat(120)), row('user', '继续'), row('assistant', '做完了')].join('\n'));
  const bad = cli(['send'], { DADI_CLAUDE_BIN: FAKE, FAKE_AUTH_FAIL: '1' }); assert.match(bad, /没整理成小结[\s\S]*claude auth login/);
  assert.match(cli(['status']), /上次小结没整理成[\s\S]*claude auth login/);
  assert.match(cli(['send'], { DADI_CLAUDE_BIN: FAKE }), /小结 1 份/);   /* 登录后再跑就补上 */
  assert.match(await hookGet(bKey, '/hook/brief?part=evening'), /今天做完 \d+ 件[\s\S]*PO-2026-012/);
});
test('v27 离线补交：连不上主机时小结存在 outbox，连上后 tick 补交；一键交接：任务和提醒整体转给接手的人，他能取回前任的备份', async () => {
  const H2 = path.join(TMP, 'dadi-home2'); fs.mkdirSync(H2, { recursive: true }); fs.copyFileSync(path.join(CHOME, 'brain-hook.mjs'), path.join(H2, 'brain-hook.mjs'));
  const cfg = url => fs.writeFileSync(path.join(H2, 'config.json'), JSON.stringify({ url, key: bKey, digest: 'auto', sync: 'off' }));
  cfg('http://127.0.0.1:9');
  const row = (type, text) => JSON.stringify({ type, message: { role: type, content: [{ type: 'text', text }] } });
  const tr = path.join(TMP, 'off.jsonl'); fs.writeFileSync(tr, [row('user', '没网的时候做的事。' + '细节'.repeat(120)), row('assistant', '好。' + '说明'.repeat(120)), row('user', '继续'), row('assistant', '做完了')].join('\n'));
  cli(['summarize', tr, 'off1', '/tmp'], { DADI_BRAIN_HOME: H2, DADI_CLAUDE_BIN: FAKE });
  assert.equal(fs.readdirSync(path.join(H2, 'outbox')).length, 1); assert.ok(!(await state()).digests.some(x => x.session === 'off1'));
  cfg(U); cli(['tick'], { DADI_BRAIN_HOME: H2 });
  assert.equal(fs.readdirSync(path.join(H2, 'outbox')).length, 0); assert.ok((await state()).digests.some(x => x.session === 'off1'));
  const c = await web('/api/brain/person/add', { name: '同事C' }); const cId = c.json.id;
  assert.equal((await tool(bKey, 'remind', { at: '23:57', text: '交接前定的提醒' })).ok, true);
  const open = t => ['待做', '进行中', '等确认'].includes(t.status);
  await tool(ownerKey, 'task_create', { title: '交接前同事B名下的一件事', category: '其他', assignee: '同事B' });   /* 前面停用过他：名下的已经按分工表转走了 */
  const before = (await state()).tasks.filter(t => t.assignee === bId && open(t)).length; assert.ok(before >= 1);
  assert.equal((await web('/api/brain/person/handover', { from: bId, to: bId })).status, 400);
  const r = await web('/api/brain/person/handover', { from: bId, to: cId }); assert.equal(r.status, 200); assert.equal(r.json.tasks, before); assert.ok(r.json.reminders >= 1);
  const st = await state(); assert.equal(st.tasks.filter(t => t.assignee === bId && open(t)).length, 0); assert.equal(st.tasks.filter(t => t.assignee === cId && open(t)).length, before);
  assert.ok(st.people.find(p => p.id === cId).takeover.includes(bId)); assert.ok(st.reminders.every(x => x.to !== bId));
  assert.match(await hookGet(c.json.key, '/hook/start'), /交接给你/);
  assert.equal((await (await fetch(U + '/backup/list?person=' + bId, { headers: { authorization: 'Bearer ' + c.json.key } })).json()).person, '同事B');   /* 接手的人能取前任的备份 */
});

/* ═════ v28 闭环一：任务 产生→看到→做→结束（三种信号）→历史 ═════ */
const meGet = async key => { const r = await fetch(U + '/me/state', { headers: { authorization: 'Bearer ' + key } }); return { status: r.status, json: await r.json().catch(() => null) }; };
const mePost = async (key, p, body) => { const r = await fetch(U + p, { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, json: await r.json().catch(() => null) }; };
const ITEMS = path.join(TMP, 'items.json'); const setItems = l => fs.writeFileSync(ITEMS, JSON.stringify(l)); const scanNow = async () => (await web('/api/brain/scan', {})).json;
test('v28 看到与打勾：清单页不带数据；数据要钥匙；打勾进「已完成」留历史，能取消；别人的任务动不了；小结里没做完的能记成任务或不用', async () => {
  const page = await fetch(U + '/me'); assert.equal(page.status, 200); const html = await page.text(); assert.match(html, /我的今天/); assert.doesNotMatch(html, /T-\d{4}/);
  assert.equal((await meGet('wrong')).status, 401);
  const mk = await tool(ownerKey, 'task_create', { title: '清单打勾测试', category: '税务行政' }); const id = mk.task.id;
  let st = (await meGet(ownerKey)).json; assert.ok(st.open.some(t => t.id === id)); assert.equal(st.open.find(t => t.id === id).dept, '运营'); assert.equal(st.counts.open, st.open.length);
  assert.equal((await mePost(bKey, '/me/task', { id, action: 'done', result: 'x' })).status, 404);   /* 不在他名下 */
  let r = await mePost(ownerKey, '/me/task', { id, action: 'done', result: '给税理士打了电话，确认了' }); assert.equal(r.status, 200); assert.match(r.json.state.done[0].items.find(t => t.id === id).result, /税理士/);
  assert.ok(!r.json.state.open.some(t => t.id === id)); assert.equal(r.json.state.done[0].date, today()); assert.ok(r.json.state.done[0].items.some(t => t.id === id));
  assert.equal((await state()).tasks.find(t => t.id === id).status, '完成');
  r = await mePost(ownerKey, '/me/task', { id, action: 'undo' }); assert.ok(r.json.state.open.some(t => t.id === id)); assert.equal((await state()).tasks.find(t => t.id === id).reopened || 0, 0);   /* 自己点错不算被退回 */
  await mePost(ownerKey, '/me/task', { id, action: 'done', result: '再确认一次' });
  /* 小结里没做完的两条：一条记成任务，一条不用了；之后都不再出现 */
  const dg = await fetch(U + '/hook/digest', { method: 'POST', headers: { authorization: 'Bearer ' + ownerKey, 'content-type': 'application/json' }, body: JSON.stringify({ session: 'me1', done: ['x'], unfinished: ['给佐川打电话问运单', '想一下要不要换包装'] }) }); assert.equal(dg.status, 200);
  st = (await meGet(ownerKey)).json; assert.ok(st.pending.includes('给佐川打电话问运单'));
  r = await mePost(ownerKey, '/me/pending', { text: '给佐川打电话问运单', action: 'task' }); assert.match(r.json.task, /^T-/); assert.ok(r.json.state.open.some(t => t.title === '给佐川打电话问运单'));
  r = await mePost(ownerKey, '/me/pending', { text: '想一下要不要换包装', action: 'drop' }); assert.ok(!r.json.state.pending.includes('想一下要不要换包装')); assert.ok(!r.json.state.pending.includes('给佐川打电话问运单'));
  assert.equal((await mePost(ownerKey, '/me/pending', { text: '没有这条', action: 'drop' })).status, 404);
  assert.ok(fs.existsSync(path.join(CHOME, 'DadiMenu.app', 'Contents', 'MacOS', 'DadiMenu')), '安装器应该把菜单栏小程序装到小助手文件夹里');
});
test('v28 数据核实：打了勾但后台还有→重新打开并通知本人；后台没有了→自动结束；库存预警点过「知道了」情况没变不再提；同一条规则不重复开任务', async () => {
  const ship = { id: 'svc:ship', level: '急', name: '订单发货', text: '待发货超时 2 单（待发货共 3）' }, pg = { id: 'page:g-2026300', level: '今天', name: '商品页', text: 'g-2026300 测试：有库存 1 件，商品页还没做（没有图）' }, low = { id: 'svc:low', level: '提前', name: '库存', text: '库存预警 1 款：A 剩 1' };
  setItems([ship, pg, low]); await scanNow(); await scanNow();
  let ts = (await state()).tasks; const T = base => ts.filter(t => (t.ruleKey || '').startsWith(base));
  assert.equal(T('svc:ship').length, 1); assert.equal(T('page:g-2026300').length, 1); assert.equal(T('svc:low').length, 1);   /* 扫两次只开一张 */
  const sid = T('svc:ship')[0].id, pid = T('page:g-2026300')[0].id, lid = T('svc:low')[0].id, who = k => (k === bId ? bKey : ownerKey);
  /* ① 打了勾但后台还有 → 重新打开 */
  await mePost(who(T('svc:ship')[0].assignee), '/me/task', { id: sid, action: 'done', result: '两单都发了' });
  assert.equal((await state()).tasks.find(t => t.id === sid).verify, 'pending');
  setItems([{ ...ship, text: '待发货超时 1 单（待发货共 1）' }, pg, low]); await scanNow();
  let t = (await state()).tasks.find(x => x.id === sid); assert.equal(t.status, '待做'); assert.equal(t.reopened, 1); assert.match(t.title, /超时 1 单/);
  const mine = (await meGet(who(t.assignee))).json; assert.match(mine.open.find(x => x.id === sid).back, /还没做完/);
  assert.ok((await state()).inbox.some(x => /标了完成，但后台显示还没做完/.test(x.text)) || t.assignee !== 'souki');
  /* ② 后台没有了 → 没打勾的自动结束；打过勾的变「已核实」 */
  await mePost(who(T('page:g-2026300')[0].assignee), '/me/task', { id: pid, action: 'done', result: '商品页做好了' });
  assert.ok(!(await state()).tasks.some(x => x.ruleKey === 'chain:訳文:g-2026300'), '还没核实，不该先派下一步');
  setItems([low]); await scanNow(); ts = (await state()).tasks;
  t = ts.find(x => x.id === sid); assert.equal(t.status, '完成'); assert.equal(t.verify, 'ok'); assert.equal(t.result, '两单都发了', '自动结束不盖掉本人写的结果'); assert.ok(t.log.some(l => /数据核实：后台里这件事已经没有了/.test(l.text)));
  assert.equal(ts.find(x => x.id === pid).verify, 'ok'); assert.equal(ts.find(x => x.id === pid).status, '完成'); assert.ok(ts.some(x => x.ruleKey === 'chain:訳文:g-2026300'), '核实过了才派下一步');
  const hist = (await meGet(who(t.assignee))).json.done[0].items.find(x => x.id === sid); assert.equal(hist.auto, true);
  /* ③ 库存预警：点「知道了」→ 情况没变不再开；情况变了才再开 */
  await mePost(who(T('svc:low')[0].assignee), '/me/task', { id: lid, action: 'done' }); await scanNow();
  assert.equal((await state()).tasks.filter(x => (x.ruleKey || '').startsWith('svc:low')).length, 1);
  setItems([{ ...low, text: '库存预警 2 款：A 剩 1；B 剩 2' }]); await scanNow();
  assert.equal((await state()).tasks.filter(x => (x.ruleKey || '').startsWith('svc:low')).length, 2);
  assert.match((await state()).tasks.find(x => (x.ruleKey || '').startsWith('svc:low') && x.status !== '完成').title, /^库存预警 1 款（新出现的）：B 剩 2$/);   /* 点过「知道了」的 A 不再提，只提新出现的 B */
  /* ④ 后台读不到的时候什么都不动 */
  const lid2 = (await state()).tasks.find(x => (x.ruleKey || '').startsWith('svc:low') && x.status !== '完成').id;
  setItems([{ id: 'login', text: '后台没有登录' }]); await scanNow(); assert.notEqual((await state()).tasks.find(x => x.id === lid2).status, '完成');
  /* ⑤ 那条规则的模版停用了（这次没查那一类）：不能当成「后台已经没有了」 */
  setItems([pg, low]); await scanNow(); const pid2 = (await state()).tasks.find(x => x.ruleKey === 'page:g-2026300' && x.status === '待做').id;
  fs.writeFileSync(path.join(TMP, 'checks.json'), JSON.stringify(['service'])); setItems([low]); await scanNow();
  assert.equal((await state()).tasks.find(x => x.id === pid2).status, '待做', '商品页规则没跑，不该自动结束');
  fs.rmSync(path.join(TMP, 'checks.json'), { force: true }); await scanNow(); assert.equal((await state()).tasks.find(x => x.id === pid2).status, '完成');
  fs.rmSync(ITEMS, { force: true });
});

/* ═════ v29 五条：待你检查・转交・做完并入对话・报告先看再发・没做完去重 ═════ */
test('v29 待你检查：Claude 做完进「待检查」带结果；没问题→完成并记一次通过；不对→带原因退回、成为等批准的经验、开场里看得到', async () => {
  assert.equal((await web('/api/brain/person/update', { id: bId, disabled: false })).status, 200);
  const a = (await tool(ownerKey, 'task_create', { title: '给 g-2026400 写卖点', category: '商品页', assignee: '同事B' })).task.id;
  await tool(bKey, 'task_update', { id: a, status: '完成', result: '写了 5 条卖点，回读后台一致' });
  let st = (await meGet(bKey)).json; const rv = st.review.find(t => t.id === a); assert.ok(rv); assert.match(rv.result, /5 条卖点/); assert.ok(!st.open.some(t => t.id === a)); assert.equal(st.counts.review, st.review.length);
  assert.match(await hookGet(bKey, '/hook/start'), /待你检查/);
  assert.equal((await mePost(bKey, '/me/task', { id: a, action: 'reject' })).status, 400);   /* 不对要写一句 */
  const n0 = (await state()).notes.length;
  let r = await mePost(bKey, '/me/task', { id: a, action: 'reject', reason: '卖点里写了他社商标，去掉' }); assert.equal(r.status, 200);
  let t = (await state()).tasks.find(x => x.id === a); assert.equal(t.status, '进行中'); assert.equal(t.rejects, 1); assert.equal(t.passFirst, false);
  st = (await state()); assert.equal(st.notes.length, n0 + 1); assert.match(st.notes[0].text, /他社商标/); assert.equal(st.notes[0].status, '待验证'); assert.equal(st.notes[0].taskId, a);
  assert.match((await meGet(bKey)).json.open.find(x => x.id === a).why, /他社商标/); assert.match(await hookGet(bKey, '/hook/start'), /检查没通过[\s\S]*他社商标/);
  assert.match(JSON.stringify((await tool(bKey, 'task_get', { id: a })).task.log), /检查不通过：卖点里写了他社商标/);   /* Claude 重做时拿得到原因 */
  await tool(bKey, 'task_update', { id: a, status: '完成', result: '已去掉商标，回读一致' }); await mePost(bKey, '/me/task', { id: a, action: 'ok' });
  t = (await state()).tasks.find(x => x.id === a); assert.equal(t.status, '完成'); assert.equal(t.passFirst, false);
  const b2 = (await tool(ownerKey, 'task_create', { title: '给 g-2026401 写卖点', category: '商品页', assignee: '同事B' })).task.id;
  await tool(bKey, 'task_update', { id: b2, status: '完成', result: '写好了' }); await mePost(bKey, '/me/task', { id: b2, action: 'ok' });
  assert.equal((await state()).tasks.find(x => x.id === b2).passFirst, true);   /* 一次通过 */
  assert.equal((await meGet(bKey)).json.done[0].items.find(x => x.id === b2).checked, true);
});
test('v29 转交：清单上和对 Claude 说都能转；要写原因；对方收到通知并看得到谁转来、为什么；别人的、做完的不能转', async () => {
  const c = await web('/api/brain/person/add', { name: '同事D' }); const dKey = c.json.key, dId = c.json.id;
  const a = (await tool(ownerKey, 'task_create', { title: '回复 mospace 的报价', category: '渠道内容', assignee: '同事B' })).task.id;
  assert.ok((await meGet(bKey)).json.people.some(p => p.id === dId));
  assert.equal((await mePost(bKey, '/me/task', { id: a, action: 'transfer', to: dId })).status, 400);   /* 没写原因 */
  assert.equal((await mePost(dKey, '/me/task', { id: a, action: 'transfer', to: bId, reason: 'x' })).status, 404);   /* 不是自己的 */
  let r = await mePost(bKey, '/me/task', { id: a, action: 'transfer', to: dId, reason: '我明天休息，报价在共享盘' }); assert.equal(r.status, 200); assert.ok(!r.json.state.open.some(t => t.id === a));
  let mine = (await meGet(dKey)).json.open.find(t => t.id === a); assert.equal(mine.from.by, '同事B'); assert.match(mine.from.reason, /明天休息/);
  assert.match(await hookGet(dKey, '/hook/start'), /转给你[\s\S]*明天休息/);
  assert.match((await tool(dKey, 'task_update', { id: a, assignee: '同事B' })).error, /原因/);
  assert.equal((await tool(dKey, 'task_update', { id: a, assignee: '同事B', note: '这个报价我不熟，还是你来' })).ok, true);   /* 对 Claude 说转回去 */
  const t = (await state()).tasks.find(x => x.id === a); assert.equal(t.assignee, bId); assert.equal(t.transfers, 2);
  await mePost(bKey, '/me/task', { id: a, action: 'done', result: '回了' }); assert.equal((await mePost(bKey, '/me/task', { id: a, action: 'transfer', to: dId, reason: 'x' })).status, 400);
});
test('v29 做完并入对话・报告先看再发・没做完去重：清单的「今天做完」算上对话小结；报告草稿能去掉几条、补一句再发，能翻以前的；没做完的同一件只出现一次，能全部不用', async () => {
  const dg = body => fetch(U + '/hook/digest', { method: 'POST', headers: { authorization: 'Bearer ' + ownerKey, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const before = (await meGet(ownerKey)).json.counts.doneToday;
  await dg({ session: 'r1', done: ['回了三封顾客邮件', '改了 NeoBlade 的库存数'], unfinished: ['确认佐川的集货时间，周五前', '问税理士輸入消費税'] });
  await dg({ session: 'r2', done: ['拍了 M4 的开箱视频'], unfinished: ['确认佐川的集货时间（周五之前要定）', '补 M4 的规格表'] });
  let st = (await meGet(ownerKey)).json; assert.equal(st.counts.doneToday, before + 3); assert.ok(st.done[0].talk.some(x => x.text === '拍了 M4 的开箱视频'));
  assert.equal(st.pending.filter(x => /确认佐川的集货时间/.test(x)).length, 1);   /* 两段对话里的同一件：只出现一次 */
  let rp = (await (await fetch(U + '/me/report', { headers: { authorization: 'Bearer ' + ownerKey } })).json()); assert.ok(rp.draft.done.includes('回了三封顾客邮件')); assert.ok(rp.draft.pending.some(x => /问税理士/.test(x)));
  const r = await mePost(ownerKey, '/me/report', { note: '明天上午不在，密码: abcd1234', drop: ['改了 NeoBlade 的库存数'], client: { sent: 2, up: 3, files: ['claude/CLAUDE.md'] } });
  assert.equal(r.status, 200); assert.ok(!r.json.report.done.includes('改了 NeoBlade 的库存数')); assert.ok(r.json.report.done.includes('回了三封顾客邮件')); assert.match(r.json.report.note, /明天上午不在/); assert.doesNotMatch(r.json.report.note, /abcd1234/); assert.equal(r.json.report.client.up, 3);
  rp = (await (await fetch(U + '/me/report', { headers: { authorization: 'Bearer ' + ownerKey } })).json()); assert.equal(rp.sent.date, today()); assert.ok(rp.history.length >= 1); assert.ok(r.json.state.report);
  const brp = await (await fetch(U + '/me/report', { headers: { authorization: 'Bearer ' + bKey } })).json(); assert.ok(!JSON.stringify(brp).includes('明天上午不在'));   /* 别人的看不到 */
  const dr = await mePost(ownerKey, '/me/pending', { action: 'dropall' }); assert.ok(dr.json.dropped >= 3); assert.equal(dr.json.state.pending.length, 0);
  await dg({ session: 'r3', done: ['x'], unfinished: ['确认佐川的集货时间，周五前', '新的一件没做完的事'] });   /* 点过不用了的，后面的小结再提也不出现 */
  st = (await meGet(ownerKey)).json; assert.deepEqual(st.pending, ['新的一件没做完的事']);
  assert.match(cli(['send', '--prepare', '--json'], { DADI_CLAUDE_BIN: FAKE }), /"up":\d+/);   /* 小助手：只整理不发 */
});

/* ═════ v30 精简对话：随交接报告一起发 ═════ */
test('v30 精简对话：整理时只在本机做好（今天的・只有文字・密码遮掉）；本人确认才上传，可以逐段不发；随报告存；本人・所有者・管理员能看，别的同事不能；能撤回', async () => {
  const pdir = path.join(CCONF, 'projects', enc(OLDHOME) + '-Desktop'); fs.mkdirSync(pdir, { recursive: true });
  const now = new Date().toISOString(), yest = new Date(Date.now() - 30 * 3600e3).toISOString();
  const L = (type, content, ts = now, extra = {}) => JSON.stringify({ type, timestamp: ts, cwd: '/tmp/shop', message: { role: type, content }, ...extra });
  fs.writeFileSync(path.join(pdir, 'talkA.jsonl'), [
    L('user', '昨天说的话不该出现', yest),
    L('user', '把 NeoBlade 的库存改成 8，钥匙是 sk-ant-abcdefgh12345678'),
    L('assistant', [{ type: 'thinking', thinking: '内部思考不该出现' }, { type: 'text', text: '好，我先读后台现状。' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'cat secret-file' } }]),
    L('user', [{ type: 'tool_result', tool_use_id: 't1', content: '文件内容不该出现 9999 行' }]),
    L('user', '<system-reminder>系统提示不该出现</system-reminder>'),
    L('assistant', [{ type: 'text', text: '改好了，回读是 8。' }]),
    L('user', '不对，应该是 6，我说错了'),
  ].join('\n'));
  fs.writeFileSync(path.join(pdir, 'talkB.jsonl'), [L('user', '私下问一件别的事，这段我不想发，内容要够长一点才会被列出来所以多写几个字多写几个字多写几个字'), L('assistant', [{ type: 'text', text: '好的。' + '补充说明'.repeat(60) }])].join('\n'));
  const prep = JSON.parse(cli(['send', '--prepare', '--json'], { DADI_CLAUDE_BIN: FAKE }).trim().split('\n').pop());
  const A = prep.talks.find(t => t.session === 'talkA'), Bk = prep.talks.find(t => t.session === 'talkB'); assert.ok(A && Bk); assert.equal(A.turns, 2); assert.match(A.title, /NeoBlade/);
  assert.ok(fs.existsSync(path.join(CHOME, 'talks', today(), 'talkA.json')));
  const mine = async () => (await (await fetch(U + '/me/report', { headers: { authorization: 'Bearer ' + bKey } })).json());
  assert.ok(!(await mine()).draft.talks.some(t => t.session === 'talkA'), '只是整理，还没确认，不该已经在主机上');
  const up = JSON.parse(cli(['talks', '--skip', 'talkB', '--json']).trim().split('\n').pop()); assert.ok(up.sent.some(t => t.session === 'talkA')); assert.ok(!up.sent.some(t => t.session === 'talkB')); assert.equal(up.skipped, 1);
  const get = async (key, q) => { const r = await fetch(U + '/me/talk?' + q, { headers: { authorization: 'Bearer ' + key } }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const t = (await get(bKey, `date=${today()}&session=talkA`)).json.text;
  assert.match(t, /【我 \d\d:\d\d】把 NeoBlade 的库存改成 8/); assert.match(t, /【Claude \d\d:\d\d】改好了，回读是 8/); assert.match(t, /不对，应该是 6/);
  for (const bad of ['昨天说的话', '内部思考', '文件内容不该出现', '系统提示', 'cat secret-file', 'sk-ant-abcdefgh']) assert.ok(!t.includes(bad), bad); assert.match(t, /已隐藏/);
  assert.equal((await get(bKey, `date=${today()}&session=talkB`)).status, 404);   /* 点了不发的没上来 */
  assert.equal(typeof (await mine()).draft.digests, 'number');
  const r = await mePost(bKey, '/me/report', { note: '', drop: [], client: prep }); assert.ok(r.json.report.talks.some(x => x.session === 'talkA')); assert.equal(typeof r.json.report.sessions, 'number'); assert.ok((await mine()).sent.talks.length >= 1);
  assert.equal((await get(ownerKey, `person=${bId}&date=${today()}&session=talkA`)).status, 200);   /* 所有者能看 */
  const d2 = await web('/api/brain/person/add', { name: '同事E' }); assert.equal((await get(d2.json.key, `person=${bId}&date=${today()}&session=talkA`)).status, 404);   /* 别的同事不能 */
  assert.equal((await web(`/api/brain/talk?person=${bId}&date=${today()}&session=talkA`)).status, 200); assert.ok((await state()).team.find(x => x.id === bId).reports[0].talks.some(x => x.session === 'talkA'));
  assert.ok((await web('/api/brain/audit')).json.items.some(a => a.what === '看对话'));   /* 谁看过留记录 */
  const drop = await mePost(bKey, '/me/talk', { action: 'drop', date: today(), session: 'talkA' }); assert.equal(drop.status, 200);
  assert.equal((await get(bKey, `date=${today()}&session=talkA`)).status, 404); assert.ok(!(await mine()).sent.talks.some(x => x.session === 'talkA'));
  assert.ok(!fs.existsSync(path.join(DATA, 'brain', 'talks', bId, today(), 'talkA.txt')));
});

/* ═════ v31 第二大脑：任务候选・网站缺口・一周回顾・每周改进清单・在 Claude 里批规则・资料没交上来 ═════ */
test('v31 任务候选和网站缺口：小结里挑出来的「要做的事」进本人清单，接了才变任务（能派给别人），不用就不再提；网站缺口同一件事计数', async () => {
  const dg = (key, body) => fetch(U + '/hook/digest', { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const body = { session: 'c1', done: ['y'], todo: [{ title: '给佐川改周五的集货时间', who: '我' }, { title: '让同事B确认 M4 的规格表', who: '同事B', due: '2026-11-20', category: '商品页' }], gaps: ['后台不能批量改库存'] };
  await dg(ownerKey, body); let st = (await meGet(ownerKey)).json; assert.equal(st.cands.length, 2);
  const toB = st.cands.find(c => /M4/.test(c.title)), mine = st.cands.find(c => /佐川/.test(c.title)); assert.equal(toB.to, '同事B'); assert.equal(toB.due, '2026-11-20'); assert.equal(mine.to, '');
  assert.ok(!(await state()).tasks.some(t => /M4 的规格表/.test(t.title)), '没点「接」之前不是任务');
  let r = await mePost(ownerKey, '/me/cand', { id: toB.id, action: 'take' }); assert.match(r.json.task, /^T-/);
  const t = (await state()).tasks.find(x => x.id === r.json.task); assert.equal(t.assigneeName, '同事B'); assert.equal(t.source, '对话'); assert.equal(t.due, '2026-11-20');
  r = await mePost(ownerKey, '/me/cand', { id: mine.id, action: 'drop' }); assert.equal(r.json.state.cands.length, 0);
  assert.equal((await mePost(bKey, '/me/cand', { id: mine.id, action: 'take' })).status, 404);
  await dg(ownerKey, { ...body, session: 'c2' }); assert.equal((await meGet(ownerKey)).json.cands.length, 0);   /* 接过、说过不用的：两周内不再提 */
  let gs = (await state()).gaps.filter(g => /批量改库存/.test(g.text)); assert.equal(gs.length, 1); assert.equal(gs[0].count, 2);
  const g2 = await tool(bKey, 'site_gap', { text: '后台不能批量改库存，只能一个个点' }); assert.equal(g2.id, gs[0].id); assert.equal(g2.count, 3);
  assert.equal((await web('/api/brain/gap/update', { id: gs[0].id, status: '已交黄兄' })).status, 200); assert.equal((await state()).gaps.find(g => g.id === gs[0].id).status, '已交黄兄');
  /* 小助手这条路：整理小结时带上候选和缺口 */
  const row = (type, text) => JSON.stringify({ type, message: { role: type, content: [{ type: 'text', text }] } });
  const tr = path.join(TMP, 'cand.jsonl'); fs.writeFileSync(tr, [row('user', '周五前要把 NeoSander 的图补上。' + '细节'.repeat(120)), row('assistant', '好。' + '说明'.repeat(120)), row('user', '先这样'), row('assistant', '记下了')].join('\n'));
  cli(['summarize', tr, 'cand1', '/tmp'], { DADI_CLAUDE_BIN: FAKE, FAKE_TODO: JSON.stringify([{ title: '周五前把 NeoSander 的图补上', who: '我' }]), FAKE_GAPS: JSON.stringify(['相册不能一次传多张']) });
  assert.ok((await meGet(bKey)).json.cands.some(c => /NeoSander 的图/.test(c.title))); assert.ok((await state()).gaps.some(g => /一次传多张/.test(g.text)));
});
test('v31 回顾与改进：本人看自己一周的数（一次通过率・被退回的原因）；所有者做每周改进清单，每条有去向，下周能看到结果；在 Claude 里批规则；别人不能用', async () => {
  const w = await tool(bKey, 'my_week'); assert.ok(w.做完的任务 >= 2); assert.match(w.一次通过率, /%（\d+ 件检查过）/); assert.ok(w.被退回的.some(x => x.原因.some(y => /他社商标/.test(y)))); assert.ok(w.按类别['商品页'].检查过 >= 2); assert.match(w.按类别['商品页'].一次通过率, /%$/);
  assert.match((await tool(bKey, 'weekly_review')).error, /只有所有者/); assert.match((await tool(bKey, 'note_decide', { id: 'N-0001', ok: true })).error, /只有所有者/);
  const rv = await tool(ownerKey, 'weekly_review'); assert.ok(rv.全员.做完的任务 >= w.做完的任务); assert.ok(rv.每个人.some(x => x.人 === '同事B')); assert.ok(Array.isArray(rv.规则没起作用)); assert.ok(rv.网站缺口.length >= 1); assert.equal(rv.上一周的改进清单, null);
  const n0 = (await state()).notes.filter(n => n.status === '待验证').length;
  const sv = await tool(ownerKey, 'weekly_save', { items: [
    { text: '商品页卖点被退回 2 次，补一条「不写他社商标」的检查', why: '本周商品页检查过 3 件，1 件被退回', fate: '规则', category: '商品页', detail: '卖点、说明文里不出现他社商标；游戏机写「Switch 2 対応」' },
    { text: '给同事B讲一遍相册顺序', fate: '任务', assignee: '同事B', category: '商品页' },
    { text: '后台加批量改库存', fate: '网站' }, { text: '周三逾期多', why: '周三休息，正常', fate: '不处理' }, { text: '没有去向的不收' }] });
  assert.equal(sv.ok, true); assert.equal(sv.items.length, 4); assert.match(sv.items[1].ref, /^T-/); assert.match(sv.items[0].ref, /^N-/); assert.match(sv.items[2].ref, /^W-/);
  let st = await state(); assert.equal(st.weekly[0].条目.length, 4); assert.equal(st.tasks.find(t => t.id === sv.items[1].ref).assigneeName, '同事B'); assert.equal(st.notes.filter(n => n.status === '待验证').length, n0 + 1);
  assert.equal((await tool(ownerKey, 'weekly_review')).这一周已经写过.条目.length, 4);
  /* 在 Claude 里批规则 */
  const pend = await tool(ownerKey, 'notes_pending'); assert.ok(pend.count >= 1); const nid = sv.items[0].ref; assert.ok(pend.notes.some(n => n.id === nid));
  const dec = await tool(ownerKey, 'note_decide', { id: nid, ok: true }); assert.equal(dec.status, '已采用'); assert.match((await practice('商品页')).rules || '', /不写他社商标|不出现他社商标/);
  assert.match((await tool(ownerKey, 'note_decide', { id: nid, ok: false })).error, /已经是/);
  assert.equal((await tool(ownerKey, 'weekly_review')).这一周已经写过.条目[0].现在, '已采用');   /* 去向的结果跟着变 */
  /* 规则批了以后：又因为同一件事被退回才算「没起作用」；别的原因、取消的任务不算 */
  const mk = async (title, why) => { const id = (await tool(ownerKey, 'task_create', { title, category: '商品页', assignee: '同事B' })).task.id; await tool(bKey, 'task_update', { id, status: '完成', result: '写好了' }); await mePost(bKey, '/me/task', { id, action: 'reject', reason: why }); return id; };
  const hit = await mk('给 g-2026402 写卖点', '卖点里又出现了他社商标，要去掉'), miss = await mk('给 g-2026403 写卖点', '价格写错了一位数');
  const nw = (await tool(ownerKey, 'weekly_review')).规则没起作用; const mine2 = nw.find(x => x.规则.startsWith(nid)); assert.ok(mine2, JSON.stringify(nw)); assert.ok(mine2.之后又因为同一件事被退回.some(x => x.startsWith(hit))); assert.ok(!JSON.stringify(nw).includes(miss));
  /* 自动小结提出的经验：和已有的说的是一回事就不再加 */
  const before = (await state()).notes.length, t1 = (await state()).notes.find(n => n.id === nid).title;
  await fetch(U + '/hook/digest', { method: 'POST', headers: { authorization: 'Bearer ' + bKey, 'content-type': 'application/json' }, body: JSON.stringify({ session: 'dup1', done: ['z'], learned: [{ title: t1, text: '同一件事再说一遍', category: '商品页' }, { title: '全新的一条：佐川周六不集货', text: '周六下单的周一才取件', category: '订单发货' }] }) });
  assert.equal((await state()).notes.length, before + 1);
});
test('v31 资料没交上来：本机小结整理失败由小助手每分钟报上来，同事卡上看得到，修好自动消；安装时查 claude 命令行登没登录', async () => {
  const tick = q => fetch(U + '/hook/tick' + q, { headers: { authorization: 'Bearer ' + bKey } });
  await tick('?se=' + encodeURIComponent('Failed to authenticate: OAuth session expired'));
  let v = (await state()).team.find(x => x.id === bId); assert.ok(v.health.some(x => /本机整理小结失败/.test(x)));
  const hr = await web('/api/brain/health/run', {}); assert.ok(hr.json.items.some(x => x.人 === '同事B' && /claude auth login/.test(x.办法)));
  await tick(''); v = (await state()).team.find(x => x.id === bId); assert.ok(!v.health.some(x => /本机整理小结失败/.test(x)));
  assert.ok(typeof v.week.done === 'number' && /%|还没有/.test(v.week.pass));
  const out = execFileSync(process.execPath, [path.join(ROOT, 'client', 'install.mjs'), U, bKey], { env: { ...process.env, DADI_BRAIN_HOME: CHOME, CLAUDE_CONFIG_DIR: CCONF, DADI_CLAUDE_BIN: FAKE, FAKE_LOGGED_OUT: '1', DADI_NO_LAUNCHD: '1', DADI_LAUNCHD_DIR: path.join(TMP, 'agents') }, encoding: 'utf8' });
  assert.match(out, /【要处理】[\s\S]*claude auth login/);
});

/* ═════ v32 做完的事不再冒出来 ═════ */
test('v32 做完不再出现：同一个对象的下一步只派一次；小结里「没做完」的如果任务已经结束就自动不提；开场只列真正的任务、逾期不重复列', async () => {
  /* 同一款的商品页任务有两张（没图、还是 draft），两张先后做完：訳文只派一次，做完了也不再派 */
  const p1 = (await tool(ownerKey, 'task_create', { title: 'g-2026500 商品页没图', category: '商品页', ref: 'g-2026500' })).task.id, p2 = (await tool(ownerKey, 'task_create', { title: 'g-2026500 商品页还是 draft', category: '商品页', ref: 'g-2026500' })).task.id;
  const who = async id => ((await state()).tasks.find(t => t.id === id).assignee === bId ? bKey : ownerKey);
  await mePost(await who(p1), '/me/task', { id: p1, action: 'done', result: '图传好了' });
  const tr = () => state().then(s => s.tasks.filter(t => t.ruleKey === 'chain:訳文:g-2026500')); let l = await tr(); assert.equal(l.length, 1);
  await mePost(await who(l[0].id), '/me/task', { id: l[0].id, action: 'done', result: '7 语写好了' });
  await mePost(await who(p2), '/me/task', { id: p2, action: 'done', result: '公开了' });
  l = await tr(); assert.equal(l.length, 1, '訳文已经做完，不该再派一次'); assert.equal(l[0].status, '完成');
  /* 小结里说「T-xxxx 还没处理」，那个任务后来做完了 → 自动不提；和刚做完的任务说的是一回事 → 也不提 */
  const a = (await tool(ownerKey, 'task_create', { title: '给佐川打电话改周五的集货时间', category: '订单发货', assignee: 'Souki' })).task.id;
  await fetch(U + '/hook/digest', { method: 'POST', headers: { authorization: 'Bearer ' + ownerKey, 'content-type': 'application/json' }, body: JSON.stringify({ session: 'st1', done: ['q'], unfinished: [`${a} 还在清单里，对话中没有处理`, '给佐川打电话改周五的集货时间还没打', '另一件真的没做完的事要留着'] }) });
  assert.equal((await meGet(ownerKey)).json.pending.filter(x => /还在清单里|佐川打电话|真的没做完/.test(x)).length, 2, '「给佐川打电话…」已经是一张开着的任务，不再列');
  await mePost(ownerKey, '/me/task', { id: a, action: 'done', result: '打了，改到周六' });
  const pd = (await meGet(ownerKey)).json.pending; assert.ok(!pd.some(x => /还在清单里|佐川打电话/.test(x)), JSON.stringify(pd)); assert.ok(pd.some(x => /真的没做完/.test(x)));
  /* 开场：逾期的只在「今天要做」里出现一次；待定的只报条数 */
  const od = (await tool(ownerKey, 'task_create', { title: '逾期测试任务甲', category: '其他', assignee: 'Souki', due: '2026-01-01' })).task.id;
  const o = await hookGet(ownerKey, '/hook/start'); assert.equal(o.split(od).length - 1, 1, '同一个任务在开场里只出现一次'); assert.match(o, /其中逾期 \d+ 件/); assert.doesNotMatch(o, /真的没做完/); assert.match(o, /另有 \d+ 条待定的/);
});
test('v32 打勾不用写字；规则派的任务能设「不用再提」，以后不再开，8850 上能恢复；库存预警回到点过的状态时那张自动结束', async () => {
  const a = (await tool(ownerKey, 'task_create', { title: '不写字也能做完', category: '其他', assignee: 'Souki' })).task.id;
  const r = await mePost(ownerKey, '/me/task', { id: a, action: 'done' }); assert.equal(r.status, 200); assert.equal((await state()).tasks.find(t => t.id === a).status, '完成');
  const dr = { id: 'draft:g-2026600', level: '提前', name: '商品页', text: 'g-2026600 测试：商品页是 draft，有库存 2 件还没公开' }, low = { id: 'svc:low', level: '提前', name: '库存', text: '库存预警 1 款：Z 剩 1' };
  setItems([dr, low]); await scanNow(); let ts = (await state()).tasks; const d1 = ts.find(t => t.ruleKey === 'draft:g-2026600'); assert.ok(d1);
  const key = d1.assignee === bId ? bKey : ownerKey; assert.equal((await meGet(key)).json.open.find(t => t.id === d1.id).rule, true);
  assert.equal((await mePost(ownerKey, '/me/task', { id: a, action: 'mute' })).status, 409); assert.equal((await state()).tasks.find(t => t.id === a).status, '完成');   /* 做完的：不动，并且明说 */
  assert.equal((await mePost(key, '/me/task', { id: d1.id, action: 'mute' })).status, 200); assert.equal((await state()).tasks.find(t => t.id === d1.id).status, '取消');
  await scanNow(); await scanNow(); assert.equal((await state()).tasks.filter(t => t.ruleKey === 'draft:g-2026600').length, 1, '点了不用再提，不该再开');
  assert.ok((await state()).muted.some(m => m.base === 'draft:g-2026600')); await web('/api/brain/mute/remove', { base: 'draft:g-2026600' }); await scanNow();
  assert.equal((await state()).tasks.filter(t => t.ruleKey === 'draft:g-2026600').length, 2);   /* 恢复后又会提 */
  /* 库存：Z 点了「知道了」→ 又多出 Y → 开一张只写 Y 的 → Y 没了，回到只有 Z → 那张自动结束，而且 Y 不算点过 */
  const lz = (await state()).tasks.find(t => (t.ruleKey || '').startsWith('svc:low') && /Z 剩 1/.test(t.title) && t.status !== '完成'); await mePost(lz.assignee === bId ? bKey : ownerKey, '/me/task', { id: lz.id, action: 'done' });
  setItems([{ ...low, text: '库存预警 2 款：Z 剩 1；Y 剩 2' }]); await scanNow(); let ly = (await state()).tasks.find(t => /新出现的）：Y 剩 2/.test(t.title)); assert.ok(ly); assert.equal(ly.status, '待做');
  setItems([low]); await scanNow(); ly = (await state()).tasks.find(t => t.id === ly.id); assert.equal(ly.status, '完成'); assert.match(ly.result, /自动结束/);
  setItems([{ ...low, text: '库存预警 2 款：Z 剩 1；Y 剩 2' }]); await scanNow(); assert.ok((await state()).tasks.some(t => /新出现的）：Y 剩 2/.test(t.title) && t.status === '待做'), 'Y 没被人点过「知道了」，再出现要再提');
  fs.rmSync(ITEMS, { force: true });
});

/* ═════ v33 任务状态不乱跳：反复扫、反复点、撞在一起，结果都一样 ═════ */
test('v33 状态稳定：扫多少次同一件事只有一张；待发货变超时还是同一张；做完的期限任务不再冒出来；打勾→重开只一次，再打勾就算数；自动结束不发通知；已结束的任务 Claude 改不回去；同名任务不重复建', async () => {
  const mon = today().slice(0, 7);
  const ship0 = { id: 'svc:ship0', level: '今天', name: '订单发货', text: '待发货 3 单' }, pg = { id: 'page:g-2026700', level: '今天', name: '商品页', text: 'g-2026700 测试：有库存 1 件，商品页还没做（没有图）' }, low = { id: 'svc:low', level: '提前', name: '库存', text: '库存预警 1 款：Q 剩 1' }, cal = { id: 'cal:消費税 納付:2026-12-31', level: '提前', name: '税务', text: '消費税 納付：还有 5 天（12 月 31 日）', due: '2026-12-31' }, me1 = { id: `me:${mon}`, level: '今天', name: '月结', text: '月末：mospace 寄售按本月实售出结算单' };
  const pre = new Set((await state()).tasks.map(t => t.id));   /* 前面的测试留下的任务不算 */
  const all = [ship0, pg, low, cal, me1]; const by = async base => (await state()).tasks.filter(t => !pre.has(t.id) && (t.ruleKey || '').replace(/^(svc:(?:ship|inq|ret))0/, '$1').startsWith(base));
  const inboxAll = () => JSON.parse(fs.readFileSync(path.join(DATA, 'brain', 'inbox.json'), 'utf8'));
  setItems(all); await Promise.all([scanNow(), scanNow(), scanNow(), scanNow(), scanNow()]);   /* 五次撞在一起 */
  for (const b of ['svc:ship', 'page:g-2026700', 'cal:消費税 納付:2026-12-31', `me:${mon}`]) assert.equal((await by(b)).filter(t => t.status !== '完成' && t.status !== '取消').length, 1, b + ' 应该只有一张开着');
  const n1 = inboxAll().length, c1 = (await state()).tasks.length; for (let i = 0; i < 4; i++) await scanNow();
  assert.equal((await state()).tasks.length, c1, '再扫四次不该多出任务'); assert.equal(inboxAll().length, n1, '再扫四次不该多出通知');
  /* 待发货 → 超时：还是同一张，标题和急缓跟着变，没有「自动结束＋新开」 */
  const shipId = (await by('svc:ship'))[0].id; setItems([{ id: 'svc:ship', level: '急', name: '订单发货', text: '待发货超时 1 单（待发货共 3）' }, pg, low, cal, me1]); await scanNow();
  let ship = await by('svc:ship'); assert.equal(ship.length, 1); assert.equal(ship[0].id, shipId); assert.equal(ship[0].status, '待做'); assert.match(ship[0].title, /超时 1 单/); assert.equal(ship[0].level, '急');
  /* 期限类（税务日历、月结）：打勾后再扫，不再冒出来；标题会跟着天数刷新 */
  const calT = (await by('cal:消費税 納付:2026-12-31'))[0], meT = (await by(`me:${mon}`))[0], keyOf = t => (t.assignee === bId ? bKey : ownerKey);
  setItems([{ id: 'svc:ship', level: '急', name: '订单发货', text: '待发货超时 1 单（待发货共 3）' }, pg, low, { ...cal, text: '消費税 納付：还有 4 天（12 月 31 日）' }, me1]); await scanNow();
  assert.match((await state()).tasks.find(t => t.id === calT.id).title, /还有 4 天/);
  await mePost(keyOf(calT), '/me/task', { id: calT.id, action: 'done' }); await mePost(keyOf(meT), '/me/task', { id: meT.id, action: 'done' });
  for (let i = 0; i < 3; i++) await scanNow();
  assert.equal((await by('cal:消費税 納付:2026-12-31')).length, 1, '做完的期限任务不该再开'); assert.equal((await by(`me:${mon}`)).length, 1);
  /* 打勾但后台还有：重开一次并通知一次；再打勾就按本人的算，今天不再开，也不再通知 */
  const reopenMsgs = () => inboxAll().filter(x => /标了完成，但后台显示还没做完/.test(x.text) && x.taskId === shipId).length;
  await mePost(keyOf(ship[0]), '/me/task', { id: shipId, action: 'done' }); await scanNow(); assert.equal((await state()).tasks.find(t => t.id === shipId).status, '待做'); assert.equal(reopenMsgs(), 1);
  await mePost(keyOf(ship[0]), '/me/task', { id: shipId, action: 'done' }); for (let i = 0; i < 3; i++) await scanNow();
  ship = await by('svc:ship'); assert.equal(ship.length, 1, '本人坚持做完后今天不该再开一张'); assert.equal(ship[0].status, '完成'); assert.equal(ship[0].verify, 'override'); assert.equal(reopenMsgs(), 1);
  /* 按对象的（商品页）：同样两次后算数，并且自动记成「不用再提」 */
  const pgT = (await by('page:g-2026700'))[0]; await mePost(keyOf(pgT), '/me/task', { id: pgT.id, action: 'done' }); await scanNow(); await mePost(keyOf(pgT), '/me/task', { id: pgT.id, action: 'done' }); for (let i = 0; i < 3; i++) await scanNow();
  assert.equal((await by('page:g-2026700')).length, 1); assert.equal((await by('page:g-2026700'))[0].status, '完成'); assert.ok((await state()).muted.some(m => m.base === 'page:g-2026700'));
  /* 自动结束不发「工作台核实 把…标为完成」的通知 */
  const before = inboxAll().length; const lowT = (await state()).tasks.find(t => (t.ruleKey || '').startsWith('svc:low') && t.status === '待做');   /* 可能是前面测试留下、这次被刷新的那张 */ setItems([cal, me1]); await scanNow();
  assert.equal((await state()).tasks.find(t => t.id === lowT.id).status, '完成'); assert.ok(!inboxAll().some(x => /工作台核实 把/.test(x.text))); assert.equal(inboxAll().length, before);
  /* 已经结束的任务：Claude 不能改回去，也不会重新进「待检查」 */
  const fin = (await tool(ownerKey, 'task_create', { title: '已经做完的任务不许改回去', category: '其他', assignee: 'Souki' })).task.id; await mePost(ownerKey, '/me/task', { id: fin, action: 'done' });
  assert.match((await tool(ownerKey, 'task_update', { id: fin, status: '完成', result: '又交一次' })).error, /已经完成/); assert.match((await tool(ownerKey, 'task_update', { id: fin, status: '进行中' })).error, /已经完成/);
  assert.equal((await state()).tasks.find(t => t.id === fin).status, '完成'); assert.equal((await state()).tasks.find(t => t.id === fin).reopened || 0, 0);
  /* 同一件事 Claude 说两遍「记个任务」：只有一张 */
  const d1 = await tool(ownerKey, 'task_create', { title: '给税理士发 10 月的领收书', category: '税务行政', assignee: 'Souki' }), d2 = await tool(ownerKey, 'task_create', { title: '给税理士发10月的领收书。', category: '税务行政', assignee: 'Souki' });
  assert.equal(d2.task.id, d1.task.id); assert.match(d2.note, /没有重复建/);
  const e1 = await tool(ownerKey, 'task_create', { title: '给 g-2026801 写卖点', category: '商品页', assignee: 'Souki' }), e2 = await tool(ownerKey, 'task_create', { title: '给 g-2026802 写卖点', category: '商品页', assignee: 'Souki' }); assert.notEqual(e1.task.id, e2.task.id, '款号不一样是两件事');
  fs.rmSync(ITEMS, { force: true });
});

/* ═════ v34 独立审查报的 15 条：每条一个复现场景 ═════ */
test('v34a 扫描：后台某一类没读到不当成「没有了」；取数时打的勾不多开一张；待检查的不被自动结束、结果不被盖；取消的不回来；每天都有的那几类不能整类关掉', async () => {
  const pre = new Set((await state()).tasks.map(t => t.id)), mine = async f => (await state()).tasks.filter(t => !pre.has(t.id) && f(t)), K = t => (t.assignee === bId ? bKey : ownerKey);
  const ship = { id: 'svc:ship', level: '急', name: '订单发货', text: '待发货超时 2 单（待发货共 2）' }, pA = { id: 'page:g-2026910', level: '今天', name: '商品页', text: 'g-2026910 测试：有库存 1 件，商品页还没做（没有图）' }, dB = { id: 'draft:g-2026911', level: '提前', name: '商品页', text: 'g-2026911 测试：商品页是 draft，有库存 1 件还没公开' };
  setItems([ship, pA, dB]); await scanNow(); const tA = (await mine(t => t.ruleKey === 'page:g-2026910'))[0], tB = (await mine(t => t.ruleKey === 'draft:g-2026911'))[0], tS = (await mine(t => (t.ruleKey || '').startsWith('svc:ship')))[0]; assert.ok(tA && tB && tS);
  /* ① 商品页那个接口这次没读到：商品页任务不动，不派訳文；发货照常核实 */
  setItems([{ id: 'page:nodata', level: '提前', text: '后台 stock-overview 读不到' }]); await scanNow(); let ts = (await state()).tasks;
  assert.equal(ts.find(t => t.id === tA.id).status, '待做', '没读到≠没有了'); assert.equal(ts.find(t => t.id === tB.id).status, '待做'); assert.ok(!ts.some(t => t.ruleKey === 'chain:訳文:g-2026910')); assert.equal(ts.find(t => t.id === tS.id).status, '完成');   /* 发货那一类读到了、确实没有了 */
  /* ③ 扫描正在等后台的时候打勾：不另开一张 */
  setItems([{ ...ship, text: '待发货超时 3 单（待发货共 3）' }, pA, dB]); await scanNow(); const s2 = (await mine(t => (t.ruleKey || '').startsWith('svc:ship') && t.status === '待做'))[0]; assert.ok(s2);
  fs.writeFileSync(path.join(TMP, 'slow.flag'), '1'); const running = scanNow(); await new Promise(r => setTimeout(r, 250)); await mePost(K(s2), '/me/task', { id: s2.id, action: 'done' }); await running; fs.rmSync(path.join(TMP, 'slow.flag'), { force: true });
  assert.equal((await mine(t => (t.ruleKey || '').startsWith('svc:ship') && t.status === '待做')).length, 0, '取数之后才打的勾：这一次不该另开一张'); assert.equal((await state()).tasks.find(t => t.id === s2.id).verify, 'pending');
  /* ④ Claude 交上来等检查：后台条件没了也不替人结束，结果还在；本人点了没问题才完成并派下一步 */
  await tool(K(tA), 'task_update', { id: tA.id, status: '完成', result: '传了 8 张图，回读一致' }); setItems([dB]); await scanNow();
  let a = (await state()).tasks.find(t => t.id === tA.id); assert.equal(a.status, '等确认'); assert.equal(a.result, '传了 8 张图，回读一致'); assert.ok((await meGet(K(tA))).json.review.some(t => t.id === tA.id));
  assert.equal((await mePost(K(tA), '/me/task', { id: tB.id, action: 'ok' })).status, 409);   /* 不是待检查的：明说，不装作成功 */
  await mePost(K(tA), '/me/task', { id: tA.id, action: 'ok' }); await scanNow(); a = (await state()).tasks.find(t => t.id === tA.id); assert.equal(a.status, '完成'); assert.equal(a.verify, 'ok'); assert.equal(a.result, '传了 8 张图，回读一致'); assert.ok((await state()).tasks.some(t => t.ruleKey === 'chain:訳文:g-2026910'));
  /* ⑤ 取消：按对象的规则任务取消＝不用再提；取消的訳文不再被派一次 */
  assert.equal((await web('/api/brain/task/update', { id: tB.id, status: '取消' })).status, 200); await scanNow(); await scanNow();
  assert.equal((await mine(t => t.ruleKey === 'draft:g-2026911')).length, 1); assert.ok((await state()).muted.some(m => m.base === 'draft:g-2026911'));
  const tr = (await state()).tasks.find(t => t.ruleKey === 'chain:訳文:g-2026910'); await web('/api/brain/task/update', { id: tr.id, status: '取消' });
  const again = (await tool(ownerKey, 'task_create', { title: 'g-2026910 商品页再改一次', category: '商品页', ref: 'g-2026910', assignee: 'Souki' })).task.id; await mePost(ownerKey, '/me/task', { id: again, action: 'done' });
  assert.equal((await state()).tasks.filter(t => t.ruleKey === 'chain:訳文:g-2026910').length, 1, '取消过的下一步不该再派');
  /* ⑦ 发货、咨询这类不能「不用再提」 */
  setItems([{ id: 'svc:inq0', level: '今天', name: '客服', text: '咨询未回 1 条' }]); await scanNow(); const q = (await mine(t => (t.ruleKey || '').startsWith('svc:inq') && t.status === '待做'))[0];
  assert.equal((await meGet(K(q))).json.open.find(t => t.id === q.id).rule, false); assert.equal((await mePost(K(q), '/me/task', { id: q.id, action: 'mute' })).status, 400); assert.ok(!(await state()).muted.some(m => /^svc:/.test(m.base)));
  /* ⑥ 本人坚持做完后：后台数字变了（来了新的）当天还会再提；不派下一步 */
  await mePost(K(q), '/me/task', { id: q.id, action: 'done' }); await scanNow(); await mePost(K(q), '/me/task', { id: q.id, action: 'done' }); await scanNow(); await scanNow();
  assert.equal((await mine(t => (t.ruleKey || '').startsWith('svc:inq') && t.status === '待做')).length, 0); assert.equal((await meGet(K(q))).json.done[0].items.find(t => t.id === q.id).override, true);
  setItems([{ id: 'svc:inq', level: '急', name: '客服', text: '咨询超时未回 2 条（未回共 5）' }]); await scanNow(); assert.equal((await mine(t => (t.ruleKey || '').startsWith('svc:inq') && t.status === '待做')).length, 1, '情况变了要再提');
  fs.rmSync(ITEMS, { force: true });
});
test('v34b 同一件事的判断；没做完的不丢也不重复；下一步不漏派；退回原因过了检查就清；通知不丢；提醒不乱响；指名派给休息的人；库存超过 4 款；交两次不翻倍', async () => {
  const mk = async (title, extra = {}) => (await tool(ownerKey, 'task_create', { title, category: '其他', assignee: 'Souki', ...extra })).task.id;
  /* ⑨ 同一个款号的两件不同的事是两张；短句不吞长句 */
  assert.notEqual(await mk('给 g-2026011 做商品页'), await mk('给 g-2026011 拍照')); assert.notEqual(await mk('PO-2026-008 付款'), await mk('PO-2026-008 入库')); assert.notEqual(await mk('给佐川打电话'), await mk('给佐川打电话问为什么上周的货少了一箱'));
  /* ⑧ 同一段对话第二份小结只看到后半段：老版小助手（不带 carry）交空的，前面没做完的不丢；带 carry 的整份换掉。已经是任务的不再列，点「记成任务」也不变两张 */
  const dg = body => fetch(U + '/hook/digest', { method: 'POST', headers: { authorization: 'Bearer ' + ownerKey, 'content-type': 'application/json' }, body: JSON.stringify(body) }), pend = async () => (await meGet(ownerKey)).json.pending;
  await mePost(ownerKey, '/me/pending', { action: 'dropall' });
  await dg({ session: 'k1', done: ['a1'], unfinished: ['等佐川回复新的集货时间'] }); await dg({ session: 'k1', done: ['a2'], unfinished: [] }); assert.ok((await pend()).some(x => /等佐川回复/.test(x)), '前半段没做完的不该消失');
  assert.deepEqual((await (await fetch(U + '/hook/pending?session=k1', { headers: { authorization: 'Bearer ' + ownerKey } })).json()).pending, ['等佐川回复新的集货时间']);
  await dg({ session: 'k1', carry: true, done: ['a3'], unfinished: [] }); assert.ok(!(await pend()).some(x => /等佐川回复/.test(x)), '模型看过上一份、判断做完了：换掉');
  const tid = await mk('给税理士回信说明 10 月的进项'); await dg({ session: 'k2', done: ['b1'], unfinished: ['给税理士回信说明 10 月的进项，还没回'] }); assert.ok(!(await pend()).some(x => /税理士回信/.test(x)), '已经是一张任务了');
  await dg({ session: 'k3', date: '2026-01-05', done: ['补交的那天做的事'], unfinished: [] }); assert.equal((await state()).digests.find(g => g.session === 'k3').date, '2026-01-05');   /* 补交的算对话那天 */
  /* ⑩ 没有款号时先打勾再取消，之后带款号做完：下一步照派 */
  const po = (await tool(ownerKey, 'task_create', { title: '建第三批采购单', category: '采购单', assignee: 'Souki' })).task.id; await mePost(ownerKey, '/me/task', { id: po, action: 'done' }); await mePost(ownerKey, '/me/task', { id: po, action: 'undo' });
  await tool(ownerKey, 'task_update', { id: po, status: '完成', result: 'PO 建好', refs: ['g-2026940'] }); await mePost(ownerKey, '/me/task', { id: po, action: 'ok' }); assert.ok((await state()).tasks.some(t => t.ruleKey === 'chain:商品页:g-2026940'), '带款号做完要派下一步');
  /* ⑪ 被退回→重做→没问题→取消打勾：旧的退回原因不再显示 */
  const rj = await mk('写一段主图说明'); await tool(ownerKey, 'task_update', { id: rj, status: '完成', result: 'v1' }); await mePost(ownerKey, '/me/task', { id: rj, action: 'reject', reason: '主图不是白底' });
  assert.match((await meGet(ownerKey)).json.open.find(t => t.id === rj).why, /白底/); await tool(ownerKey, 'task_update', { id: rj, status: '完成', result: 'v2' }); await mePost(ownerKey, '/me/task', { id: rj, action: 'ok' }); await mePost(ownerKey, '/me/task', { id: rj, action: 'undo' });
  assert.equal((await meGet(ownerKey)).json.open.find(t => t.id === rj).why, ''); assert.doesNotMatch(await hookGet(ownerKey, '/hook/start'), /主图不是白底/);
  /* ⑬ 指名派给今天休息的人：还是给他 */
  const off = await web('/api/brain/person/add', { name: '同事休' }); await web('/api/brain/person/update', { id: off.json.id, off: [today()] });
  assert.equal((await tool(ownerKey, 'task_create', { title: '休息的人回来再做的事', category: '其他', assignee: '同事休' })).task.assignee, '同事休');
  /* ⑫ 一下子来 12 条通知：一分钟弹 5 条、不丢；Claude 那边一次带 8 条、剩下的下次带。任务做完后挂在上面的提醒不响 */
  for (let i = 1; i <= 12; i++) await tool(ownerKey, 'task_create', { title: `批量通知测试第 ${i} 件`, category: '其他', assignee: '同事休' });
  const tk = async () => (await (await fetch(U + '/hook/tick', { headers: { authorization: 'Bearer ' + off.json.key } })).json()).notify.length; assert.equal(await tk(), 5); assert.equal(await tk(), 5); assert.ok((await tk()) >= 3); assert.equal(await tk(), 0);
  const o1 = await hookGet(off.json.key, '/hook/start'); assert.equal((o1.match(/^- 新任务/gm) || []).length, 8); assert.match(o1, /还有 \d+ 条/); const o2 = await hookGet(off.json.key, '/hook/inbox'); assert.ok((o2.match(/^- 新任务/gm) || []).length >= 5); assert.equal(await hookGet(off.json.key, '/hook/inbox'), '');
  const rm = await mk('挂提醒的任务'); const at = new Date(Date.now() + 1500); await web('/api/brain/remind/add', { to: 'souki', at: at.toISOString(), text: '到点看一下这个任务', taskId: rm }); await mePost(ownerKey, '/me/task', { id: rm, action: 'done' });
  await new Promise(r => setTimeout(r, 1900)); await fetch(U + '/hook/tick', { headers: { authorization: 'Bearer ' + ownerKey } }); assert.ok(!JSON.parse(fs.readFileSync(path.join(DATA, 'brain', 'inbox.json'), 'utf8')).some(x => /到点看一下这个任务/.test(x.text)), '任务做完了，提醒不该再响');
  /* ⑭ 库存 6 款：点「知道了」后 6 款都算点过；第 5、6 款不会被漏掉；数量变多不算新情况，变少才算 */
  const low6 = n => ({ id: 'svc:low', level: '提前', name: '库存', text: `库存预警 ${n.length} 款：${n.join('；')}` }), six = ['K1 剩 1', 'K2 剩 1', 'K3 剩 1', 'K4 剩 1', 'K5 剩 1', 'K6 剩 1'];
  setItems([low6(six)]); await scanNow(); let lt = (await state()).tasks.find(t => (t.ruleKey || '').startsWith('svc:low') && t.status === '待做'); assert.match(lt.title, /K4 剩 1 等$/); assert.match(lt.detail, /K6 剩 1/); assert.equal(lt.lowItems.length >= 6, true);
  await mePost(lt.assignee === bId ? bKey : ownerKey, '/me/task', { id: lt.id, action: 'done' }); setItems([low6(['K1 剩 1', 'K5 剩 3', 'K6 剩 1'])]); await scanNow(); assert.ok(!(await state()).tasks.some(t => (t.ruleKey || '').startsWith('svc:low') && t.status === '待做'), '都点过、K5 是变多：不该再提');
  setItems([low6(['K6 剩 0', 'K7 剩 2'])]); await scanNow(); lt = (await state()).tasks.find(t => (t.ruleKey || '').startsWith('svc:low') && t.status === '待做'); assert.match(lt.title, /2 款：K6 剩 0；K7 剩 2/);
  fs.rmSync(ITEMS, { force: true });
  /* ⑮ 同一周改进清单存两次、收工小结交两次：不翻倍；作废过的自动经验不再交回来 */
  const items = [{ text: '给新人讲一遍退货流程', fate: '任务', assignee: 'Souki' }, { text: '退货先拍照再拆箱', fate: '规则', category: '退换货退款', detail: '收到退货先拍外箱和面单' }, { text: '后台加退货原因的下拉', fate: '网站' }];
  const w1 = await tool(ownerKey, 'weekly_save', { items }), n1 = (await state()).notes.length, g1 = (await state()).gaps.find(g => /退货原因的下拉/.test(g.text)).count, t1 = (await state()).tasks.length;
  const w2 = await tool(ownerKey, 'weekly_save', { items: [...items, { text: '周三不排发货', fate: '不处理' }] }); assert.equal(w2.items[0].ref, w1.items[0].ref); assert.equal(w2.items[1].ref, w1.items[1].ref); assert.equal((await state()).notes.length, n1); assert.equal((await state()).tasks.length, t1); assert.equal((await state()).gaps.find(g => /退货原因的下拉/.test(g.text)).count, g1);
  const dd = { done: ['收工测试：回了两封邮件'], learned: [{ title: '收工测试的一条经验很特别', text: 'x', category: '其他' }], unfinished: [] }; await tool(ownerKey, 'daily_digest', dd); const n2 = (await state()).notes.length; await tool(ownerKey, 'daily_digest', dd);
  assert.equal((await state()).notes.length, n2); assert.equal((await meGet(ownerKey)).json.done.find(g => g.date === today()).talk.filter(x => x.text === '收工测试：回了两封邮件').length, 1);
  await dg({ session: 'v1', done: ['z'], learned: [{ title: '自动提出来又被作废的一条经验', text: 'y', category: '其他' }] }); const vn = (await state()).notes.find(n => n.title === '自动提出来又被作废的一条经验'); await tool(ownerKey, 'note_decide', { id: vn.id, ok: false });
  const n3 = (await state()).notes.length; await dg({ session: 'v2', done: ['z2'], learned: [{ title: '自动提出来又被作废的一条经验', text: 'y', category: '其他' }] }); assert.equal((await state()).notes.length, n3, '作废过的不该再被自动交回来');
});

/* ═════ v35 第三遍：同事电脑那一侧 ═════ */
test('v35 断网时整理的小结不说「看过上一份」（不会把上一份没做完的冲掉）；装一次接入不会把没读的通知吃掉', async () => {
  const H3 = path.join(TMP, 'dadi-home3'); fs.mkdirSync(H3, { recursive: true }); fs.copyFileSync(path.join(CHOME, 'brain-hook.mjs'), path.join(H3, 'brain-hook.mjs'));
  fs.writeFileSync(path.join(H3, 'config.json'), JSON.stringify({ url: 'http://127.0.0.1:9', key: bKey, digest: 'auto', sync: 'off' }));
  const row = (type, text) => JSON.stringify({ type, message: { role: type, content: [{ type: 'text', text }] } });
  const tr = path.join(TMP, 'off3.jsonl'); fs.writeFileSync(tr, [row('user', '断网时候的工作。' + '细节'.repeat(120)), row('assistant', '好。' + '说明'.repeat(120)), row('user', '继续'), row('assistant', '做完了')].join('\n'));
  cli(['summarize', tr, 'off3', '/tmp'], { DADI_BRAIN_HOME: H3, DADI_CLAUDE_BIN: FAKE });
  const ob = fs.readdirSync(path.join(H3, 'outbox')); assert.equal(ob.length, 1); assert.equal(JSON.parse(fs.readFileSync(path.join(H3, 'outbox', ob[0]), 'utf8')).body.carry, false);
  /* 装接入：试连不用「开对话」那条 */
  await tool(ownerKey, 'task_create', { title: '装接入前派给同事B的一件事', category: '其他', assignee: '同事B' });
  const H4 = path.join(TMP, 'dadi-home4'), C4 = path.join(TMP, 'claude4'); fs.mkdirSync(C4, { recursive: true });
  execFileSync(process.execPath, [path.join(ROOT, 'client', 'install.mjs'), U, bKey], { env: { ...process.env, DADI_BRAIN_HOME: H4, CLAUDE_CONFIG_DIR: C4, DADI_CLAUDE_BIN: FAKE, DADI_NO_LAUNCHD: '1', DADI_LAUNCHD_DIR: path.join(TMP, 'agents4') }, encoding: 'utf8' });
  const ib = JSON.parse(fs.readFileSync(path.join(DATA, 'brain', 'inbox.json'), 'utf8')).find(x => /装接入前派给同事B的一件事/.test(x.text)); assert.ok(ib && !ib.read, '装完以后这条通知还是没读');
});
test('v35 第三遍审查的场景：流程和扫描不重开商品页；不同的事不并；报告不被盖；后半段空不清；库存待检查不被结束；管理页改派＝转交；交接不留后门；不重复算；页头对得上；状态不对明说；停用的人不卡任务', async () => {
  const K = t => (t.assignee === bId ? bKey : ownerKey);
  /* 流程派的「给 g-xxx 做商品页」开着时，扫描不再开 page:g-xxx */
  const po = (await tool(ownerKey, 'task_create', { title: '下第四批采购单', category: '采购单', assignee: 'Souki' })).task.id; await tool(ownerKey, 'task_update', { id: po, status: '完成', result: 'PO 建好', refs: ['g-2026971'] }); await mePost(ownerKey, '/me/task', { id: po, action: 'ok' });
  setItems([{ id: 'page:g-2026971', level: '今天', name: '商品页', text: 'g-2026971 测试：有库存 1 件，商品页还没做（没有图）' }]); await scanNow(); await scanNow();
  assert.equal((await state()).tasks.filter(t => ['待做', '进行中', '等确认'].includes(t.status) && t.ref === 'g-2026971' && t.category === '商品页').length, 1);
  /* 只差一两个字的两件不同的事：都建得出来 */
  const c1 = await tool(ownerKey, 'task_create', { title: '联系税理士确认消费税', category: '税务行政', assignee: 'Souki' }), c2 = await tool(ownerKey, 'task_create', { title: '联系税理士确认法人税', category: '税务行政', assignee: 'Souki' }); assert.notEqual(c1.task.id, c2.task.id);
  /* 清单发的报告（带补充、去掉了一条），后来下班弹窗再发一次：补充和去掉的都还在 */
  await fetch(U + '/hook/digest', { method: 'POST', headers: { authorization: 'Bearer ' + ownerKey, 'content-type': 'application/json' }, body: JSON.stringify({ session: 'rp1', done: ['私人的一条不要进报告', '公司的一条'] }) });
  await mePost(ownerKey, '/me/report', { note: '明天货到先检品', drop: ['私人的一条不要进报告'] }); const hr = await fetch(U + '/hook/report', { method: 'POST', headers: { authorization: 'Bearer ' + ownerKey, 'content-type': 'application/json' }, body: '{}' }); assert.equal(hr.status, 200);
  const sent = (await (await fetch(U + '/me/report', { headers: { authorization: 'Bearer ' + ownerKey } })).json()).sent; assert.equal(sent.note, '明天货到先检品'); assert.ok(!sent.done.includes('私人的一条不要进报告')); assert.ok(sent.done.includes('公司的一条'));
  /* 同一段对话后半段什么公司的事都没有：前半段没做完的照旧留着 */
  const dg = body => fetch(U + '/hook/digest', { method: 'POST', headers: { authorization: 'Bearer ' + ownerKey, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await dg({ session: 'half', carry: true, done: ['前半段'], unfinished: ['给 mospace 回信确认 11 月结算单'] }); await dg({ session: 'half', carry: true, done: [], unfinished: [] });
  assert.ok((await meGet(ownerKey)).json.pending.some(x => /mospace 回信/.test(x)));
  /* 库存预警：Claude 交上来等检查的，预警变成都点过了，也不替人结束 */
  const L = n => ({ id: 'svc:low', level: '提前', name: '库存', text: `库存预警 ${n.length} 款：${n.join('；')}` });
  setItems([L(['R1 剩 1'])]); await scanNow(); let lw = (await state()).tasks.find(t => (t.ruleKey || '').startsWith('svc:low') && t.status === '待做'); await mePost(K(lw), '/me/task', { id: lw.id, action: 'done' });
  setItems([L(['R1 剩 1', 'R2 剩 2'])]); await scanNow(); lw = (await state()).tasks.find(t => (t.ruleKey || '').startsWith('svc:low') && t.status === '待做'); await tool(K(lw) === bKey ? bKey : ownerKey, 'task_update', { id: lw.id, status: '完成', result: '追加 10 台，PO 草稿' });
  setItems([L(['R1 剩 1'])]); await scanNow(); const lw2 = (await state()).tasks.find(t => t.id === lw.id); assert.equal(lw2.status, '等确认'); assert.equal(lw2.result, '追加 10 台，PO 草稿'); fs.rmSync(ITEMS, { force: true });
  /* 管理页改负责人：还没检查的结果不带过去；不能改给停用的人 */
  const rv = (await tool(ownerKey, 'task_create', { title: '管理页改派测试', category: '其他', assignee: 'Souki' })).task.id; await tool(ownerKey, 'task_update', { id: rv, status: '完成', result: 'Souki 的 Claude 写的' });
  assert.equal((await web('/api/brain/task/update', { id: rv, assignee: bId })).status, 200); let t = (await state()).tasks.find(x => x.id === rv); assert.equal(t.status, '进行中'); assert.ok(!t.check); assert.ok(!(await meGet(bKey)).json.review.some(x => x.id === rv)); assert.equal((await meGet(bKey)).json.open.find(x => x.id === rv).from.by, 'Souki');
  const gone = await web('/api/brain/person/add', { name: '同事停' }); await web('/api/brain/person/update', { id: gone.json.id, disabled: true }); assert.equal((await web('/api/brain/task/update', { id: rv, assignee: gone.json.id })).status, 400);
  /* 交接给 B 再交回来：B 不能再读 A 的东西 */
  const A = await web('/api/brain/person/add', { name: '同事甲' }), Bp = await web('/api/brain/person/add', { name: '同事丙' });
  await web('/api/brain/person/handover', { from: A.json.id, to: Bp.json.id }); assert.ok((await state()).people.find(p => p.id === Bp.json.id).takeover.includes(A.json.id));
  await web('/api/brain/person/handover', { from: Bp.json.id, to: A.json.id }); assert.ok(!(await state()).people.find(p => p.id === Bp.json.id).takeover.includes(A.json.id));
  assert.equal((await fetch(U + '/backup/list?person=' + A.json.id, { headers: { authorization: 'Bearer ' + Bp.json.key } })).status, 403);
  /* 做完的任务和小结里说同一件事的那句：只算一次 */
  const one = (await tool(ownerKey, 'task_create', { title: '核对 PO-2026-040 的单价', category: '采购单', assignee: 'Souki' })).task.id; await mePost(ownerKey, '/me/task', { id: one, action: 'done' });
  await dg({ session: 'cnt', done: [`核对 PO-2026-040 的单价（${one}）`] }); const today0 = (await meGet(ownerKey)).json.done.find(g => g.date === today()); assert.ok(!today0.talk.some(x => /PO-2026-040/.test(x.text)));
  /* 页头「要做」＝下面「要做」的件数；菜单栏的数字另算 */
  const st = (await meGet(ownerKey)).json; assert.equal(st.counts.open, st.open.length); assert.equal(st.counts.total, st.open.length + st.review.length);
  /* 状态对不上：明说 */
  assert.equal((await mePost(ownerKey, '/me/task', { id: one, action: 'undo' })).status, 200); assert.equal((await mePost(ownerKey, '/me/task', { id: one, action: 'undo' })).status, 409); assert.equal((await mePost(ownerKey, '/me/task', { id: one, action: '乱写' })).status, 400);
  /* 管理页再批一次已经批过的经验：拒绝 */
  const nn = (await state()).notes.find(n => n.status === '已采用'); assert.equal((await web('/api/brain/note/decide', { id: nn.id, ok: true })).status, 409);
  /* 停用一个人：名下开着的任务按分工表转走；给他的留言转给接手的人 */
  const D = await web('/api/brain/person/add', { name: '同事丁' }); const dt = (await tool(ownerKey, 'task_create', { title: '同事丁名下的一件事', category: '其他', assignee: '同事丁' })).task.id;
  await web('/api/brain/person/update', { id: D.json.id, disabled: true }); t = (await state()).tasks.find(x => x.id === dt); assert.notEqual(t.assignee, D.json.id); assert.match(t.log.slice(-1)[0].text, /已停用/);
});
