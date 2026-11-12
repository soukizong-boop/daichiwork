/* 硬规则：Claude Code 每次用工具前跑一次（官方 PreToolUse 钩子）。不看人物、不看模式，碰到下面这些直接拒，并记进审计。
   只拦「做了就回不来」的事；日常读写、发消息、改后台由工作台的人物权限管。
   单独跑：echo '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}' | node hooks/guard.mjs */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HOME = os.homedir();
const P = s => String(s || '');
/* git rm 只是不再跟踪、不删文件：先换个名字，下面认 rm 的规则就不会把它当成删除 */
const C = s => P(s).replace(/\bgit((?:\s+-[-\w]+(?:[ =][^\s-]\S*)?)*)\s+rm\b/g, 'git$1 git_rm');
const RULES = [
  { tools: ['Bash'], test: i => rmBad(C(i.command)), why: '整目录删除（rm -r、find -delete 这类）' },
  { tools: ['Bash'], test: i => /(^|[\n;&|(`"']|\$\()\s*sudo\s+[-\w\/]/.test(P(i.command)), why: '用管理员权限（sudo）' },   /* 只认放在命令位置上的 sudo；grep "sudo" 这种不算 */
  { tools: ['Bash'], test: i => /\b(mkfs|diskutil\s+(erase|partition)|dd\s+if=)/i.test(P(i.command)), why: '格式化或覆盖磁盘' },
  { tools: ['Bash'], test: i => /\bchmod\s+(-R\s+)?([0-7]*7{3}\b|(a|ugo|o)\+[rwx]*w)/.test(P(i.command)), why: '把文件改成人人可写（chmod 777）' },
  { tools: ['Bash'], test: i => /\bgit\s+push\b[^|;&]*(--force|-f\b)/.test(P(i.command)) || /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f)/.test(P(i.command)), why: '强推或丢弃 git 历史' },
  { tools: ['Bash'], test: i => /\blaunchctl\s+(unload|bootout|remove)\b/.test(P(i.command)) && /dadi|alaco/i.test(P(i.command)), why: '停掉工作台自己的后台服务' },
  { tools: ['Bash'], test: i => /(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b/.test(P(i.command)), why: '下载脚本直接执行' },
  { tools: ['Bash'], test: i => /\bkill\s+-9\s+-1\b|:\(\)\s*\{\s*:\|:&\s*\};:/.test(P(i.command)), why: '杀光进程' },
  { tools: ['Bash'], test: i => /(^|[\s;&|])(>|>>)\s*~?\/?(\.ssh|\.aws|\.config\/gcloud|Library\/Keychains)\//.test(P(i.command)) || /\bsecurity\s+(delete|add)-/.test(P(i.command)), why: '动钥匙串或密钥目录' },
  { tools: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'], test: i => secretPath(P(i.file_path || i.notebook_path)), why: '改密钥、口令或工作台自己的数据文件' },
  { tools: ['Bash'], test: i => /(^|[\s;&|])(rm|mv|cp|tee|sed\s+-i|>+)\s[^;&|]*(\.env\b(?!\.(example|sample|template|dist)\b)|\/\.ssh\/|\/secret\b|id_rsa|\.pem\b|\.p8\b)/.test(C(i.command)), why: '用命令改密钥或口令文件' },   /* 工作台自己的 admin/slack/mail/state.json 在数据目录里，由「碰数据目录」那条管；别的项目里同名文件不拦 */
  { tools: ['Bash'], test: i => ownFileWrite(P(i.command)), why: '用命令改工作台自己的人物权限、硬规则或后台服务' },
  { tools: ['Read', 'Glob', 'Grep', 'NotebookRead'], test: i => dataPath(P(i.file_path || i.path || i.notebook_path)), why: '读工作台自己的数据文件（口令、密码、记录）' },
  { tools: ['Bash'], test: i => bashTouchesData(P(i.command)), why: '用命令碰工作台自己的数据目录' },
  { tools: ['mcp__alaco__admin_write'], test: i => (/^DELETE$/i.test(P(i.method)) && /\/admin\/(products|users|orders)\b/.test(adminPath(i.path))) || /\/admin\/(products|users|orders)\/[^\/]+\/(delete|remove|destroy)(\/|$)/.test(adminPath(i.path)), why: '在后台删商品、用户或订单（只能人工在后台做）' },
  { tools: ['mcp__alaco__admin_write'], test: i => /\/admin\/(settings|auth|accounts|backup|danger|purge|clear)/.test(adminPath(i.path)), why: '改后台的账号、设置或清空数据' },
];
const DATA_DIR = () => process.env.DADI_DATA || path.join(HOME, 'Library', 'Application Support', 'dadi-workbench');
/* 项目里的 config.json（人物权限）、hooks/guard.mjs（硬规则本身）、后台服务定义：命令里提到它们、又有写的动作就拒（读不拦） */
function ownFileWrite(cmd) {
  const s = cmd.replace(/\\(.)/g, '$1').replace(/["']/g, ''), root = process.env.DADI_ROOT || '';
  const WRITE = /(^|[\s;&|(`])(sed\s+-i|perl\s+-[a-z]*i|tee|cp|mv|rm|ln|truncate|install|rsync)(\s|$)|writeFile|appendFile|createWriteStream|open\([^)]*,\s*['"][wa]/;
  if (/launchagents\/ai\.alaco\.dadi-workbench\.plist/i.test(s) && (WRITE.test(s) || />{1,2}\s*[^\s;&|]*\.plist/i.test(s))) return true;
  if (!root) return false;
  const base = path.basename(root);
  const own = [root + '/config.json', root + '/hooks/guard.mjs', root + '/hooks'].some(p => s.includes(p)) || (s.includes(base) && /(^|[\s\/])(config\.json|hooks\/guard\.mjs|guard\.mjs)\b/.test(s));
  return own && (WRITE.test(s) || />{1,2}\s*[^\s;&|]*(config\.json|guard\.mjs|\/hooks\b)/.test(s));   /* 「2>/dev/null」这种不算写 */
}
const TMP = /^(\/private)?(\/tmp|\/var\/folders)\/|^\$\{?TMPDIR\}?\//;
/* 后台路径先归一（解码、去 query、小写），大小写和 %73 这种写法绕不过 */
const adminPath = p => { try { return decodeURIComponent(new URL(String(p || ''), 'http://x').pathname).toLowerCase(); } catch { return String(p || '').toLowerCase(); } };
function rmBad(cmd) {   /* rm -r：每个目标都得在临时目录里才放行；目标在别处、或拿不准（xargs、变量、find -exec、包在 bash -c 里、换个工具删）就拒 */
  for (const seg of cmd.split(/\s*(?:&&|\|\||;|\||\r?\n)\s*/)) {
    const m = /(?:^|[\s;&|(`"'])rm\s+([^\n]*)/.exec(seg); if (!m) continue;
    const args = m[1].split(/\s+/).filter(Boolean);
    if (!args.some(a => /^-[a-zA-Z]*[rR]/.test(a) || a === '--recursive')) continue;
    const targets = args.filter(a => !a.startsWith('-')).map(a => a.replace(/["'`)]/g, ''));
    if (!targets.length || targets.some(t => !TMP.test(t) || /(^|\/)\.\.(\/|$)/.test(t))) return true;
  }
  if (/\b(shutil\.rmtree|rmSync\s*\([^)]*recursive|fs\.rm\s*\([^)]*recursive|rimraf)\b|\brsync\b[^\n;&|]*--delete/.test(cmd)) return true;   /* 换个工具做整目录删除：目标不明，一样拒 */
  for (const m of cmd.matchAll(/\bfind\b([^\n;&|]*)\s-delete\b/g)) {   /* find … -delete：按名字删一类文件（-name .DS_Store）放行；不带名字条件、或名字是 * 的＝整棵树都删 */
    const nm = /\s-i?(name|path|regex)\s+(\S+)/.exec(m[1]);
    if (!nm || /^["']?\*["']?$/.test(nm[2])) return true;
  }
  return false;
}
function secretPath(p) {
  if (!p) return false;
  const orig = path.resolve(p.replace(/^~(?=$|\/)/, HOME)), full = orig.toLowerCase();
  if (dataPath(p)) return true;
  if (/\/library\/launchagents\/ai\.alaco\.dadi-workbench\.plist$/.test(full)) return true;   /* 工作台自己的后台服务定义 */
  if (/\/(config\.json|hooks\/guard\.mjs)$/.test(full)) {   /* 工作台自己的 config.json（人物权限）和硬规则本身：旁边有 server.mjs 的才算 */
    const dir = /\/hooks\/guard\.mjs$/.test(full) ? path.resolve(orig, '..', '..') : path.dirname(orig);
    if (fs.existsSync(path.join(dir, 'server.mjs'))) return true;
  }
  if (full.startsWith(path.join(HOME, '.claude').toLowerCase())) {   /* ~/.claude.json、~/.claude/、~/.claude-team/：登录与设置文件；技能、记忆这类子目录不管 */
    const rel = full.slice(HOME.length + 1);
    if (/(^|\/)(settings(\.local)?\.json|\.?credentials(\.json)?)$/.test(rel) || /^\.claude[^\/]*(\/[^\/]+)?\.json$/.test(rel)) return true;
  }
  /* 密钥、口令文件按路径段认（credentials、secrets/、aws_credentials、secret.json、*.pem/.p8/.p12/.key）；secretary_notes.md、credentials-policy.md、turkey 这种不算 */
  return /(^|\/)\.env(\.(?!(example|sample|template|dist)$)|$)|\/\.ssh\/|\/\.aws\/|\/\.gnupg\/|library\/keychains\/|(^|\/)(?:[^\/]*[._-])?(credentials?|secrets?)(?:\.[a-z0-9]+)?(\/|$)|id_rsa|id_ed25519|\.(pem|p8|p12|key)$/.test(full);
}
function dataPath(p) {   /* 工作台自己的数据目录（口令、密码、记录）；附件子目录 uploads 例外，那是存给模型读的 */
  if (!p) return false;
  const full = path.resolve(p.replace(/^~(?=$|\/)/, HOME)).toLowerCase(), data = DATA_DIR().toLowerCase();
  return (full === data || full.startsWith(data + path.sep)) && !full.startsWith(path.join(data, 'uploads').toLowerCase() + path.sep);
}
function bashTouchesData(cmd) {   /* 命令里碰到数据目录（绝对路径、~、$HOME、cd 进去再相对、通配符、从上级目录往下整个搜 都算），只放行 uploads/ 下且不含 .. 的；提 DADI_DATA 变量也算 */
  if (/DADI_DATA/.test(cmd)) return true;
  const o = cmd.replace(/\\(.)/g, '$1').replace(/["']/g, ''), s = o.toLowerCase(), data = DATA_DIR().toLowerCase(), home = HOME.toLowerCase();
  /* 只认完整路径；单独的「dadi-workbench」只在命令里也提到 Application Support 时才算（cd 进去再相对路径），别的项目、git 仓库同名不算 */
  const keys = [data, data.startsWith(home + '/') ? data.slice(home.length) : '', 'application support/dadi-workbench', ...(/application support|\/library\b/.test(s) ? ['dadi-workbench'] : [])].filter(Boolean);
  for (const k of keys) { let i = -1; while ((i = s.indexOf(k, i + 1)) >= 0) { const m = /^\/?uploads\/([^\s;&|)]*)/.exec(s.slice(i + k.length)); if (!m || /(^|\/)\.\.(\/|$)/.test(m[1])) return true; } }
  if (/application support\/(?:[^\/\s]*[*?]|dadi)/.test(s) || /\/library\/[^\/\s]*[*?]/.test(s) || /(^|[\s\/])dadi[\w-]*[*?[]/.test(s)) return true;   /* 通配符 */
  /* 从根目录、家目录、Library 往下整个搜会把令牌搜出来：目标不明按拒（ls 只有大写 -R 才是递归，-r 是倒序） */
  const REC = /(^|[\s;&|(])(grep\s+(-[a-zA-Z]*[rR]|--recursive)|rg\s|find\s|ls\s+-[a-zA-Z]*R|rsync\s|tar\s|zip\s+-[a-zA-Z]*r|du\s|fd\s)/;
  const WIDE = /(^|[\s=])(\/|~|\$home|\/users|\/users\/[^\/\s]+|~\/library|\$home\/library|\/users\/[^\/\s]+\/library|[^\s]*application support)\/?(\s|$)/;
  return REC.test(o) && WIDE.test(s);
}

export function judge(tool, input) {
  const short = String(tool || '').split('__').length > 1 && !/^mcp__alaco__/.test(tool) ? String(tool).split('__').pop() : String(tool || '');
  for (const r of RULES) if (r.tools.includes(tool) || r.tools.includes(short)) { try { if (r.test(input || {})) return r.why; } catch {} }
  return '';
}
export { RULES };
if (process.argv[1] && /guard\.mjs$/.test(process.argv[1])) {   /* 直接被 Claude Code 调用（不是被测试 import） */
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { buf += d; });
  process.stdin.on('end', () => {
    let why = '';
    let tool = '', input = {};
    try { const o = JSON.parse(buf || '{}'); tool = o.tool_name || ''; input = o.tool_input || {}; why = judge(tool, input); } catch {}
    if (process.env.DADI_HOOK_DEBUG) { try { fs.appendFileSync(process.env.DADI_HOOK_DEBUG, JSON.stringify({ at: new Date().toISOString(), argv: process.argv, data: process.env.DADI_DATA, tool, why, buf: buf.slice(0, 500) }) + '\n'); } catch {} }
    if (!why) return process.exit(0);
    try {
      const data = process.env.DADI_DATA || path.join(HOME, 'Library', 'Application Support', 'dadi-workbench');
      fs.mkdirSync(path.join(data, 'log'), { recursive: true });
      const mask = v => String(v).replace(/\b(xox[pbae]-[\w-]+|sk-[\w-]{10,}|ghp_\w{10,}|AIza[\w-]{20,})/g, '（已隐藏）').replace(/\b(bearer\s+)[\w.~+\/-]+/gi, '$1（已隐藏）').replace(/((?:password|passwd|pwd|token|secret|api[_-]?key)\s*[:=]\s*)(?!\/)[A-Za-z0-9._~+\/=-]{6,}/gi, '$1（已隐藏）');   /* 审计里口令、令牌打码（和 words.mjs 同一套） */
      const what = mask(tool === 'Bash' ? String(input.command || '').slice(0, 200) : String(input.file_path || input.path || input.notebook_path || '').slice(0, 200));
      fs.appendFileSync(path.join(data, 'log', 'audit.log'), JSON.stringify({ at: new Date().toISOString(), who: '硬规则', kind: 'hook', what: why, detail: `${tool}：${what}` }) + '\n');
    } catch {}
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `工作台硬规则：不允许${why}。这类事只能由人手动做，换别的办法也不行，直接告诉他。` } }));
    process.exit(0);
  });
}
