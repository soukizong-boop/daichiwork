#!/usr/bin/env node
// 仅供本地测试：假装成命令行版 Claude Code，按同样的输入输出格式说话。
// 连接器的返回格式照真实返回（数据是假的）。状态存在同目录 fake-state.json，跨进程保留。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const DIR = process.env.DADI_FAKE_DIR || os.tmpdir();   /* 状态和调用记录写到临时目录，不弄脏项目文件夹 */
const SF = path.join(DIR, 'fake-state.json');
const LOGF = path.join(DIR, 'fake-calls.log');
const T0 = Date.now();
const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const has = n => args.includes(n);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let rec = () => {};
const out = m => { if (m && m.type === 'assistant' && m.message && !m.message.usage) m.message = { ...m.message, model: 'claude-fake', usage: { input_tokens: 5, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 } }; if (m && (m.type === 'user' || m.type === 'assistant')) rec(m); process.stdout.write(JSON.stringify(m) + '\n'); };
const log = s => fs.appendFileSync(LOGF, s + '\n');
const load = () => { try { return JSON.parse(fs.readFileSync(SF, 'utf8')); } catch { return { extra: {}, added: [], gone: [], seq: 0 }; } };
const save = s => fs.writeFileSync(SF, JSON.stringify(s));
log('START ' + JSON.stringify(args.map(a => (a.length > 60 ? a.slice(0, 60) + '…' : a))) + ' cwd=' + process.cwd() + ' env=' + ['ENABLE_TOOL_SEARCH', 'CLAUDECODE', 'ANTHROPIC_BASE_URL'].map(k => k + '=' + (process.env[k] || '')).join(','));

if (process.env.FAKE_LOGOUT === '1' || fs.existsSync(path.join(DIR, 'LOGOUT'))) {
  const r = { type: 'result', subtype: 'success', is_error: true, result: 'Failed to authenticate: OAuth session expired and could not be refreshed', session_id: 'x' };
  if (flag('--output-format') === 'json') { process.stdin.resume(); process.stdin.on('end', () => { out(r); process.exit(1); }); }
  else { out({ type: 'system', subtype: 'init', session_id: 'x', tools: ['Read', 'Bash'], mcp_servers: [] }); readline.createInterface({ input: process.stdin }).on('line', () => { out(r); process.exit(1); }); }
} else main();

