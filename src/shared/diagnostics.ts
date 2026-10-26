export interface Diagnostic {
  code: string;
  message: string;
  phase: string;
  context: Record<string, unknown>;
  retryPolicy: 'after_fix' | 'after_wait' | 'inspect_before_retry';
  sideEffects: 'none' | 'possible';
  suggestions: string[];
}

type DiagnosticContext = Record<string, unknown> & { phase?: string };
const RULES: Array<[RegExp, string, string, Diagnostic['retryPolicy'], string[]]> = [
  [/请求节点配置无效|请求 URL|请求头|GET \/ HEAD 请求/, 'HTTP_REQUEST_CONFIG_INVALID', 'configuration', 'after_fix', ['检查 HTTP/HTTPS URL、请求方法、JSON 请求头及变量；GET/HEAD 的请求体应为空。']],
  [/请求失败：HTTP|请求成功，但响应不是有效的 JSON/, 'HTTP_RESPONSE_INVALID', 'verification', 'inspect_before_retry', ['检查服务器状态码和实际响应类型。服务器已经处理请求，尤其是写入操作，不要自动重发。']],
  [/请求超时|网络请求失败/, 'HTTP_REQUEST_OUTCOME_UNKNOWN', 'execution', 'inspect_before_retry', ['检查链接、网络、服务器记录和超时配置；服务器可能已处理请求，确认结果后再决定是否重新运行。']],
  [/浏览器弹窗.*不匹配|弹窗来源不匹配/, 'BROWSER_DIALOG_MISMATCH', 'verification', 'inspect_before_retry', ['检查实际原生弹窗的类型、来源和完整文字；触发事件已经发送，不要重复点击。手动处理当前弹窗后再修改配置。']],
  [/浏览器弹窗节点等待超过/, 'BROWSER_DIALOG_TIMEOUT', 'verification', 'inspect_before_retry', ['检查触发控件是否正确、页面是否真的显示原生弹窗及 timeoutMs；事件仅发送一次。beforeunload 需要浏览器允许弹出。']],
  [/浏览器弹窗.*应答失败|浏览器弹窗实际关闭结果|多个浏览器弹窗/, 'BROWSER_DIALOG_RESPONSE_FAILED', 'verification', 'inspect_before_retry', ['检查页面和调试连接，核对实际弹窗应答及是否有人手动操作；不要自动重试触发事件。']],
  [/浏览器弹窗配置无效|弹窗节点必须|弹窗触发事件/, 'BROWSER_DIALOG_CONFIGURATION_INVALID', 'configuration', 'after_fix', ['配置 dialogType、action、触发控件和事件，timeoutMs 取 100..300000；alert 仅支持确定。']],
  [/上传结果可能未知|文件选择事件已触发/, 'UPLOAD_OUTCOME_UNKNOWN', 'verification', 'inspect_before_retry', ['文件选择事件可能已触发网站上传，请检查页面和服务端记录，不能自动重复提交。']],
  [/上传文件|文件上传|上传控件|上传需要|上传目标|上传 Selector|上传选区|上传文件路径/, 'UPLOAD_CONFIGURATION_OR_FILE_ERROR', 'input', 'after_fix', ['核对本机 MCP 服务、绝对路径、文件是否可读，以及文件框的 multiple/accept 配置；文件大小由目标网站和浏览器限制，不支持目录。']],
  [/运行已停止/, 'RUN_CANCELLED', 'execution', 'inspect_before_retry', ['用户已请求停止；已完成的操作不会回滚。检查页面现状后再决定是否重新运行。']],
  [/没有匹配项，转到失败出口/, 'QUERY_NO_MATCH', 'verification', 'after_fix', ['Query 已按 onEmpty=failure 进入失败分支；可连接 Output 返回业务未成功。这不表示点击或下载已发生。']],
  [/Output/, 'OUTPUT_RESOLUTION_FAILED', 'verification', 'after_fix', ['检查输出来源、变量、前序节点及字段路径；DOM 读取需匹配唯一节点或开启列表，属性必须存在。', 'ok 表示执行状态，businessOk 表示 Output 配置的业务结果；不能只凭输出步骤执行成功就判定业务成功。']],
  [/DataTable/, 'DATATABLE_CONVERSION_FAILED', 'verification', 'after_fix', ['使用 Selector 选择唯一的原生 table 或其单元格；检查表头配置和数据上限。', '只读取当前 DOM 已加载的行；分页或虚拟滚动需要先加载数据，再逐页提取。']],
  [/SMTP 配置|配置发送邮箱|邮件需要新版本机/, 'EMAIL_CONFIG_REQUIRED', 'configuration', 'after_fix', ['在发送邮件节点展开本机邮箱配置，保存 SMTP 主机、端口、账号和授权码；重启新版 MCP 共享桥接，不要将密码写入工作流。']],
  [/邮件发送.*未知|邮件桥接断开|邮件发送未能确认/, 'EMAIL_OUTCOME_UNKNOWN', 'execution', 'inspect_before_retry', ['检查发件记录和收件人是否已经收到；不要自动重发，以免重复发送。']],
  [/分页目标.*整数|分页目标.*超过总页|分页.*配置无效|分页当前页变量|分页终止页码/, 'PAGINATION_CONFIG_INVALID', 'input', 'after_fix', ['核对目标页、终止页变量、分页模式、页数和超时配置；页码必须为正整数。']],
  [/分页.*上限|分页遍历达到/, 'PAGINATION_LIMIT_EXCEEDED', 'verification', 'inspect_before_retry', ['尚未完成全部页；检查当前页和子流程副作用，再决定提高最大页数或减少范围。']],
  [/分页.*恢复|分页.*按钮|分页.*页码|分页数字|无法确认是否存在下一页|分页子流程/, 'PAGINATION_VERIFICATION_FAILED', 'verification', 'inspect_before_retry', ['读取实际 frame 内完整分页容器、当前页、总页数和上下页按钮；检查 verification.actual 与 evidence。', '翻页可能已发生，不要盲目重复整段流程；先确认当前页与每页子流程的业务副作用。']],
  [/截图期间.*变化|截图期间.*改变/, 'SCREENSHOT_PAGE_CHANGED', 'screenshot', 'after_fix', ['保持目标标签页、网址和窗口尺寸不变；确认当前页面后重新截图。']],
  [/截图区域|截图模式|截图页面尺寸|截图返回的图片格式/, 'SCREENSHOT_REGION_INVALID', 'input', 'after_fix', ['区域模式只指定唯一 CSS Selector 或合法文档坐标矩形；用 inspect_page_content 确认控件位置和页面。']],
  [/截图.*权限|captureVisibleTab|activeTab|<all_urls>/i, 'SCREENSHOT_PERMISSION_DENIED', 'screenshot', 'after_fix', ['确认 Page Agent 有该网站的截图权限；在目标网页点击扩展，再重新截图。受限页面不支持截图。']],
  [/截图超过传输|滚动受到限制|未滚动到截图/, 'SCREENSHOT_LIMIT_EXCEEDED', 'screenshot', 'after_fix', ['降低 scale、使用较小 region 或分段截图；嵌套滚动容器及虚拟列表不保证能拼接成完整文档。']],
  [/密钥|访问密钥/, 'WORKFLOW_KEY_INVALID', 'authorization', 'after_fix', ['确认 instanceId 与 workflowId 对应，使用该工作流的 key；不要猜测或回显密钥。']],
  [/实例 ID 不匹配/, 'INSTANCE_MISMATCH', 'connection', 'after_fix', ['调用 list_page_agent_instances，明确选择目标实例，不要自动切换到其他实例。']],
  [/expectedUpdatedAt|被其他客户端更新|已被修改/, 'WORKFLOW_REVISION_CONFLICT', 'editing', 'after_fix', ['调用 get_page_workflow 获取最新定义和 updatedAt，合并修改后再提交；不要盲目覆盖。']],
  [/工作流不存在|Script 不存在/, 'WORKFLOW_NOT_FOUND', 'configuration', 'after_fix', ['调用 list_page_workflows 核对当前实例中的工作流 ID。']],
  [/正在执行/, 'INSTANCE_BUSY', 'execution', 'after_wait', ['等待当前运行完成再执行；可以读取最近调试结果，不能同时操作同一页面。']],
  [/缺少必填参数/, 'INPUT_REQUIRED', 'input', 'after_fix', ['读取 Start.inputs，按参数名称传入 data；不要使用手动运行历史代替 MCP 参数。']],
  [/参数.*类型不正确/, 'INPUT_TYPE_MISMATCH', 'input', 'after_fix', ['读取 Start.inputs，将 data 中该字段改为声明的 JSON 类型。']],
  [/正则.*无效|正则.*错误/, 'QUERY_PATTERN_INVALID', 'configuration', 'after_fix', ['修正 Query.pattern 和 regexFlags；核对变量替换后的表达式。']],
  [/AI Provider 未完整配置/, 'AI_PROVIDER_NOT_CONFIGURED', 'configuration', 'after_fix', ['在插件“配置 AI”中填写 Base URL、Model 和 API Key，并测试连接；不要将供应商密钥写入工作流。']],
  [/Provider 请求失败|Provider 没有返回/, 'AI_PROVIDER_REQUEST_FAILED', 'execution', 'after_fix', ['检查 AI 供应商连接、模型名称、额度与响应格式。']],
  [/日历最终日期校验失败/, 'CALENDAR_VALUE_MISMATCH', 'verification', 'inspect_before_retry', ['检查 verification.actual.fields 中当前开始与结束输入框的值，并与 expected 比较；日期点击不等于区间选择成功。', '日期可能已被部分修改，不要自动重跑或重复提交；先检查当前控件焦点与区间状态。']],
  [/无法唯一关联当前日历|区间日历改变了未关联/, 'CALENDAR_FIELDS_UNRESOLVED', 'locating', 'inspect_before_retry', ['当前日历与起止输入框的关联不明确；读取控件容器、焦点、placeholder 或 aria-controls，避免使用其他日历的输入框。', '不能根据两次点击记录代替当前区间；核对实际字段后再修复，不要自动重跑。']],
  [/无法切换到.*日期输入框|日期输入框未获得焦点/, 'CALENDAR_FOCUS_FAILED', 'verification', 'inspect_before_retry', ['检查当前日历关联的开始/结束输入框是否唯一、可见、未禁用，及页面是否阻止聚焦。', '确认当前区间实际值后再修复；未确认结束框焦点时不会继续点击结束日期。']],
  [/目标日期.*无效|目标日期需要|结束日期不能早于/, 'CALENDAR_DATE_INVALID', 'input', 'after_fix', ['使用 YYYY-MM-DD 格式，核对开始/结束日期和传入变量，结束日期不得早于开始日期。']],
  [/日期 .*被页面禁用/, 'CALENDAR_DATE_DISABLED', 'verification', 'after_fix', ['日期格存在但页面禁用了该日期；检查账号、数据范围、维度等前置配置及日期限制，不要强制点击或修改 Selector。']],
  [/日历.*翻页|翻页.*年月|无法识别日历年月|日期格|未检测到选中/, 'CALENDAR_SELECTION_FAILED', 'verification', 'inspect_before_retry', ['读取日历容器及其当前年月、按钮和日期格；确认弹层位置及限制。', '可能已经发生翻页或日期点击，先检查当前日期与选择状态，再修复流程。']],
  [/节点不存在|引用的节点不存在/, 'NODE_NOT_FOUND', 'configuration', 'after_fix', ['调用 get_page_workflow 核对节点 ID；检查连线和 AI 输入引用。']],
  [/多个 frame|Frame 不存在或不唯一/, 'FRAME_AMBIGUOUS_OR_MISSING', 'locating', 'after_fix', ['调用 inspect_page_content(listFrames=true)，选择当前唯一 frame；导航后的 frameId 可能变化。']],
  [/目标 frame 文档与当前页面不匹配/, 'FRAME_DOCUMENT_MISMATCH', 'locating', 'after_fix', ['CSS 尚未进行定位；比较 requestedFrameUrl 和 currentFrames，不要只修改 Selector。', '手动选取应保存页面实时 URL；动态 processId 可通过 frameQueryKeys 排除，但活动 ID、站点及路径仍需匹配。']],
  [/无法.*定位节点|找不到|未找到|匹配 0 个|没有找到/, 'SELECTOR_NOT_FOUND', 'locating', 'after_fix', ['读取当前 frame 页面，确认 Start URL、前置操作、Selector 和弹层是否已出现。', '先查询 frame 清单，再读取目标文档；必要时修正 Selector 或增加等待，不能盲目重复点击。']],
  [/不可见|唯一且可见|尚未唯一可见|被遮挡/, 'TARGET_NOT_INTERACTABLE', 'locating', 'after_fix', ['检查弹层是否打开、是否命中隐藏副本以及遮挡；读取实际 frame 的可见节点后再修改流程。']],
  [/Selector.*无效|selector.*invalid|not a valid selector|SyntaxError/i, 'SELECTOR_INVALID', 'configuration', 'after_fix', ['使用有效 CSS Selector，不要传 XPath；先用 inspect_page_content 验证。']],
  [/URL 无效|只支持 http|不是可操作的|只能操作 http/, 'PAGE_URL_INVALID', 'navigation', 'after_fix', ['配置 Start.targetUrl 为 http/https 网址，或切换到允许插件操作的页面。']],
  [/登录|未到达目标 URL/, 'NAVIGATION_OR_LOGIN_FAILED', 'navigation', 'after_fix', ['核对当前网址与 Start.targetUrl，确认登录状态和 waitForLogin、超时配置。']],
  [/不允许插件读取|页面脚本/, 'CONTENT_SCRIPT_UNAVAILABLE', 'locating', 'after_fix', ['确认扩展有目标站点权限，刷新网页并重新加载插件；检查目标 frame 是否为受限页面。']],
  [/超时|中断|断开|没有返回执行结果/, 'EXECUTION_OUTCOME_UNKNOWN', 'execution', 'inspect_before_retry', ['操作可能已经发生，先读取页面及 get_page_debug_result 确认实际状态，再决定是否重试；不要自动重复提交。']],
  [/校验|预期|验证|实际/, 'POSTCONDITION_FAILED', 'verification', 'inspect_before_retry', ['查看 verification.expected、actual、evidence，读取当前页面确认真实状态；修正节点配置或后置等待。']],
];

