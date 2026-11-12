// 给代表看的「明文」：把工具名、参数、后台路径翻成中文。纯函数，没有副作用，方便单独测试。
const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; };
const MCP_WORDS = {
  slack_send_message: 'Slack：发消息', slack_send_message_draft: 'Slack：存草稿', slack_schedule_message: 'Slack：定时发消息', slack_read_channel: 'Slack：读消息', slack_read_thread: 'Slack：读回复',
  slack_list_user_channels: 'Slack：列频道', slack_search_public_and_private: 'Slack：搜索', slack_search_public: 'Slack：搜索', slack_search_channels: 'Slack：找频道', slack_search_users: 'Slack：找人', slack_read_user_profile: 'Slack：看资料', slack_list_channel_members: 'Slack：看成员', slack_add_reaction: 'Slack：点表情', slack_get_file_upload_url: 'Slack：准备上传文件', slack_complete_file_upload: 'Slack：发文件',
  search_files: 'Drive：找文件', read_file_content: 'Drive：读文件', download_file_content: 'Drive：读文件', create_file: 'Drive：建文件', update_file: 'Drive：改文件', copy_file: 'Drive：复制文件', trash_file: 'Drive：放进回收站', share_file: 'Drive：分享文件',
  search_threads: 'Gmail：搜邮件', get_thread: 'Gmail：读邮件', create_draft: 'Gmail：存草稿', send_message: 'Gmail：发邮件', reply: 'Gmail：回复邮件', forward: 'Gmail：转发邮件', trash_thread: 'Gmail：删邮件', trash_message: 'Gmail：删邮件',
  list_events: '日历：看日程', create_event: '日历：建日程', update_event: '日历：改日程', delete_event: '日历：删日程',
  admin_get: '后台：读数据', admin_write: '后台：改数据', admin_upload: '后台：传图片', product_schema: '商品模版：读字段表', product_load: '商品模版：读现状', draft_put: '商品模版：存商品稿', list_photos: '本机：列照片', tpl_result: '模版：交回结果', tpl_rule_add: '模版：收进口径',
  navigate: '浏览器：打开网页', read_page: '浏览器：看页面', get_page_text: '浏览器：读页面', find: '浏览器：找元素', computer: '浏览器：操作页面', form_input: '浏览器：填表', javascript_tool: '浏览器：运行脚本', tabs_context_mcp: '浏览器：看标签页', tabs_create_mcp: '浏览器：开标签页',
  slack_create_canvas: 'Slack：建画布', slack_update_canvas: 'Slack：改画布', slack_read_canvas: 'Slack：读画布', slack_create_list: 'Slack：建清单', slack_add_list_record: 'Slack：加清单条目', slack_update_list: 'Slack：改清单', slack_update_list_record: 'Slack：改清单条目', slack_read_list: 'Slack：读清单', slack_create_conversation: 'Slack：建频道', slack_get_reactions: 'Slack：看表情反应', slack_read_file: 'Slack：读文件', slack_search_emojis: 'Slack：找表情',
  get_message: 'Gmail：读邮件', get_draft: 'Gmail：读草稿', list_drafts: 'Gmail：列草稿', update_draft: 'Gmail：改草稿', delete_draft: 'Gmail：删草稿', untrash_thread: 'Gmail：恢复邮件', untrash_message: 'Gmail：恢复邮件', list_labels: 'Gmail：列标签', label_message: 'Gmail：加标签', label_thread: 'Gmail：加标签', unlabel_message: 'Gmail：去掉标签', unlabel_thread: 'Gmail：去掉标签', update_message_labels: 'Gmail：改标签', create_label: 'Gmail：建标签', update_label: 'Gmail：改标签名', delete_label: 'Gmail：删标签',
  mark_message_spam: 'Gmail：标为垃圾邮件', mark_thread_spam: 'Gmail：标为垃圾邮件', unmark_message_spam: 'Gmail：取消垃圾邮件', unmark_thread_spam: 'Gmail：取消垃圾邮件', apply_sensitive_message_label: 'Gmail：标为敏感', apply_sensitive_thread_label: 'Gmail：标为敏感',
  list_calendars: '日历：列日历', get_event: '日历：看一条日程', search_events: '日历：找日程', suggest_time: '日历：找空档', respond_to_event: '日历：回复邀请',
  get_file_metadata: 'Drive：看文件信息', get_file_permissions: 'Drive：看文件权限', list_recent_files: 'Drive：最近的文件',
  read_console_messages: '浏览器：看控制台', read_network_requests: '浏览器：看网络请求', list_connected_browsers: '浏览器：看已连的浏览器', tabs_close_mcp: '浏览器：关标签页', resize_window: '浏览器：调窗口', gif_creator: '浏览器：录动图', upload_image: '浏览器：传图片', file_upload: '浏览器：上传文件', switch_browser: '浏览器：切换浏览器', select_browser: '浏览器：选浏览器', shortcuts_list: '浏览器：看快捷操作', shortcuts_execute: '浏览器：快捷操作',
};
/* 口令、令牌不进卡片和审计：按字段名、按值的样子都认 */
const SECRET_KEY = /^(password|passwd|pass|pwd|secret|client_secret|token|access_token|refresh_token|id_token|api[_-]?key|authorization|cookie|otp)$|[_-](password|passwd|secret|token|api[_-]?key)$/i;   /* passport_no、bypass_reason、token_count 这种不算 */
const mask = v => String(v == null ? '' : v).replace(/\b(xox[pbae]-[\w-]+|sk-[\w-]{10,}|ghp_\w{10,}|AIza[\w-]{20,})/g, '（已隐藏）').replace(/\b(bearer\s+)[\w.~+\/-]+/gi, '$1（已隐藏）').replace(/((?:password|passwd|pwd|token|secret|api[_-]?key)\s*[:=]\s*)(?!\/)[A-Za-z0-9._~+\/=-]{6,}/gi, '$1（已隐藏）');   /* 只认像口令的值（6 个以上英数符号、不是路径）；「token: 是什么意思」不动 */
const ACTS = { left_click: '点击', right_click: '右键点击', double_click: '双击', triple_click: '三击', type: '输入文字', key: '按键', left_click_drag: '拖动', screenshot: '截图', scroll: '滚动', zoom: '放大看', wait: '等待', hover: '悬停', scroll_to: '滚动' };
/* 给代表看的说明一律写成明文：字段名、后台路径、Drive 查询语句都翻成中文，不给他看 JSON */
const FIELD_WORDS = { channel_id: '频道', message_ts: '那条消息', thread_ts: '回复的那条', limit: '最多', query: '条件', message: '内容', fileId: '文件', parentId: '文件夹', title: '名字', textContent: '内容', to: '收件人', subject: '主题', body: '正文', cc: '抄送', path: '接口', method: '方式', status: '状态', note: '备注', reason: '原因', text: '内容', carrier: '承运商', tracking_no: '运单号', amount: '金额', amount_jpy: '金额', dir: '方向', by: '经手人', page: '第几页', per: '每页', flt: '筛选', q: '关键词', pageSize: '最多', response_format: '格式', include_bots: '含机器人', types: '类型', exclude_archived: '不含已归档', filters: '范围', after: '之后', sort: '排序', sort_dir: '顺序', include_context: '含上下文', excludeContentSnippets: '不带摘要', view: '视图', includeTrash: '含回收站', summary: '标题', start: '开始', end: '结束', attendees: '参加者', description: '说明', location: '地点', action_summary: '动作', url: '网址' };
const ADMIN_WORDS = [[/^\/admin\/dashboard/, '仪表盘'], [/^\/admin\/orders\/([^/?]+)\/ship/, '登记发货（订单 $1）'], [/^\/admin\/orders\/([^/?]+)\/advance/, '推进订单状态（订单 $1）'], [/^\/admin\/orders\/([^/?]+)/, '订单 $1'], [/^\/admin\/orders.*flt=pending/, '待发货订单'], [/^\/admin\/orders/, '订单列表'],
  [/^\/admin\/inquiries\/([^/?]+)\/thread/, '记录咨询回复（$1）'], [/^\/admin\/inquiries\/([^/?]+)\/status/, '改咨询状态（$1）'], [/^\/admin\/inquiries/, '顾客咨询'], [/^\/admin\/returns/, '退货'], [/^\/admin\/refund-tasks\/([^/]+)\/([^/?]+)\/done/, '标记已退款（$2）'], [/^\/admin\/refund-tasks/, '退款待办'],
  [/^\/admin\/new-arrivals/, '新到库存'], [/^\/admin\/sensitive-pending/, '待确认的敏感操作'], [/^\/admin\/audit\/([^/?]+)\/ack/, '确认已阅（$1）'], [/^\/admin\/audit/, '操作记录'], [/^\/admin\/store\/refund-pending/, '店铺退款待批'], [/^\/admin\/store\/refunds\/([^/?]+)\/(approve|reject)/, (m, id, a) => (a === 'approve' ? '批准' : '驳回') + '店铺退款（' + id + '）'],
  [/^\/admin\/transfer-requests\/([^/?]+)\/(approve|reject)/, (m, id, a) => (a === 'approve' ? '批准' : '驳回') + '调拨（' + id + '）'], [/^\/admin\/transfer-requests/, '调拨申请'], [/^\/admin\/purchase\/nav-badges/, '各区角标数字'], [/^\/admin\/products/, '商品'], [/^\/admin\/customers/, '顾客'], [/^\/admin\/purchase/, '采购'], [/^\/admin\/store/, '店铺'], [/^\/admin\/reports?/, '报表'], [/^\/admin\/settings/, '设置']];