/* ───── 假数据（格式照真实返回） ───── */
const chList = "## My Channels (showing 10 of 10 total)\n\n### #チャンネル-サンプル\n- **ID:** C0C5QQQMTAR\n- **Type:** Private Channel\n- **Archived:** No\n\n### #slack-のすべて\n- **ID:** C0C5VV6NJ9Y\n- **Type:** Public Channel\n- **Purpose:** 会社のニュース\n- **Archived:** No\n\n### #alaco-ai-daily-tasks\n- **ID:** C0C5Y2QU7U1\n- **Type:** Public Channel\n- **Purpose:** このチャンネルでは\n- **Archived:** No\n\n### DM with Claude\n- **ID:** D0C6QFJNR16\n- **Type:** Direct Message\n- **User ID:** U0C5W0A5D7C\n- **Archived:** No\n\n### DM with Slack\n- **ID:** D0C6QF6LGGG\n- **Type:** Direct Message\n- **User ID:** USLACK\n- **Archived:** No\n\n### DM with Ki Sou\n- **ID:** D0C63BVR9HU\n- **Type:** Direct Message\n- **User ID:** U0C63BV7GT0\n- **Archived:** No\n\n### DM with 阿婷\n- **ID:** D0C5ZQBHPM2\n- **Type:** Direct Message\n- **User ID:** U0C6QF529A4\n- **Archived:** No\n\n### DM with Slackbot\n- **ID:** D0C5ZQ7BN68\n- **Type:** Direct Message\n- **User ID:** USLACKBOT\n- **Archived:** No\n\n### DM with RunJay\n- **ID:** D0C5Y2JAYGZ\n- **Type:** Direct Message\n- **User ID:** U0C5ENS477H\n- **Archived:** No\n\n---\n## Archived\n\n### #ソーシャル\n- **ID:** C0C5U5MGA86\n- **Type:** Public Channel\n- **Archived:** Yes\n\n";
const base = {
  C0C5Y2QU7U1: "=== Message from 阿婷 <htliu@ala.jp> (U0C6QF529A4) at 2026-10-02 15:22:33 JST === \nMessage TS: 1790922153.570089\n能看到\n\n=== Message from RunJay <souki@ala.jp> (U0C5ENS477H) at 2026-10-02 15:19:09 JST === \nMessage TS: 1790921949.271879\n@claude 我现在发的文字，你能看到吗？能直接回复我吗\n*发送工具* <@U0C5W0A5D7C|Claude>\nReactions: eyes (1)\n\n=== Message from RunJay <souki@ala.jp> (U0C5ENS477H) at 2026-10-02 13:51:12 JST === \nMessage TS: 1790916672.581599\n你能连google meet 吗\nThread: 1 replies (latest: 2026-10-02 13:51:35 JST)\n\n=== Message from Ki Sou <souki.zong@gmail.com> (U0C63BV7GT0) at 2026-10-02 09:54:56 JST === \nMessage TS: 1790902496.607329\n<@U0C63BV7GT0|Ki Sou>さんがチャンネルに参加しました\n\n=== Message from 阿婷 <htliu@ala.jp> (U0C6QF529A4) at 2026-10-01 16:40:11 JST === \nMessage TS: 1790840411.397229\n<@U0C5W0A5D7C|Claude>\n1我想把这份报告放到googledrive的共享文档 大地ai工作任务 线上网站 代办中\nThread: 5 replies (latest: 2026-10-01 16:43:54 JST)\nReactions: eyes (1)",
  D0C6QFJNR16: "=== Message from RunJay <souki@ala.jp> (U0C5ENS477H) at 2026-10-02 09:45:34 JST === \nMessage TS: 1790901934.543119\n频道的额度怎么设置\nThread: 5 replies (latest: 2026-10-02 09:48:14 JST)\n\n=== Message from Claude <botuser-T0C6QF1151N-B0C5Y31TMLH@slack-bots.com> (U0C5W0A5D7C) at 2026-10-02 09:39:11 JST === \nMessage TS: 1790901551.755919\n「白露」项链订单 8/29 下单，<https://x.slack.com/archives/C0/p1|昨天的待办汇总>里仍未发货。\n\n从今天起，我每个工作日早上发一份简报。\nclaude-opus-5-5[1m]\n\n=== Message from Claude <botuser-T0C6QF1151N-B0C5Y31TMLH@slack-bots.com> (U0C5W0A5D7C) at 2026-10-01 14:58:47 JST === \nMessage TS: 1790834327.694899\n✓ *Claude account reconnected*",
  D0C5ZQBHPM2: "=== Message from 阿婷 <htliu@ala.jp> (U0C6QF529A4) at 2026-10-02 11:02:00 JST === \nMessage TS: 1790906520.000100\n后台报告我放到线上网站待办里了",
};
const thread = ts => "=== THREAD PARENT MESSAGE ===\nFrom: RunJay <souki@ala.jp> (U0C5ENS477H)\nTime: 2026-10-02 13:51:12 JST\nMessage TS: " + ts + "\n你能连google meet 吗\n\n=== THREAD REPLIES (1 total) ===\n\n--- Reply 1 of 1 ---\nFrom: Claude <botuser-T0C6QF1151N-B0C5Y31TMLH@slack-bots.com> (U0C5W0A5D7C)\nTime: 2026-10-02 13:51:35 JST\nMessage TS: 1790916695.078659\n不能直接连。我没法加入 Google Meet 会议。\n\n你具体想做哪一件？\nclaude-opus-5-5[1m] · <https://claude.ai/claude-in-slack/T0/C0/configure|Configure>\n";
const sheet = "Context Type: corpus_document\n## Table Context\n### File Name: 大地_任务总表\n### Table Sample Data:\n|     |     |      |       |     |     |            |       |      |      |      |    |\n| :-: | :-: | :--: | :---: | :-: | :-: | :--------: | :---: | :--: | :--: | :--: | :-: |\n| ID  | 板块  | 任务   | 负责人   | 状态  | 优先级 | 截止日        | 卡在哪/等谁 | 下一步  | 资料位置 | 最后更新 | 备注 |\n| S01 | 店铺  | 306 样品全部做完 | Souki | 进行中 | 高   |            |       |      |      | 2026-09-30 |    |\n| W01 | 网站  | 黄兄交接：源码转大地 GitHub | Souki | 等外部 | 高   | 2026-10-09 | 黄兄（10/9 才出现） | 准备交接清单 |  | 2026-09-30 | 合同 |\n\n### Table Columns:\n- x";
const F = 'application/vnd.google-apps.folder';
const SECS = { W: '12xHB_cq1ik-GMke0FmWN_UJ_dMUJapjH', S: '1K9_NLY7cijVDiIRE_WJQV_N5iVgRM6aL', A: '195nXM1gwDtuVPzw-YIMPOH7LCP4Uvfrd' };
function driveFiles(st) {
  const d = [
    { id: 'ROOT_SHEET', title: '大地_任务总表', mimeType: 'application/vnd.google-apps.spreadsheet', parentId: 'TASKROOT', modifiedTime: '2026-09-29T22:49:21Z', viewUrl: 'https://docs.google.com/spreadsheets/d/x' },
  ];
  for (const k of ['W', 'S', 'A']) ['待办', '进行中', '等外部', '已完成'].forEach((s, i) => d.push({ id: `ST_${k}_${i}`, title: s, mimeType: F, parentId: SECS[k], modifiedTime: '2026-09-29T22:36:00Z', viewUrl: 'https://drive.google.com/drive/folders/' + k + i }));
  d.push(
    { id: 'T1', title: 'ALA&CO后台报告_2026-10-01.md', mimeType: 'text/markdown', parentId: 'ST_W_0', modifiedTime: '2026-10-01T07:50:14Z', viewUrl: 'https://drive.google.com/file/d/t1' },
    { id: 'T2', title: '黄兄交接与尾款_截止2026-10-09', mimeType: F, parentId: 'ST_W_2', modifiedTime: '2026-09-29T22:37:37Z', viewUrl: 'https://drive.google.com/drive/folders/t2' },
    { id: 'T3', title: 'mospace合作合同_等姚总回复', mimeType: F, parentId: 'ST_S_2', modifiedTime: '2026-09-29T22:37:38Z', viewUrl: 'https://drive.google.com/drive/folders/t3' },
    { id: 'T4', title: '公司增资_2026-04', mimeType: F, parentId: 'ST_A_3', modifiedTime: '2026-09-29T22:37:27Z', viewUrl: 'https://drive.google.com/drive/folders/t4' },
    { id: 'T5', title: '2026-10-02_清理 TEST 商品_阿婷', mimeType: 'application/vnd.google-apps.document', parentId: 'ST_W_1', modifiedTime: '2026-10-02T05:00:00Z', viewUrl: 'https://docs.google.com/document/d/t5' },
    { id: 'T2a', title: '合同要点.md', mimeType: 'text/markdown', parentId: 'T2', modifiedTime: '2026-09-29T22:38:00Z', viewUrl: 'https://drive.google.com/file/d/t2a' },
    { id: 'ARCH_LIST', title: '文件放置清单_20260929.md', mimeType: 'text/markdown', parentId: '0APz6V6jwaRMUUk9PVA', modifiedTime: '2026-09-29T03:17:51Z', viewUrl: 'https://drive.google.com/file/d/al' },
    { id: 'ARCH_1', title: '线上网站', mimeType: F, parentId: '0APz6V6jwaRMUUk9PVA', modifiedTime: '2026-09-29T03:05:14Z', viewUrl: 'https://drive.google.com/drive/folders/a1' },
    { id: 'ARCH_2', title: '店铺', mimeType: F, parentId: '0APz6V6jwaRMUUk9PVA', modifiedTime: '2026-09-29T01:54:22Z', viewUrl: 'https://drive.google.com/drive/folders/a2' },
  );
  return d.concat(st.added).filter(f => !st.gone.includes(f.id));
}
const report = "# ALA&CO 后台报告（2026-10-01）\n\n> 数据来源：www.alaco.ai/admin（只读浏览，未做任何修改）\n\n---\n\n## 1. 未完成的客服咨询\n\n当前 **未完成 1 条 / 已超时 1 条**。\n\n| 项目 | 内容 |\n|---|---|\n| 咨询编号 | INQ-06C58991 |\n| 类别 | 订单配送 |\n\n## 4. 建议优先处理\n\n1. **WEB-#MTDL6M2X-1 待发货**：下单已超过 1 个月。\n2. 待退款 1 笔。\n";
const b64 = s => Buffer.from(s, 'utf8').toString('base64');
function search(st, q) {
  const d = driveFiles(st); let m;
  if ((m = q.match(/title contains '([^']+)'/))) return d.filter(f => f.title.includes(m[1]));
  if (/parentId =/.test(q)) { const ids = [...q.matchAll(/parentId = '([^']+)'/g)].map(x => x[1]); return d.filter(f => ids.includes(f.parentId)); }
  if ((m = q.match(/fullText contains '([^']+)'/))) return d.filter(f => f.mimeType !== F).slice(0, 3);
  return [];
}
/* 返回 [文字, 是否出错] */
function tool(short, i) {
  const st = load(); let r, err = false;
  log('CALL ' + short + ' ' + JSON.stringify(i));
  const J = v => JSON.stringify(v);
  switch (short) {
    case 'slack_read_user_profile': r = J({ result: 'souki ()\n大地（株）\n\nsouki@ala.jp\nStatus:  \n' }); break;
    case 'slack_list_user_channels': r = J({ result: chList }); break;
    case 'slack_list_channel_members': r = J({ members: i.channel_id === 'C0C5Y2QU7U1' ? "# Channel Members (5)\n\n## Member 1\nUser ID: U0C5ENS477H\nUsername: @souki\nDisplay Name: \nReal Name: RunJay\nEmail: souki@ala.jp\n\n## Member 2\nUser ID: U0C5W0A5D7C\nUsername: @claude\nDisplay Name: \nReal Name: Claude\nEmail: N/A\n\n## Member 3\nUser ID: U0C63BV7GT0\nUsername: @souki.zong\nDisplay Name: Ki Sou\nReal Name: Ki Sou\nEmail: souki.zong@gmail.com\n\n## Member 4\nUser ID: U0C6QF529A4\nUsername: @htliu\nDisplay Name: 阿婷\nReal Name: Ht Liu\nEmail: htliu@ala.jp\n\n## Member 5\nUser ID: U0C7NEWBIE1\nUsername: @xiaowang\nDisplay Name: 小王\nReal Name: Xiao Wang\nEmail: wang@ala.jp\n\n" : "# Channel Members (2)\n\n## Member 1\nUser ID: U0C5ENS477H\nUsername: @souki\nDisplay Name: \nReal Name: RunJay\nEmail: souki@ala.jp\n\n## Member 2\nUser ID: U0C6QF529A4\nUsername: @htliu\nDisplay Name: 阿婷\nReal Name: Ht Liu\nEmail: htliu@ala.jp\n\n", pagination_info: 'No more members available.\n' }); break;
    case 'slack_search_public_and_private': { const lines = []; let n = 0; if (st.pending && Date.now() - st.pending.at > 6000) lines.push(`${++n}. DM with RunJay, Claude - Claude: 1. 阿婷｜Slack #alaco-ai-daily-tasks｜后台报告放到线上网站待办了 2026-10-02 16:09:00 JST`); for (const [cid, label] of [['C0C5Y2QU7U1', '#alaco-ai-daily-tasks'], ['D0C5ZQBHPM2', 'DM with RunJay, 阿婷']]) { const txt = (st.extra[cid] || '') + (base[cid] || ''); const m = txt.match(/=== Message from (.*?) <[^>]*> \(\w+\) at (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) JST[^\n]*\nMessage TS: [\d.]+\n([^\n]*)/); if (m) lines.push(`${++n}. ${label} - ${m[1]}: ${m[3]} ${m[2]} JST`); } r = J({ results: '# Search Results for: \n\n## Messages (' + n + ' results)\n' + lines.join('\n') + '\n', pagination_info: '' }); break; }
    case 'slack_read_channel': {
      let txt = (st.extra[i.channel_id] || '') + (base[i.channel_id] || '');
      /* 发给 Claude 的私聊：6 秒后它在线程里回了一条 */
      if (i.channel_id === 'D0C6QFJNR16' && st.pending && Date.now() - st.pending.at > 6000) txt = txt.replace('Message TS: ' + st.pending.ts + '\n' + st.pending.text + '\n', 'Message TS: ' + st.pending.ts + '\n' + st.pending.text + '\nThread: 1 replies (latest: 2026-10-02 16:09:00 JST)\n');
      r = J({ messages: 'Channel: x (' + i.channel_id + ')\n\n' + txt }); break;
    }
    case 'slack_read_thread': {
      if (st.pending && i.message_ts === st.pending.ts) r = J({ messages: "=== THREAD PARENT MESSAGE ===\nFrom: RunJay <souki@ala.jp> (U0C5ENS477H)\nTime: 2026-10-02 16:08:00 JST\nMessage TS: " + st.pending.ts + "\n" + st.pending.text + "\n\n=== THREAD REPLIES (1 total) ===\n\n--- Reply 1 of 1 ---\nFrom: Claude <botuser-T0C6QF1151N-B0C5Y31TMLH@slack-bots.com> (U0C5W0A5D7C)\nTime: 2026-10-02 16:09:00 JST\nMessage TS: 1790930999.000001\n1. 阿婷｜Slack #alaco-ai-daily-tasks｜后台报告放到线上网站待办了，请确认\n2. 阿婷｜Drive 线上网站（ai）/待办｜新文件「ALA&CO后台报告」\n3. 无其他\nclaude-opus-5-5[1m] · <https://claude.ai/claude-in-slack/T0/C0/configure|Configure>\n" });
      else if (st.replies && st.replies[i.message_ts]) r = J({ messages: thread(i.message_ts).replace('(1 total)', '(' + (1 + st.replies[i.message_ts].length) + ' total)') + st.replies[i.message_ts].map((t, k) => '\n--- Reply ' + (k + 2) + ' ---\nFrom: RunJay <souki@ala.jp> (U0C5ENS477H)\nTime: 2026-10-02 16:10:00 JST\nMessage TS: 17909310' + k + '.000001\n' + t + '\n').join('') });
      else r = J({ messages: thread(i.message_ts) });
      break;
    }
    case 'slack_send_message': {
      const cid = { U0C6QF529A4: 'D0C5ZQBHPM2', U0C5W0A5D7C: 'D0C6QFJNR16' }[i.channel_id] || i.channel_id, n = st.seq++;
      if (i.thread_ts) { st.replies = st.replies || {}; (st.replies[i.thread_ts] = st.replies[i.thread_ts] || []).push(i.message); save(st); r = J({ result: 'Message sent' }); break; }
      const ts = '17909300' + (10 + n) + '.000100';
      st.extra[cid] = '=== Message from RunJay <souki@ala.jp> (U0C5ENS477H) at 2026-10-02 16:0' + (n % 10) + ':00 JST === \nMessage TS: ' + ts + '\n' + i.message + '\n*发送工具* <@U0C5W0A5D7C|Claude>\n\n' + (st.extra[cid] || '');
      if (cid === 'D0C6QFJNR16') st.pending = { ts, text: i.message, at: Date.now() };
      save(st); r = J({ result: 'Message sent' }); break;
    }
    case 'search_files': r = J({ files: search(st, i.query || '') }); break;
    case 'read_file_content': r = J(i.fileId === 'ROOT_SHEET' ? { fileContent: sheet, title: 't' } : { fileContent: 'Context Type: corpus_document\n任务：清理 TEST 商品\n负责人：阿婷\n交办人：RunJay\n\n进度：\n- 10/02 已清 6 件', title: 'x' }); break;
    case 'download_file_content': r = J({ content: b64(i.fileId === 'T1' ? report : '# 合同要点\n\n- 总价 69,000 元'), id: i.fileId, mimeType: 'text/markdown', title: 'x' }); break;
    case 'create_file': { const f = { id: 'NEW' + (st.seq++), title: i.title, mimeType: 'application/vnd.google-apps.document', parentId: i.parentId, modifiedTime: '2026-10-02T07:00:00Z', viewUrl: 'https://docs.google.com/document/d/new' }; st.added.push(f); save(st); r = J(f); break; }
    case 'update_file': { if (i.title && !i.parentId) { const o = driveFiles(st).find(f => f.id === i.fileId); if (o) { st.gone.push(o.id); st.added.push(Object.assign({}, o, { id: o.id + 'r', title: i.title })); save(st); r = J(Object.assign({}, o, { title: i.title })); } else { r = 'Error: not found'; err = true; } } else { r = 'Error: The caller does not have permission to move this file'; err = true; } break; }
    case 'copy_file': { const o = driveFiles(st).find(f => f.id === i.fileId); const f = Object.assign({}, o, { id: 'COPY' + (st.seq++), parentId: i.parentId, title: i.title || o.title }); st.added.push(f); save(st); r = J(f); break; }
    case 'trash_file': st.gone.push(i.fileId); save(st); r = J({}); break;
    case 'navigate': r = 'Navigated to ' + i.url; break;
    case 'admin_get': r = 'HTTP 200\n{"todo":{"toShip":1}}'; break;
    case 'admin_write': r = 'HTTP 200\n{}'; break;
    case 'get_page_text': r = 'ALA&CO 后台\n今日必办：待发货 1 · 咨询 1 · 退款待办 1'; break;
    case 'slack_get_file_upload_url': r = J({ upload_url: 'http://127.0.0.1:' + (process.env.FAKE_UPLOAD_PORT || '8899') + '/upload/' + Date.now(), file_id: 'F0FAKE' + (st.seq++) }); save(st); break;
    case 'slack_complete_file_upload': r = J({ ok: true, file: { id: i.file_id, title: i.title, permalink: 'https://x.slack.com/files/' + i.file_id } }); break;
    case 'search_threads': r = J({ resultCountEstimate: '2', threads: [{ id: 't1', messageCount: 1, messages: [{ date: '2026-10-02T22:43:37Z', labelIds: ['UNREAD', 'INBOX'], sender: 'no-reply@research.anthropic.com', snippet: 'Your feedback will help us make Claude better We&#39;d love your thoughts', subject: "We'd love your thoughts on Claude", viewUrl: 'https://mail.google.com/mail/#all/t1' }], viewUrl: 'https://mail.google.com/mail/#all/t1' }, { id: 't2', messageCount: 1, messages: [{ date: '2026-10-02T16:24:32Z', labelIds: ['UNREAD', 'INBOX'], sender: '"黄志龙" <huang@example.com>', snippet: '源码交接的事，下周可以', subject: '交接', viewUrl: 'https://mail.google.com/mail/#all/t2' }], viewUrl: 'https://mail.google.com/mail/#all/t2' }] }); break;
    case 'TodoWrite': r = J({ result: 'Todos have been modified successfully' }); break;
    case 'Edit': r = 'The file has been updated.'; break;
    case 'slack_add_reaction': { st.reactions = st.reactions || []; st.reactions.push([i.channel_id, i.message_ts, i.emoji]); save(st); r = J({ result: 'Reaction added' }); break; }
    default: r = 'unknown tool ' + short; err = true;
  }
  return [r, err];
}

/* ───── 主流程 ───── */
async function main() {
  if (flag('--output-format') === 'json') {     // 一次性提问（写汇总）
    let buf = '';
    process.stdin.setEncoding('utf8');
    for await (const d of process.stdin) buf += d;
    log('ASK ' + buf.length + ' chars');
    await sleep(300);
    out({ type: 'result', subtype: 'success', is_error: false, result: '## 要你回的\n- 阿婷在 #alaco-ai-daily-tasks 说「能看到」，不用回。\n## 新交来的未完成工作\n- ALA&CO后台报告_2026-10-01（线上网站/待办）：待发货 1 笔、待退款 1 笔。\n## 卡住的\n- 黄兄交接与尾款，截止 10/09。\n## 今天先做\n- 确认待发货那笔是不是测试单。', session_id: 'ask' });
    return;
  }
  const dataMode = /按清单调用/.test(flag('--system-prompt') || '');
  const sid = flag('--resume') || 'fake-' + Date.now();
  const P = 'mcp__claude_ai_';
  out({ type: 'system', subtype: 'init', session_id: sid, model: flag('--model') || 'claude-default', tools: ['Read', 'Bash', 'Edit', P + 'Slack__slack_read_channel', P + 'Slack__slack_send_message', P + 'Slack__slack_read_user_profile', P + 'Slack__slack_list_user_channels', P + 'Slack__slack_list_channel_members', P + 'Slack__slack_read_thread', P + 'Google_Drive__search_files', P + 'Google_Drive__read_file_content', P + 'Google_Drive__download_file_content', P + 'Google_Drive__create_file', P + 'Google_Drive__update_file', P + 'Google_Drive__copy_file', P + 'Google_Drive__trash_file', P + 'Gmail__search_threads'], mcp_servers: [{ name: 'claude.ai Slack', status: 'connected' }, { name: 'claude.ai Google Drive', status: 'connected' }, { name: 'claude.ai Gmail', status: 'connected' }] });
  const waiting = new Map();
  let n = 0, stopped = false;
  /* 对话进程（带 --resume 或没有 --no-session-persistence）把记录写到 transcripts/<会话>.jsonl，和真的 Claude Code 一样 */
  const persist = !has('--no-session-persistence');
  const TR = path.join(DIR, 'transcripts'); if (persist) fs.mkdirSync(TR, { recursive: true });
  rec = (o) => { if (!persist) return; try { fs.appendFileSync(path.join(TR, sid + '.jsonl'), JSON.stringify({ type: o.type, timestamp: new Date().toISOString(), sessionId: sid, message: o.message }) + '\n'); } catch {} };
  const ask = (name, input, id) => new Promise(res => { const rid = 'req_' + (++n); waiting.set(rid, res); out({ type: 'control_request', request_id: rid, request: { subtype: 'can_use_tool', tool_name: name, input, tool_use_id: id } }); });
  async function use(name, input, sub) {
    const id = 'toolu_' + T0.toString(36) + '_' + (++n);
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] }, parent_tool_use_id: null });
    const v = await ask(name, input, id);
    if (v.behavior !== 'allow') { out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: v.message || 'denied' }] } }); return [v.message, true]; }
    await sleep(250);
    const [r, err] = tool(name.split('__').pop(), v.updatedInput || input);
    out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: err, content: [{ type: 'text', text: r }] }] } });
    return [r, err];
  }
  async function sayText(t) {
    for (const piece of t.match(/[\s\S]{1,12}/g) || []) { if (stopped) return; out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: piece } }, parent_tool_use_id: null }); await sleep(40); }
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: t }] }, parent_tool_use_id: null });
  }
  const usage = { input_tokens: 12, cache_creation_input_tokens: 800, cache_read_input_tokens: 3000, output_tokens: 150 };
  const done = (text, err) => {
    const now = Math.floor(Date.now() / 1000);
    out({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', resetsAt: now + 3600, rateLimitType: 'five_hour', overageStatus: 'allowed', overageResetsAt: now + 86400 * 20, isUsingOverage: false, unifiedWindows: { five_hour: { utilization: 0.12, resetsAt: now + 3600 }, seven_day: { utilization: 0.34, resetsAt: now + 86400 * 3 } } } });
    return out({ type: 'result', subtype: 'success', is_error: !!err, result: text || '', session_id: sid, duration_ms: 1234, num_turns: 2, total_cost_usd: 0.0123, usage, modelUsage: { 'claude-fake': { inputTokens: 12, outputTokens: 150, cacheReadInputTokens: 3000, cacheCreationInputTokens: 800, costUSD: 0.0123 } } });
  };

  async function onUser(text) {
    stopped = false;
    rec({ type: 'user', message: { role: 'user', content: text } });
    if (dataMode) {
      /* 模型"照清单"调用：故意把参数改坏一点，看桥接程序会不会在批准时换回原文 */
      const calls = [...text.matchAll(/^\d+\. (\S+)\n\s+参数：(.*)$/gm)].map(m => ({ name: m[1], input: JSON.parse(m[2]) }));
      const blocks = calls.map(c => ({ type: 'tool_use', id: 'toolu_' + T0.toString(36) + '_' + (++n), name: c.name, input: c.input.message ? { ...c.input, message: '（模型改过的字）' } : c.input }));
      out({ type: 'assistant', message: { role: 'assistant', content: blocks }, parent_tool_use_id: null });
      await Promise.all(blocks.map(async b => {
        const v = await ask(b.name, b.input, b.id);
        await sleep(150 + Math.random() * 200);
        if (v.behavior !== 'allow') return out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: b.id, is_error: true, content: v.message }] } });
        const [r, err] = tool(b.name.split('__').pop(), v.updatedInput);
        out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: b.id, is_error: err, content: [{ type: 'text', text: r }] }] } });
      }));
      out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '完成' }] }, parent_tool_use_id: null });
      return done('完成');
    }
    log('CHAT ' + text.slice(0, 80));
    out({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'thinking' } }, parent_tool_use_id: null });
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '先看一下要做什么…' } }, parent_tool_use_id: null });
    await sleep(300);
    out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '先看一下要做什么，再决定用哪个工具。' }] }, parent_tool_use_id: null });
    if (/出错/.test(text)) return done('API Error: 500 something broke', true);
    if (/待办清单/.test(text)) {
      await sayText('我先列个清单。');
      await use('TodoWrite', { todos: [{ content: '看后台待发货', status: 'completed', activeForm: '看后台' }, { content: '整理咨询', status: 'in_progress', activeForm: '整理咨询' }, { content: '写周报', status: 'pending', activeForm: '写周报' }] });
      const [r, err] = await use('Edit', { file_path: '/Users/souki/Desktop/测试.md', old_string: '第一行\n第二行', new_string: '第一行\n第二行改了\n第三行' });
      await sayText(err ? '改文件被拒了。' : '改好了。');
      return done('清单列好了。');
    }
    if (/只读巡检/.test(text)) {
      await use('mcp__alaco__admin_get', { path: '/admin/dashboard' });
      const [r, err] = await use('mcp__alaco__admin_write', { method: 'POST', path: '/admin/orders/x/advance', body: {} });
      const md = '## 今日数字\n| 项目 | 数量 |\n|---|---|\n| 待发货 | 1（超时 1） |\n| 咨询未回 | 0 |\n| 退款待办 | 1 |\n## 要处理的\n- **WEB-#MTDL6M2X-1** 白露 ¥64,900，8/29 下单，拖了 34 天，建议今天发货或取消。\n- **WEB-#MTVJMS80-1** 退款待办 ¥13,200，建议标记已退款。\n## 新到\n无\n## 异常\n- 库存预警 15 件\n- 服务器报错 4 次' + (err ? '\n- （改数据的尝试被拒绝了，符合预期）' : '') + '\n## 今天先做\n1. 处理 WEB-#MTDL6M2X-1\n2. 退款 WEB-#MTVJMS80-1';
      out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: md }] }, parent_tool_use_id: null });
      return done(md);
    }
    if (/改文件|写文件/.test(text)) {
      await sayText('我来写这个文件。');
      const [r, err] = await use('Write', { file_path: '/Users/souki/Desktop/测试.md', content: '测试' });
      await sayText(err ? '没写：' + (r || '') : '写好了。');
    } else if (/邮件/.test(text)) {
      await sayText('我来发邮件。');
      const [r, err] = await use(P + 'Gmail__send_message', { to: ['a@b.c'], subject: '测试', body: '测试' });
      await sayText(err ? '没发：' + (r || '') : '发了。');
    } else if (/催|发/.test(text)) {
      await sayText('我来在频道里说一声。');
      const [r, err] = await use(P + 'Slack__slack_send_message', { channel_id: 'C0C5Y2QU7U1', message: '@阿婷 后台报告里的待发货请今天确认。' });
      await sayText(err ? '没有发：你没有同意。' : '已发到 #alaco-ai-daily-tasks。');
    } else if (/后台/.test(text)) {
      await sayText('我去后台看一下。');
      await use('mcp__claude-in-chrome__navigate', { url: 'https://alaco.ai/admin' });
      await use('mcp__claude-in-chrome__get_page_text', {});
      const [r, err] = await use('mcp__claude-in-chrome__computer', { action: 'left_click', coordinate: [100, 200], action_summary: '点开「订单」页' });
      await sayText(err ? '看到仪表盘为止，订单页你没让我点开。\n\n- 待发货 1\n- 咨询 1' : '## 后台现状\n\n| 项目 | 数量 |\n|---|---|\n| 待发货 | 1 |\n| 未回复咨询 | 1 |\n| 退款待办 | 1 |\n\n**最要紧**：WEB-#MTDL6M2X-1 下单已超过一个月。');
    } else if (/很久/.test(text)) {
      await sayText('这件事要做一会儿');
      for (let i = 0; i < 100 && !stopped; i++) await sleep(100);
      if (stopped) return done('');
      await sayText('做完了。');
    } else await sayText('今天先做三件：\n\n1. 确认待发货那一单\n2. 回复超时的咨询\n3. 黄兄交接清单');
    done('');
  }
  readline.createInterface({ input: process.stdin }).on('line', line => {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.type === 'control_response') { const r = m.response || {}, f = waiting.get(r.request_id); if (f) { waiting.delete(r.request_id); f(r.response || {}); } return; }
    if (m.type === 'control_request') {
      if (m.request && m.request.subtype === 'interrupt') { stopped = true; for (const f of waiting.values()) f({ behavior: 'deny', message: 'interrupted' }); waiting.clear(); }
      if (m.request && m.request.subtype === 'mcp_status') { const up = Date.now() - T0 > 1500; return out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: { mcpServers: ['claude.ai Slack', 'claude.ai Google Drive', 'claude.ai Gmail', 'alaco'].map(name => ({ name, status: up ? 'connected' : 'pending', tools: [] })) } } }); }
      return out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: {} } });
    }
    if (m.type === 'user') { const c = m.message.content; onUser(typeof c === 'string' ? c : c.map(b => b.text || '').join('')); }
  });
}
