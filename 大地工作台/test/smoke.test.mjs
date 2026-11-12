// 冒烟测试：用替身 Claude Code 起一个工作台，再用本机 Google Chrome（无头）打开页面，走一遍主要流程。
// 运行：node --test test/*.test.mjs   （没有 Chrome 时自动跳过）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { makeMount } from './fake-drive.mjs';
import { startImap } from './fake-imap.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CHROME = process.env.DADI_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 8870 + Math.floor(Math.random() * 100);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (url, body, headers = {}) => new Promise((res, rej) => { const s = JSON.stringify(body); const q = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dadi': '1', 'content-length': Buffer.byteLength(s), ...headers } }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, body: b })); }); q.on('error', rej); q.end(s); });
const get = (url, method = 'GET', headers = {}) => new Promise((res, rej) => { const q = http.request(url, { method, headers }, r => { let b = ''; r.on('data', d => b += d); r.on('end', () => res({ status: r.statusCode, body: b })); }); q.on('error', rej); q.end(); });

/* 极简 CDP 客户端（Node 24 自带 WebSocket） */
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); let n = 0; const waits = new Map();
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const id = ++n; waits.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result && r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text + ' ' + JSON.stringify(r.result.exceptionDetails.exception || {}).slice(0, 300)); return r.result && r.result.result ? r.result.result.value : undefined; };
  const until = async (expr, ms = 60000, every = 500) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await evalJs(expr)) return true; await sleep(every); } throw new Error('等太久：' + expr); };
  return { ready, send, evalJs, until, close: () => ws.close() };
}