export function diagnose(error: unknown, context: DiagnosticContext = {}): Diagnostic {
  const existing = (error as { diagnostic?: Diagnostic } | null)?.diagnostic;
  if (existing) return { ...existing, context: { ...context, ...existing.context } };
  const message = error instanceof Error ? error.message : String(error);
  const rule = /操作结果可能未知/.test(message)
    ? RULES.find(([, code]) => code === 'EXECUTION_OUTCOME_UNKNOWN')
    : RULES.find(([pattern]) => pattern.test(message));
  const phase = context.phase ?? rule?.[2] ?? 'execution';
  const field = /等待时长/.test(message) ? 'durationMs' : /事件/.test(message) ? 'event' : /页面目标|Selector/.test(message) ? 'target' : /输入参数/.test(message) ? 'inputs' : /位置/.test(message) ? 'position' : /循环配置/.test(message) ? 'items' : undefined;
  const details = { ...context, ...(field && phase === 'validation' ? { field, path: context.path ? `${context.path}.${field}` : field } : {}) };
  return {
    code: rule?.[1] ?? (phase === 'validation' ? 'WORKFLOW_INVALID' : 'INTERNAL_ERROR'), message, phase,
    context: details, retryPolicy: rule?.[3] ?? 'after_fix',
    sideEffects: context.actionDispatched === false || ['authorization', 'configuration', 'validation', 'input', 'editing', 'connection'].includes(phase) ? 'none' : 'possible',
    suggestions: rule?.[4] ?? ['核对出错节点及其配置，读取工作流定义和当前页面；保留错误码与运行 ID 供进一步调试。'],
  };
}

export function diagnosticError(error: unknown, context: DiagnosticContext): Error & { diagnostic: Diagnostic } {
  const diagnostic = diagnose(error, context);
  return Object.assign(new Error(diagnostic.message), { diagnostic });
}