const adminWord = p => { const q = String(p || ''); for (const [re, w] of ADMIN_WORDS) { const m = re.exec(q); if (m) return typeof w === 'function' ? w(...m) : q.replace(re, w).replace(/\?.*$/, ''); } return '后台 ' + q; };
const driveQuery = q => String(q || '').replace(/parentId\s*=\s*'[^']*'/g, '某个文件夹里').replace(/title contains '([^']*)'/g, '名字含「$1」').replace(/fullText contains '([^']*)'/g, '内容含「$1」').replace(/mimeType\s*=\s*'[^']*folder'/g, '只要文件夹').replace(/\s+or\s+/g, '、').replace(/\s+and\s+/g, '且');
const plainInput = input => Object.entries(input || {}).filter(([k, v]) => v !== undefined && v !== null && v !== '' && typeof v !== 'object').map(([k, v]) => `${FIELD_WORDS[k] || k.replace(/_/g, ' ')}：${SECRET_KEY.test(k) ? '（已隐藏）' : clip(mask(v), 160)}`).join('\n');
function describe(name, input) {
  input = input || {};
  const j = () => plainInput(input);
  if (name === 'Bash') return { label: '运行命令', detail: clip(input.command, 2000) };   /* 确认卡上照原样显示要跑的命令（你要看全了才点允许）；写进审计时由 server 打码 */
  if (name === 'Read') return { label: '读文件', detail: String(input.file_path || '') };
  if (name === 'Edit') return { label: '改文件', detail: `${input.file_path || ''}\n把：${clip(input.old_string, 400)}\n改成：${clip(input.new_string, 400)}` };
  if (name === 'Write') return { label: '写文件', detail: `${input.file_path || ''}（${String(input.content || '').length} 字）\n${clip(input.content, 600)}` };
  if (name === 'Glob') return { label: '找文件', detail: String(input.pattern || '') };
  if (name === 'Grep') return { label: '搜内容', detail: String(input.pattern || '') };
  if (name === 'WebSearch') return { label: '上网搜', detail: String(input.query || '') };
  if (name === 'WebFetch') return { label: '上网读', detail: String(input.url || '') };
  if (name === 'Task' || name === 'Agent') return { label: '派子任务', detail: clip(input.description || input.prompt, 200) };
  if (name === 'TodoWrite' || name.startsWith('Task')) return { label: '记待办', detail: '' };
  if (name === 'ToolSearch') return { label: '找工具', detail: String(input.query || '') };
  if (name === 'Skill') return { label: '用技能', detail: String(input.skill || '') };
  if (name.startsWith('mcp__')) {
    const short = name.split('__').pop(), label = MCP_WORDS[short] || name.replace(/^mcp__/, '').replace(/__/g, '：');
    if (short === 'slack_send_message') return { label, detail: `发到 ${input.channel_id || ''}${input.thread_ts ? '（回复那条）' : ''}\n${input.message || ''}` };
    if (short === 'slack_read_channel') return { label, detail: `${input.channel_id || ''} 最近 ${input.limit || 25} 条` };
    if (short === 'slack_read_thread') return { label, detail: `${input.channel_id || ''} 里某条消息下面的回复` };
    if (short === 'slack_search_public_and_private' || short === 'slack_search_public') return { label, detail: input.query ? `关键词「${input.query}」` : '最近有新消息的会话' };
    if (short === 'slack_list_channel_members') return { label, detail: `${input.channel_id || ''} 的成员` };
    if (short === 'slack_search_channels') return { label, detail: input.query ? `名字含「${input.query}」的频道` : '列频道' };
    if (short === 'slack_search_users') return { label, detail: input.query ? `找「${input.query}」` : '找人' };
    if (short === 'slack_read_user_profile') return { label, detail: input.user_id ? `${input.user_id} 的资料` : '我的资料' };
    if (short === 'slack_get_reactions') return { label, detail: '看一条消息的表情反应' };
    if (short === 'get_thread' || short === 'get_message') return { label, detail: '读一封邮件的正文' };
    if (short === 'list_events' || short === 'search_events') return { label, detail: [input.timeMin ? '从 ' + String(input.timeMin).slice(0, 10) : '', input.timeMax ? '到 ' + String(input.timeMax).slice(0, 10) : '', input.query ? '关键词「' + input.query + '」' : ''].filter(Boolean).join(' ') || '最近的日程' };
    if (short === 'create_event' || short === 'update_event') return { label, detail: [input.summary || input.title || '', String(input.start || input.startTime || '').slice(0, 16)].filter(Boolean).join(' · ') };
    if (short === 'get_file_metadata' || short === 'get_file_permissions') return { label, detail: `文件 ${input.fileId || ''}` };
    if (short === 'list_recent_files') return { label, detail: '最近的文件' };
    if (short === 'slack_add_reaction') return { label, detail: `在 ${input.channel_id || ''} 的一条消息上点 :${String(input.emoji || input.emoji_name || input.name || '').replace(/^:|:$/g, '')}:` };
    if (short === 'search_files') return { label, detail: driveQuery(input.query) };
    if (short === 'read_file_content' || short === 'download_file_content') return { label, detail: `文件 ${input.fileId || ''}` };
    if (short === 'update_file') return { label, detail: [input.title ? `改名为「${input.title}」` : '', input.parentId ? '移到另一个文件夹' : ''].filter(Boolean).join('，') || `文件 ${input.fileId || ''}` };
    if (short === 'copy_file') return { label, detail: `复制一份${input.title ? '为「' + input.title + '」' : ''}` };
    if (short === 'trash_file') return { label, detail: `文件 ${input.fileId || ''}` };
    if (short === 'search_threads') return { label, detail: input.query ? `条件「${input.query}」` : '最近的邮件' };
    if (short === 'admin_get') return { label, detail: adminWord(input.path) };
    if (short === 'product_load') return { label, detail: `款号 ${input.slug || ''}` };
    if (short === 'draft_put') return { label, detail: `款号 ${input.slug || ''}${input.form && input.form.name ? '：' + input.form.name : ''}` };
    if (short === 'list_photos') return { label, detail: String(input.dir || '') };
    if (short === 'product_schema') return { label, detail: '字段表・枚举・默认值・分类' };
    if (short === 'tpl_result') return { label, detail: `模版 ${input.no || ''}：${String(input.title || '').slice(0, 80)}` };
    if (short === 'tpl_rule_add') return { label, detail: `模版 ${input.no || ''}：\n${(Array.isArray(input.rules) ? input.rules : [input.rules]).map(x => '・' + String(x || '')).join('\n').slice(0, 600)}` };
    if (short === 'admin_upload') return { label, detail: String(input.path || '').split('/').slice(-2).join('/') };
    if (short === 'admin_write') { const b = plainInput(input.body || {}); return { label, detail: adminWord(input.path) + (b ? '\n' + b : '') }; }
    if (short === 'computer') return { label: '浏览器：' + (ACTS[input.action] || input.action || '操作'), detail: clip(input.action_summary || mask(input.text) || (input.coordinate ? '位置 ' + input.coordinate : ''), 300) };
    if (short === 'navigate') return { label, detail: String(input.url || '') };
    if (short === 'form_input') return { label, detail: clip(input.action_summary || mask(input.value), 300) };
    if (short === 'javascript_tool') return { label, detail: clip(input.text, 600) };
    if (short === 'create_file') return { label, detail: `${input.title || ''}\n${clip(input.textContent, 400)}` };
    if (short === 'create_draft' || short === 'send_message' || short === 'reply') return { label, detail: `收件人：${[].concat(input.to || []).join('、')}\n主题：${input.subject || ''}\n${clip(input.body, 500)}` };
    return { label, detail: j() };
  }
  return { label: name, detail: j() };
}

export { describe, adminWord, driveQuery, plainInput, mask, MCP_WORDS, FIELD_WORDS };