test('工作台冒烟：页面读到数据、情报列表、人物切换、口令、文件缓存、直连', { timeout: 150000, skip: !fs.existsSync(CHROME) && '这台电脑没有 Google Chrome' }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dadi-smoke-'));
  const data = path.join(tmp, 'data'), prof = path.join(tmp, 'chrome');
  fs.mkdirSync(data); fs.mkdirSync(prof);
  fs.writeFileSync(path.join(tmp, 'fake-state.json'), JSON.stringify({ extra: {}, added: [], gone: [], seq: 0 }));
  const mount = makeMount(path.join(tmp, 'mount'));   /* 假的 Google Drive 挂载：Drive 直连走它 */
  const im = await startImap();                         /* 假的 Gmail IMAP：Gmail 直连走它 */
  const kids = [];
  const kill = () => kids.forEach(k => { try { k.kill('SIGTERM'); } catch {} });
  try {
    /* 1. 服务 */
    const srv = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], { env: { ...process.env, DADI_PORT: String(PORT), DADI_DATA: data, DADI_CLAUDE: path.join(HERE, 'fake-claude.mjs'), DADI_FAKE_DIR: tmp, DADI_TRANSCRIPTS: path.join(tmp, 'transcripts'), DADI_CHROME: '0', DADI_DRIVE_MOUNT: mount, DADI_IMAP_HOST: '127.0.0.1', DADI_IMAP_PORT: String(im.port) }, stdio: ['ignore', 'pipe', 'pipe'] });
    kids.push(srv);
    let up = false; for (let i = 0; i < 40 && !up; i++) { await sleep(250); try { up = (await get(`http://127.0.0.1:${PORT}/`)).status === 200; } catch {} }
    assert.ok(up, '服务没起来');
    assert.equal((await get(`http://127.0.0.1:${PORT}/api/status`)).status, 401, '没带口令也能调接口');
    assert.equal((await get(`http://127.0.0.1:${PORT}/app.js`)).status, 200);
    /* 2. Chrome */
    const ch = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
    kids.push(ch);
    const wsBase = await new Promise((res, rej) => { let buf = ''; const t = setTimeout(() => rej(new Error('Chrome 没报调试端口')), 15000); ch.stderr.on('data', d => { buf += d; const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(buf); if (m) { clearTimeout(t); res(m[1]); } }); });
    const devPort = new URL(wsBase).port;
    const tab = JSON.parse((await get(`http://127.0.0.1:${devPort}/json/new?http://127.0.0.1:${PORT}/`, 'PUT')).body);
    const c = cdp(tab.webSocketDebuggerUrl); await c.ready; await c.send('Runtime.enable');
    /* 3. 页面读到数据 */
    await c.until(`window.dadi && dadi.D.st.slack==='ok' && dadi.D.st.drive==='ok'`, 60000);
    assert.ok(await c.evalJs(`!!document.querySelector('meta[name=dadi-token]').content`), '页面没有口令');
    await c.until(`document.querySelectorAll('#home .irow').length>0`, 60000);
    assert.ok(await c.evalJs(`dadi.D.task.items.length>0`), '任务硬盘没读到');
    /* 3a. Drive 直连：任务硬盘的清单来自本机挂载，替身 Claude 一次 search_files 都没收到；Google 文档正文才交给连接器 */
    assert.ok(await c.evalJs(`dadi.D.task.items.some(x=>x.id==='T1'&&x.status==='待办'&&x.sec==='线上网站（ai）')`), '直连读到的任务不对：' + await c.evalJs(`JSON.stringify(dadi.D.task.items.map(x=>[x.id,x.sec,x.status]))`));
    const calls0 = fs.readFileSync(path.join(tmp, 'fake-calls.log'), 'utf8');
    assert.ok(!/CALL search_files/.test(calls0), 'Drive 直连开着，search_files 还是经了 Claude');
    assert.ok(!/CALL download_file_content/.test(calls0), 'Drive 直连开着，download_file_content 还是经了 Claude');
    assert.ok(await c.evalJs(`document.querySelectorAll('#rail nav button').length===6`), '竖栏不是六个入口（情报・任务・后台・Slack・模版・菜单）');
    /* 3b. 快捷指令菜单与系统窗口 */
    await c.evalJs(`document.querySelector('[data-tab="menu"]').click();true`); await sleep(300);
    assert.ok(await c.evalJs(`dadi.V.quick && document.querySelectorAll('#qmenu .qrow').length>=12`), '快捷指令菜单没打开');
    await c.evalJs(`[...document.querySelectorAll('#qmenu .qrow')].find(b=>/系统状态/.test(b.textContent)).click();true`);
    await c.until(`dadi.V.tab==='sys' && /登录与时限/.test(document.querySelector('#y-body').textContent)`, 15000);
    await c.evalJs(`document.querySelector('#shade').click();true`); await sleep(300);
    /* 3c. 任务窗口：竖栏点「任务」→ 四个部门＋管理，同事一条细栏；点名字出六项卡；派一个税务任务 → 进「运营」、情报顶上的「今日」也出现 */
    await c.evalJs(`document.querySelector('[data-tab="work"]').click();true`);
    await c.until(`dadi.V.tab==='work' && document.querySelectorAll('#w-body [data-wtab]').length===5 && document.querySelectorAll('#w-body .wstrip [data-wp]').length>=1`, 10000);
    await c.evalJs(`document.querySelector('#w-body .wstrip [data-wp]').click();true`); await sleep(200);
    assert.ok(await c.evalJs(`document.querySelectorAll('#w-body .wperson .wstats>div').length===6`), '同事卡片不是六项');
    await c.evalJs(`document.querySelector('#w-body [data-wa="pclose"]').click();true`); await sleep(200);
    await c.evalJs(`document.querySelector('#w-body [data-wtab="manage"]').click();true`); await sleep(200);
    await c.evalJs(`document.querySelector('#w-body [data-wm="plan"]').click();true`); await c.until(`!!document.querySelector('#w-disp') && !!document.querySelector('#w-rem')`, 5000);
    await c.evalJs(`document.querySelector('#w-body [data-wtab="运营"]').click();true`); await sleep(200);
    assert.equal((await post(`http://127.0.0.1:${PORT}/api/brain/task/create`, { title: '冒烟：问税理士一件事', category: '税务行政' }, { 'x-dadi-token': fs.readFileSync(path.join(data, 'secret'), 'utf8').trim() })).status, 200);
    await c.until(`/冒烟：问税理士一件事/.test(document.querySelector('#w-body').textContent)`, 10000);
    await c.evalJs(`document.querySelector('#w-body .wrow[data-wopen^="T-"]').click();true`); await sleep(200);
    assert.ok(await c.evalJs(`!!document.querySelector('#w-body .wopen [data-wa="comment"]')`), '任务点开没有留言框');
    await c.evalJs(`document.querySelector('[data-tab="home"]').click();true`);
    await c.until(`/冒烟：问税理士一件事/.test(document.querySelector('#home').textContent)`, 10000);
    /* 4. 点一条 Slack 情报 → 打开会话并进入回复 */
    const rows = await c.evalJs(`(()=>{document.querySelector('[data-tab="home"]').click();const rows=[...document.querySelectorAll('#home .irow')];const b=rows.find(x=>x.querySelector('.src.slack'));if(b)b.click();return {n:rows.length,hit:!!b};})()`);
    assert.ok(rows.hit, '情报列里没有 Slack 的行：' + JSON.stringify(rows));
    await sleep(400);
    assert.equal(await c.evalJs(`dadi.V.tab`), 'slack');
    assert.ok(await c.evalJs(`!!dadi.V.replyTo`), '没有进入回复状态');
    /* 5. 人物切换：管理员能写文件（弹卡），Ki Sou 直接拒 */
    await c.evalJs(`window.confirm=()=>true;document.querySelector('#who-btn').click();true`); await sleep(300);
    await c.evalJs(`document.querySelector('#pmenu [data-role="boss"]').click();true`);
    await c.until(`dadi.C.role && dadi.C.role.key==='boss'`, 10000);
    assert.equal(await c.evalJs(`dadi.S.chars.me.name`), '管理员');
    await c.evalJs(`dadi.V.chat||document.querySelector('#fab').click();document.querySelector('#c-in').value='帮我改文件';document.querySelector('#c-form').requestSubmit();true`);
    await c.until(`dadi.C.rows.some(r=>r.t==='ask'&&r.open)`, 15000);
    await c.evalJs(`[...document.querySelectorAll('#c-log button')].find(b=>b.textContent==='不允许').click();true`);
    await c.until(`!dadi.C.busy`, 15000);
    await c.evalJs(`document.querySelector('#who-btn').click();true`); await sleep(300);
    await c.evalJs(`document.querySelector('#pmenu [data-role="kisou"]').click();true`);
    await c.until(`dadi.C.role && dadi.C.role.key==='kisou'`, 10000);
    await c.evalJs(`document.querySelector('#c-in').value='帮我改文件';document.querySelector('#c-form').requestSubmit();true`);
    await c.until(`!dadi.C.busy && dadi.C.rows.some(r=>r.t==='note'&&/不能改本机文件/.test(r.text))`, 15000);
    /* 6. 文件：第一次读、第二次走缓存 */
    const t = await c.evalJs(`(async()=>{const f=dadi.D.task.items.find(x=>/\\.md$/.test(x.title));dadi.V.status=f.status;dadi.V.stack=[];document.querySelector('[data-tab="menu"]').click();document.querySelector('#qmenu [data-win="tasks"]').click();const b=[...document.querySelectorAll('#tasks button')].find(x=>x.textContent.startsWith(f.status));if(b)b.click();await new Promise(r=>setTimeout(r,200));const t0=performance.now();document.querySelector('#tasks [data-item="'+f.id+'"]').click();while(dadi.V.stack[0]&&dadi.V.stack[0].state==='loading')await new Promise(r=>setTimeout(r,50));const a=performance.now()-t0;document.querySelector('#tasks .back').click();await new Promise(r=>setTimeout(r,200));const t1=performance.now();document.querySelector('#tasks [data-item="'+f.id+'"]').click();while(dadi.V.stack[0]&&dadi.V.stack[0].state==='loading')await new Promise(r=>setTimeout(r,20));return {a,b:performance.now()-t1,ok:dadi.V.stack[0].state==='ok'};})()`);
    assert.ok(t.ok, '文件没打开'); assert.ok(t.b < 500, '第二次打开没走缓存：' + t.b);
    /* 6b. 附件：给 Claude Code 发一张图（替身只回一句） */
    await c.evalJs(`(async()=>{const bin=atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==');const u8=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);const f=new File([u8],'dot.png',{type:'image/png'});if(!dadi.V.chat)document.querySelector('#fab').click();dadi.addAtts('c',[f]);document.querySelector('#c-in').value='这是什么';document.querySelector('#c-form').requestSubmit();})();true`);
    await c.until(`!dadi.C.busy && dadi.C.rows.some(r=>r.t==='user'&&/dot\\.png/.test(r.text))`, 20000);
    /* 8. 审计有记录 */
    const token = await c.evalJs(`document.querySelector('meta[name=dadi-token]').content`);
    const au = JSON.parse((await get(`http://127.0.0.1:${PORT}/api/audit?n=20`, 'GET', { 'x-dadi-token': token })).body);
    assert.ok(au.items.some(x => x.kind === 'persona'), '审计里没有人物切换');
    assert.ok(au.items.some(x => x.kind === 'deny'), '审计里没有拒绝记录');
    /* 10. 真实用量：每次跑完都记了；系统窗口的「用量」页能打开 */
    const sy = JSON.parse((await get(`http://127.0.0.1:${PORT}/api/system`, 'GET', { 'x-dadi-token': token })).body);
    assert.deepEqual(sy.direct, { admin: true, slack: false, drive: true, mail: false }, '直连状态不对：' + JSON.stringify(sy.direct));
    assert.ok(sy.drive && sy.drive.on && sy.drive.drives.length === 2, JSON.stringify(sy.drive));
    /* 10a. Gmail 直连：填错的密码被拒；填对后收件箱来自 IMAP（替身 Claude 不再收到 search_threads），系统窗口四张直连卡 */
    await c.until(`!dadi.C.busy`, 15000);
    assert.equal((await post(`http://127.0.0.1:${PORT}/api/mail/token`, { user: 'souki@ala.jp', pass: 'abcdabcdabcdabcd' }, { 'x-dadi-token': token })).status, 403, 'Ki Sou 不该能设置 Gmail');
    assert.equal((await post(`http://127.0.0.1:${PORT}/api/role`, { key: 'boss' }, { 'x-dadi-token': token })).status, 200);
    await c.until(`dadi.C.role && dadi.C.role.key==='boss'`, 10000);
    const mbad = await post(`http://127.0.0.1:${PORT}/api/mail/token`, { user: 'souki@ala.jp', pass: 'wrongwrongwrongw' }, { 'x-dadi-token': token });
    assert.equal(mbad.status, 400, '错密码没被拒：' + mbad.body); assert.match(mbad.body, /不认|Invalid/, mbad.body);
    const mok = await post(`http://127.0.0.1:${PORT}/api/mail/token`, { user: 'souki@ala.jp', pass: 'abcd abcd abcd abcd' }, { 'x-dadi-token': token });
    assert.equal(mok.status, 200, 'Gmail 直连没开起来：' + mok.body);
    assert.equal(fs.statSync(path.join(data, 'mail.json')).mode & 0o777, 0o600, '密码文件权限不是 0600');
    await c.until(`dadi.C.mail && dadi.C.mail.on`, 10000);
    assert.equal((await post(`http://127.0.0.1:${PORT}/api/role`, { key: 'kisou' }, { 'x-dadi-token': token })).status, 200);
    await c.until(`dadi.C.role && dadi.C.role.key==='kisou'`, 10000);
    const nCalls = (fs.readFileSync(path.join(tmp, 'fake-calls.log'), 'utf8').match(/CALL search_threads/g) || []).length;
    await c.evalJs(`dadi.D.mail.at=0;document.querySelector('#refresh').click();true`);
    await c.until(`dadi.D.mail.threads.some(t=>t.subject==='直连测试'&&/黄志龙/.test(t.from)&&/源码交接/.test(t.snippet))`, 30000);
    assert.equal((fs.readFileSync(path.join(tmp, 'fake-calls.log'), 'utf8').match(/CALL search_threads/g) || []).length, nCalls, 'Gmail 直连开着，search_threads 还是经了 Claude');
    assert.ok(im.calls.some(x => /^UID FETCH/.test(x)), '假 IMAP 没收到 FETCH');
    await c.evalJs(`dadi.V.sysView='status';document.querySelector('[data-tab="menu"]').click();document.querySelector('#qmenu [data-win="sys"]').click();true`);
    await c.until(`!!document.querySelector('#y-body [data-mkoff]')`, 15000);   /* 等系统窗口拿到新的状态（Gmail 已直连才有「关闭直连」） */
    const direct = await c.evalJs(`[...document.querySelectorAll('#y-body .cards')[1].querySelectorAll('.cardn')].map(x=>x.querySelector('small').firstChild.textContent+'='+x.querySelector('b').textContent)`);
    assert.deepEqual(direct, ['网站后台=直连 · 未登录', 'Slack=经 Claude', 'Google Drive=直连', 'Gmail=直连'], JSON.stringify(direct));
    assert.ok(await c.evalJs(`!!document.querySelector('#y-body #sk-form') && !document.querySelector('#y-body #mk-form') && !!document.querySelector('#y-body [data-mkoff]')`), '直连表单显示不对');
    /* 10b. 连接器：只列工作台用的四个；「重新检查」起一个不发话的进程问状态 */
    const conn0 = await c.evalJs(`[...document.querySelectorAll('#y-body .cards')[2].querySelectorAll('.cardn')].map(x=>x.querySelector('small').firstChild.textContent+'='+x.querySelector('b').textContent)`);
    assert.deepEqual(conn0, ['Slack=已连接', 'Google Drive=已连接', 'Gmail=已连接', 'Google Calendar=还没读到'], JSON.stringify(conn0));
    await c.evalJs(`document.querySelector('#y-body [data-conncheck], #y-head [data-conncheck]').click();true`);
    await c.until(`/连接器状态已更新/.test(document.body.textContent)`, 20000);
    const au2 = JSON.parse((await get(`http://127.0.0.1:${PORT}/api/system`, 'GET', { 'x-dadi-token': token })).body);
    assert.ok(au2.connectors.some(x => /Slack/.test(x.name) && x.status === 'connected'), JSON.stringify(au2.connectors));
    await c.evalJs(`document.querySelector('#shade').click();true`); await sleep(300);
    assert.ok(sy.usage && sy.usage.today && sy.usage.today.kinds.chat && sy.usage.today.kinds.chat.n >= 1, '对话用量没记：' + JSON.stringify(sy.usage && sy.usage.today));
    assert.ok(sy.usage.today.kinds.data && sy.usage.today.kinds.data.n >= 1, '取数用量没记');
    assert.ok(sy.guard && sy.guard.on && sy.guard.rules.length >= 8, '硬规则没开：' + JSON.stringify(sy.guard));
    await c.evalJs(`dadi.V.sysView='usage';document.querySelector('[data-tab="menu"]').click();document.querySelector('#qmenu [data-win="sys"]').click();true`);
    await c.until(`/真实数|最近 7 天/.test(document.querySelector('#y-body').textContent) && document.querySelectorAll('#y-body .utab').length===3`, 15000);
    await c.evalJs(`document.querySelector('#shade').click();true`); await sleep(300);
    /* 11. 任务进行窗口：跑一次带工具的任务，右侧列出步骤，步骤有拿到的内容；做完有总结 */
    await c.evalJs(`dadi.V.runAuto=true;dadi.V.chat||document.querySelector('#fab').click();document.querySelector('#c-in').value='只读巡检 看一下';document.querySelector('#c-form').requestSubmit();true`);
    await c.until(`dadi.V.run && document.querySelectorAll('#run .rstep').length>=1`, 15000);
    await c.until(`!dadi.C.busy`, 20000);
    assert.ok(await c.evalJs(`dadi.C.rows.some(r=>r.t==='tool'&&r.done&&typeof r.out==='string'&&r.out.length>0)`), '工具步骤没有带回内容');
    assert.ok(await c.evalJs(`/做完了|没做成/.test(document.querySelector('#run .rdone')?.textContent||'')`), '任务进行窗口没有总结');
    await c.evalJs(`document.querySelector('#run [data-rstep]').click();true`); await sleep(200);
    assert.ok(await c.evalJs(`!!document.querySelector('#run .rstep pre')`), '点步骤没展开内容');
    /* 11b. 照 Claude Code：思考过程、待办清单、改文件的红绿差异、状态行、斜杠命令 */
    await c.evalJs(`document.querySelector('#c-in').value='列个待办清单';document.querySelector('#c-form').requestSubmit();true`);
    await c.until(`!dadi.C.busy && dadi.C.rows.some(r=>r.t==='tool'&&r.todos)`, 20000);
    assert.ok(await c.evalJs(`document.querySelectorAll('#c-log .todo div').length===3 && /待办清单/.test(document.querySelector('#c-log .todo').textContent)`), '待办清单没画出来');
    assert.ok(await c.evalJs(`!!document.querySelector('#c-log details.think') && /思考/.test(document.querySelector('#c-log details.think').textContent)`), '思考过程没显示');
    assert.ok(await c.evalJs(`!!document.querySelector('#c-log .diff .del') && !!document.querySelector('#c-log .diff .add')`), '改文件的红绿差异没显示');
    assert.ok(await c.evalJs(`/本段 \\d+ 轮/.test(document.querySelector('#c-status').textContent) && /本周已用 34%/.test(document.querySelector('#c-status').textContent)`), '状态行没有轮数或套餐份额：' + await c.evalJs(`document.querySelector('#c-status').textContent`));
    const sy2 = JSON.parse((await get(`http://127.0.0.1:${PORT}/api/system`, 'GET', { 'x-dadi-token': token })).body);
    assert.ok(sy2.rate && sy2.rate.week && Math.round(sy2.rate.week.u * 100) === 34 && sy2.rate.overage === false, '服务端没记下套餐份额：' + JSON.stringify(sy2.rate));
    await c.evalJs(`(()=>{const i=document.querySelector('#c-in');i.value='/mo';i.dispatchEvent(new Event('input',{bubbles:true}));})();true`);
    assert.ok(await c.evalJs(`!document.querySelector('#c-slash').hidden && document.querySelectorAll('#c-slash [data-slash]').length===1 && document.querySelector('#c-slash [data-slash]').dataset.slash==='/model'`), '斜杠命令菜单没出来或没过滤');
    await c.evalJs(`document.querySelector('#c-slash [data-slash]').click();true`); await sleep(200);
    assert.ok(await c.evalJs(`document.querySelector('#c-slash').hidden && dadi.V.opts===true && document.querySelector('#c-in').value===''`), '选了 /model 没生效');
    /* 11c. 照 Slack：一列式、日期线、mrkdwn、@某人、表情反应、悬停动作、线程；@ 提人；点表情；搜索 */
    await c.evalJs(`(()=>{const x=document.querySelector('[data-chat-close]');if(x)x.click();document.querySelector('[data-tab="slack"]').click();})();true`); await sleep(400);
    await c.evalJs(`(()=>{const bk=document.querySelector('#s-head [data-back]');if(bk)bk.click();})();true`); await sleep(300);   /* 第 4 步可能还停在某个会话里：先回到清单 */
    await c.evalJs(`document.querySelector('#s-body [data-conv="C0C5Y2QU7U1"]').click();true`); await sleep(400);
    const sl = await c.evalJs(`({sm:document.querySelectorAll('#s-body .sm').length,day:document.querySelectorAll('#s-body .day').length,mn:document.querySelectorAll('#s-body .txt .mn').length,rx:[...document.querySelectorAll('#s-body .rx button')].map(b=>b.textContent.trim()),acts:document.querySelectorAll('#s-body .acts').length,thr:document.querySelectorAll('#s-body .thr').length,textarea:document.querySelector('#s-in').tagName})`);
    assert.ok(sl.sm >= 4 && sl.day >= 1 && sl.mn >= 1 && sl.rx.includes('👀 1') && sl.acts >= 4 && sl.thr >= 1 && sl.textarea === 'TEXTAREA', 'Slack 会话视图不对：' + JSON.stringify(sl));
    await c.evalJs(`(()=>{const i=document.querySelector('#s-in');i.value='@阿';i.setSelectionRange(2,2);i.dispatchEvent(new Event('input',{bubbles:true}));})();true`);
    assert.ok(await c.evalJs(`!document.querySelector('#s-mention').hidden && [...document.querySelectorAll('#s-mention [data-mention]')].some(b=>b.dataset.mention==='阿婷')`), '@ 提人没弹出');
    await c.evalJs(`[...document.querySelectorAll('#s-mention [data-mention]')].find(b=>b.dataset.mention==='阿婷').click();true`);
    assert.equal(await c.evalJs(`document.querySelector('#s-in').value`), '@阿婷 ', '选人没填进去');
    await c.evalJs(`document.querySelector('#s-in').value='@阿婷 测试一下';document.querySelector('#s-form').requestSubmit();true`);
    await c.until(`(()=>{const m=dadi.D.convs.find(c=>c.id==='C0C5Y2QU7U1').msgs[0];return m&&m.text.includes('<@U0C6QF529A4>')&&!m.wait;})()`, 15000);
    await c.evalJs(`document.querySelector('#s-body [data-react="eyes"]').click();true`);
    await c.until(`[...document.querySelectorAll('#s-body .rx button')].some(b=>/👀 2/.test(b.textContent))`, 15000);
    await c.evalJs(`document.querySelector('#s-head [data-back]').click();true`); await sleep(200);
    await c.evalJs(`document.querySelector('#s-q').value='能看到';document.querySelector('#s-search').requestSubmit();true`);
    await c.until(`dadi.V.sres && dadi.V.sres.state==='ok'`, 15000);
    assert.ok(await c.evalJs(`document.querySelectorAll('#s-body [data-sgo]').length>=1`), '搜索没有结果：' + await c.evalJs(`JSON.stringify(dadi.V.sres)`));
    await c.evalJs(`([...document.querySelectorAll('#s-body [data-sgo]')].find(b=>b.querySelector('em')&&b.querySelector('em').textContent==='#alaco-ai-daily-tasks')||document.querySelector('#s-body [data-sgo]')).click();true`); await sleep(300);   /* 替身的搜索结果第一条可能是和 Claude 的私聊，挑频道那条 */
    assert.equal(await c.evalJs(`dadi.V.conv`), 'C0C5Y2QU7U1', '点搜索结果没打开会话：' + await c.evalJs(`JSON.stringify(dadi.V.sres.items.map(x=>x.where))`));
    await c.evalJs(`document.querySelector('#s-head [data-back]').click();document.querySelector('#shade').click();true`); await sleep(200);
    /* 12. 历史对话：列表里有这段，能回看、搜索、导出、续接 */
    const hl = JSON.parse((await get(`http://127.0.0.1:${PORT}/api/history`, 'GET', { 'x-dadi-token': token })).body);
    assert.ok(hl.items.length >= 1 && hl.items[0].id, '历史列表为空：' + JSON.stringify(hl).slice(0, 200));
    const hid = hl.items[0].id;
    const hg = JSON.parse((await get(`http://127.0.0.1:${PORT}/api/history/get?id=${hid}`, 'GET', { 'x-dadi-token': token })).body);
    assert.ok(hg.rows.some(r => r.t === 'user') && hg.rows.some(r => r.t === 'tool'), '回看没有内容：' + JSON.stringify(hg).slice(0, 200));
    const hs = JSON.parse((await get(`http://127.0.0.1:${PORT}/api/history/search?q=${encodeURIComponent('巡检')}`, 'GET', { 'x-dadi-token': token })).body);
    assert.ok(hs.items.length >= 1, '搜索没结果');
    const hx = await get(`http://127.0.0.1:${PORT}/api/history/export?id=${hid}`, 'GET', { 'x-dadi-token': token });
    assert.ok(hx.status === 200 && /# 对话记录/.test(hx.body), '导出不是 Markdown');
    await c.evalJs(`document.querySelector('#shade').click();dadi.V.chat&&document.querySelector('#fab').click();true`); await sleep(200);
    await c.evalJs(`dadi.V.sysView='status';document.querySelector('[data-tab="menu"]').click();document.querySelector('#qmenu [data-win="sys"]').click();true`);
    await c.until(`!!document.querySelector('#y-body [data-hist]')`, 15000);
    await c.evalJs(`document.querySelector('#y-body [data-hist]').click();true`);
    await c.until(`dadi.V.tab==='hist' && document.querySelectorAll('#g-body [data-hopen]').length>=1`, 15000);
    await c.evalJs(`document.querySelector('#g-body [data-hopen]').click();true`);
    await c.until(`dadi.V.hview==='view' && document.querySelectorAll('#g-body .m').length>=1`, 15000);
    await c.evalJs(`document.querySelector('#g-head [data-hback]').click();true`); await sleep(200);
    assert.ok(await c.evalJs(`dadi.V.hview==='list'`), '返回列表没成');
    /* 12b. 删除一段：两次点击确认，清单里去掉、记录文件删掉；删的是现在这段就自动开新的一段 */
    const nHist = await c.evalJs(`document.querySelectorAll('#g-body [data-hdel]').length`), delId = await c.evalJs(`document.querySelector('#g-body [data-hdel]').dataset.hdel`);   /* 前面切换人物会各开一段，所以不止一段 */
    await c.evalJs(`document.querySelector('#g-body [data-hdel]').click();document.querySelector('#g-body [data-hdel]').click();true`);
    await c.until(`document.querySelectorAll('#g-body [data-hdel]').length===${nHist - 1} && /这段删掉了/.test(document.querySelector('#toast').textContent)`, 15000);
    assert.ok(!fs.existsSync(path.join(tmp, 'transcripts', delId + '.jsonl')), '记录文件没删');
    const left = JSON.parse((await get(`http://127.0.0.1:${PORT}/api/history`, 'GET', { 'x-dadi-token': token })).body).items;
    assert.equal(left.length, nHist - 1, '删了清单没少一段'); assert.ok(!left.some(x => x.id === delId), '删了还在清单里');
    /* 9. 系统窗口第二页「最近操作」：有人物切换和拒绝两种记录，筛选能用 */
    await c.evalJs(`document.querySelector('#who-btn').click();true`); await sleep(300);
    await c.evalJs(`document.querySelector('#pmenu [data-audit]').click();true`);
    await c.until(`dadi.V.tab==='sys' && dadi.V.sysView==='audit' && document.querySelectorAll('#y-body .arow').length>=2`, 15000);
    assert.ok(await c.evalJs(`[...document.querySelectorAll('#y-body .arow')].some(r=>/切换人物/.test(r.textContent)) && [...document.querySelectorAll('#y-body .arow')].some(r=>/拒绝 Claude Code/.test(r.textContent))`), '最近操作里没有人物切换或拒绝记录');
    await c.evalJs(`document.querySelector('#y-body [data-afilter="sys"]').click();true`); await sleep(300);
    assert.ok(await c.evalJs(`[...document.querySelectorAll('#y-body .arow')].every(r=>/切换人物|生成报告|直连|历史对话/.test(r.textContent))`), '「人物・报告」筛选没生效');   /* 这一组里还有「Gmail 直连：开启」这类设置记录 */
    await c.evalJs(`document.querySelector('#y-head [data-sysview="status"]').click();true`);
    await c.until(`/登录与时限/.test(document.querySelector('#y-body').textContent)`, 15000);
    c.close();
  } finally {
    kill(); im.close();
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});
