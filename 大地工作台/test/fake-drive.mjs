// 仅供本地测试：在一个临时文件夹里搭一个假的 Google Drive 挂载（两个共享硬盘），
// 文件夹和文件都打上和真 Drive 一样的扩展属性编号（com.google.drivefs.item-id#S），编号和替身 Claude 里的一致。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const F = 'application/vnd.google-apps.folder';
export const SECS = { W: '12xHB_cq1ik-GMke0FmWN_UJ_dMUJapjH', S: '1K9_NLY7cijVDiIRE_WJQV_N5iVgRM6aL', A: '195nXM1gwDtuVPzw-YIMPOH7LCP4Uvfrd' };
export const tag = (p, id) => { try { execFileSync('xattr', ['-w', 'com.google.drivefs.item-id#S', id, p], { stdio: 'ignore' }); return true; } catch { return false; } };
export function makeMount(root) {
  const task = path.join(root, '大地 AI 工作任务'), arch = path.join(root, 'ALA&CO已经完成的工作资料');
  const mk = (p, id) => { fs.mkdirSync(p, { recursive: true }); tag(p, id); return p; };
  const wf = (p, id, text) => { fs.writeFileSync(p, text, 'utf8'); tag(p, id); return p; };
  mk(task, '0AHH51Ee7djQEUk9PVA'); mk(arch, '0APz6V6jwaRMUUk9PVA');
  wf(path.join(task, '大地_任务总表.gsheet'), 'ROOT_SHEET', JSON.stringify({ doc_id: 'ROOT_SHEET', url: 'https://docs.google.com/spreadsheets/d/ROOT_SHEET/edit' }));
  const names = { W: '线上网站（ai）', S: '店铺（ai）', A: '公司行政（ai）' };
  for (const k of ['W', 'S', 'A']) { const sec = mk(path.join(task, names[k]), SECS[k]); ['待办', '进行中', '等外部', '已完成'].forEach((s, i) => mk(path.join(sec, s), `ST_${k}_${i}`)); }
  wf(path.join(task, names.W, '待办', 'ALA&CO后台报告_2026-10-01.md'), 'T1', '# ALA&CO 后台报告（2026-10-01）\n\n待发货 1、超时咨询 1。\n');
  const t2 = mk(path.join(task, names.W, '等外部', '黄兄交接与尾款_截止2026-10-09'), 'T2');
  wf(path.join(t2, '合同要点.md'), 'T2a', '任务：黄兄交接\n负责人：Souki\n');
  mk(path.join(task, names.S, '等外部', 'mospace合作合同_等姚总回复'), 'T3');
  mk(path.join(task, names.A, '已完成', '公司增资_2026-04'), 'T4');
  wf(path.join(task, names.W, '进行中', '2026-10-02_清理 TEST 商品_阿婷.gdoc'), 'T5', JSON.stringify({ doc_id: 'T5', url: 'https://docs.google.com/document/d/T5/edit' }));
  wf(path.join(arch, '文件放置清单_20260929.md'), 'ARCH_LIST', '# 文件放置清单\n');
  mk(path.join(arch, '01_法务'), 'ARCH_LAW');
  return root;
}
export const xattrWorks = () => { const p = fs.mkdtempSync(path.join(require_tmp(), 'dadi-x-')); const ok = tag(p, 'x'); fs.rmSync(p, { recursive: true, force: true }); return ok; };
function require_tmp() { return process.env.TMPDIR || '/tmp'; }
