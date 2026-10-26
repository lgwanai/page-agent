import { EmailSettings } from './EmailSettings';
import { FileDownloads } from './FileDownloads';
import { OutputInspector } from './OutputInspector';
import { REQUEST_METHODS } from '@/shared/request';
import {
  allowedEventsForTarget, createId, EVENT_LABELS, NODE_KIND_LABELS, NODE_KIND_ENGLISH, START_INPUT_TYPE_LABELS, type ActionDefinition,
  type AiInputBinding, type DomQuery, type DomQueryMatch, type EventDefinition, type PageTarget, type RunResult, type StartInputDeclaration, type StartInputType, type WorkflowNode,
} from '@/types/workflow';

export function NodeInspector({ node, nodes, actions, onChange, onDelete, onRun, onClose, onPickAiSelector, onPickQueryScope, onPickScreenshotRegion, lastRun, notify }: {
  node: WorkflowNode | undefined;
  nodes: WorkflowNode[];
  actions: ActionDefinition[];
  onChange: (node: WorkflowNode) => void;
  onDelete: () => void;
  onRun: () => void;
  onClose: () => void;
  onPickAiSelector: () => void;
  onPickQueryScope: () => void;
  onPickScreenshotRegion?: () => void;
  lastRun: RunResult | null;
  notify: (message: string) => void;
}) {
  if (!node) return <aside className="node-inspector empty-inspector"><strong>节点设置</strong><p>在画布中选择节点编辑属性。每张执行卡片都有成功和失败出口，连接后即形成顺序逻辑。</p></aside>;
  const updateName = (name: string) => {
    if (nodes.some((item) => item.id !== node.id && item.name === name)) return notify(`节点名称「${name}」已存在`);
    onChange(node.kind === 'dom' || node.kind === 'dialog' || node.kind === 'query' ? { ...node, name, target: { ...node.target, name } } : { ...node, name });
  };
  const updateQuery = (patch: Partial<DomQuery>) => {
    if (node.kind === 'query') onChange({ ...node, query: { ...node.query, ...patch } });
  };
  const queryStep = node.kind === 'query' ? lastRun?.steps.slice().reverse().find((step) => step.nodeId === node.id) : undefined;
  const queryMatches = queryStep?.ok && Array.isArray(queryStep.data) ? queryStep.data as DomQueryMatch[] : undefined;
  const updateEvent = (patch: Partial<EventDefinition>) => {
    if (node.kind !== 'dom' && node.kind !== 'dialog' && node.kind !== 'ai') return;
    onChange({ ...node, event: { ...node.event, ...patch } });
  };
  const addNodeInput = () => {
    if (node.kind !== 'ai') return;
    const input: AiInputBinding = { id: createId('input'), name: `节点输入${node.inputs.length + 1}`, type: 'node', sourceNodeId: nodes.find((item) => item.id !== node.id)?.id };
    onChange({ ...node, inputs: [...node.inputs, input] });
  };
  const addLiteralInput = () => {
    if (node.kind !== 'ai') return;
    const input: AiInputBinding = { id: createId('input'), name: `文本输入${node.inputs.length + 1}`, type: 'literal', value: '' };
    onChange({ ...node, inputs: [...node.inputs, input] });
  };
  const updateInput = (id: string, patch: Partial<AiInputBinding>) => {
    if (node.kind !== 'ai') return;
    onChange({ ...node, inputs: node.inputs.map((input) => input.id === id ? { ...input, ...patch } : input) });
  };
  const addStartInput = () => {
    if (node.kind !== 'start') return;
    const name = `参数${node.inputs.length + 1}`;
    const input: StartInputDeclaration = { id: createId('start-input'), name, type: 'string', required: false, description: '' };
    onChange({ ...node, inputs: [...node.inputs, input] });
  };
  const updateStartInput = (id: string, patch: Partial<StartInputDeclaration>) => {
    if (node.kind !== 'start') return;
    if (patch.name !== undefined && node.inputs.some((input) => input.id !== id && input.name === patch.name)) {
      notify(`输入参数「${patch.name}」已存在`);
      return;
    }
    onChange({
      ...node,
      inputs: node.inputs.map((input) => {
        if (input.id !== id) return input;
        return { ...input, ...patch };
      }),
    });
  };
  return <aside className="node-inspector">
    <div className="inspector-head"><div><strong>{NODE_KIND_LABELS[node.kind]}</strong><span lang="en">{NODE_KIND_ENGLISH[node.kind]}</span><span>{node.id}</span></div><div><button className="icon-btn" title="运行节点" onClick={onRun}>▶</button>{node.kind !== 'start' && <button className="icon-btn danger" title="删除节点" onClick={onDelete}>×</button>}<button className="icon-btn inspector-close" title="收起属性" onClick={onClose}>⌄</button></div></div>
    <label>节点名称<input value={node.name} onChange={(event) => updateName(event.target.value)} /><small>后续节点可使用 {'{{节点名称}}'} 引用输出；兼容 {'{{节点名称.output}}'}，名称必须唯一。</small></label>

    {node.kind === 'start' && <>
      <div className="input-section start-input-section">
        <div className="input-title"><strong>MCP JSON 输入</strong><span>{node.inputs.length} 项</span></div>
        <div className="input-hint">像设计表单一样声明参数。MCP JSON 中名称相同的字段会自动映射，后续节点可直接使用 <code>{'{{参数名}}'}</code>。</div>
        {node.inputs.map((input) => <div className="ai-input-card" key={input.id}>
          <div className="ai-input-head"><span className="input-type type-json">参数</span><input value={input.name} placeholder="例如：客户名称" onChange={(event) => updateStartInput(input.id, { name: event.target.value })} /><button className="icon-btn danger" title="删除输入" onClick={() => onChange({ ...node, inputs: node.inputs.filter((item) => item.id !== input.id) })}>×</button></div>
          <div className="field-grid"><label>数据类型<select value={input.type ?? 'string'} onChange={(event) => updateStartInput(input.id, { type: event.target.value as StartInputType })}>{Object.entries(START_INPUT_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="check-label parameter-required"><input type="checkbox" checked={input.required} onChange={(event) => updateStartInput(input.id, { required: event.target.checked })} />必须提供</label></div>
          <label className="parameter-description">用途说明<input value={input.description ?? ''} placeholder="例如：要录入系统的客户名称" onChange={(event) => updateStartInput(input.id, { description: event.target.value })} /></label>
        </div>)}
        <div className="input-actions single-action"><button className="secondary" onClick={addStartInput}>＋ 添加输入参数</button></div>
      </div>
      <label className="check-label"><input type="checkbox" checked={Boolean(node.keepCurrentPage)} onChange={(event) => onChange({ ...node, keepCurrentPage: event.target.checked })} />保持当前页面，不跳转、不刷新</label>
      <small>已手动进入目标界面时开启，保留当前 SPA、表单和 iframe 状态；开启后忽略目标 URL 及其登录跳转校验。</small>
      <label>目标页面 URL<input disabled={node.keepCurrentPage} value={node.targetUrl} placeholder="留空则使用当前页面，支持 {{变量}}" onChange={(event) => onChange({ ...node, targetUrl: event.target.value })} /><small>未开启保持当前页面时，每次运行会重新打开此地址；留空也不会主动刷新。</small></label>
      <label className="check-label"><input type="checkbox" checked={node.strictValidation} onChange={(event) => onChange({ ...node, strictValidation: event.target.checked })} />开启强校验（包含查询参数）</label>
      <label className="check-label"><input type="checkbox" checked={node.waitForLogin} onChange={(event) => onChange({ ...node, waitForLogin: event.target.checked })} />跳转到登录页时，等待登录完成后自动继续</label>
      <div className="field-grid"><label>页面加载超时（秒）<input type="number" min="1" max="300" value={Math.round(node.loadTimeoutMs / 1000)} onChange={(event) => onChange({ ...node, loadTimeoutMs: Number(event.target.value) * 1000 })} /></label><label>页面稳定等待（毫秒）<input type="number" min="0" max="60000" value={node.settleDelayMs} onChange={(event) => onChange({ ...node, settleDelayMs: Number(event.target.value) })} /></label></div>
      {node.waitForLogin && <label>登录等待上限（秒）<input type="number" min="10" max="1800" value={Math.round(node.loginTimeoutMs / 1000)} onChange={(event) => onChange({ ...node, loginTimeoutMs: Number(event.target.value) * 1000 })} /><small>用户完成登录并回到目标 URL 后，流程会自动从成功出口继续。</small></label>}
      <div className="port-help"><strong>Start 页面准备</strong><br />普通校验匹配域名和路径；强校验还会匹配查询参数。页面未就绪或等待超时将走失败出口。</div>
    </>}

    {node.kind === 'output' && <OutputInspector node={node} nodes={nodes} onChange={onChange} onPick={onPickQueryScope} />}
    {(node.kind === 'dom' || node.kind === 'dialog') && <>
      {node.kind === 'dialog' && <button className="secondary" onClick={onPickQueryScope}>⌖ 选择触发弹窗的控件</button>}
      <label>Selector 名称<input value={node.target.name} onChange={(event) => updateName(event.target.value)} /></label>
      <label>Selector<textarea className="code-input" value={node.target.selector} onChange={(event) => onChange({ ...node, target: { ...node.target, selector: event.target.value } })} /></label>
      <div className="field-grid"><label>元素类型<input value={node.target.tagName} disabled /></label><label>Frame<input value={node.target.frameId} disabled /></label></div>
      {node.target.locator && node.target.locator.selector === node.target.selector && <small>定位置信度：{{ high: '高', medium: '中', low: '低（页面结构改变后需重新选择）' }[node.target.locator.confidence]}；首选：{node.target.locator.candidates[0]?.kind}；共 {node.target.locator.candidates.length} 个候选规则。{node.target.locator.candidates[0]?.match && <>精确匹配：{node.target.locator.candidates[0].match.value}</>}</small>}
      {node.target.selectorUpgrade && <details><summary>自动修复记录</summary><small>{new Date(node.target.selectorUpgrade.upgradedAt).toLocaleString()}：{node.target.selectorUpgrade.reason}</small><pre className="code-input">{node.target.selectorUpgrade.previous.selector}</pre><small>以上为升级前的 Selector；完整原配置保存在工作流备份字段中。</small></details>}
      <EventEditor target={node.target} event={node.event} onChange={updateEvent} allowUpload={node.kind !== 'dialog'} />
      {node.kind === 'dom' && node.event.type !== 'upload' && <button className="secondary" onClick={() => onChange({ ...node, kind: 'dialog', dialogType: 'confirm', action: 'accept', message: '', promptText: '', timeoutMs: 10000 })}>转为浏览器弹窗节点</button>}

    </>}
    {node.kind === 'dialog' && <>
      <label>弹窗类型<select value={node.dialogType} onChange={event => onChange({ ...node, dialogType: event.target.value as typeof node.dialogType, ...(event.target.value === 'alert' ? { action: 'accept' as const } : {}) })}><option value="confirm">confirm 确认框</option><option value="prompt">prompt 输入框</option><option value="alert">alert 提示框</option><option value="beforeunload">离开页面确认框</option></select></label>
      <label>应答方式<select value={node.action} onChange={event => onChange({ ...node, action: event.target.value as typeof node.action })}><option value="accept">确定 / 继续离开</option>{node.dialogType !== 'alert' && <option value="dismiss">取消 / 留在页面</option>}</select></label>
      {node.dialogType === 'prompt' && node.action === 'accept' && <label>弹窗输入内容<input value={node.promptText} placeholder="可留空，支持 {{变量}}" onChange={event => onChange({ ...node, promptText: event.target.value })} /></label>}
      <label>匹配弹窗文字<input value={node.message} placeholder="留空匹配任意文字，支持 {{变量}}" onChange={event => onChange({ ...node, message: event.target.value })} /><small>填写时精确匹配；不匹配会失败并保留弹窗供手动检查。</small></label>
      <label>等待超时（毫秒）<input type="number" min="100" max="300000" value={node.timeoutMs} onChange={event => onChange({ ...node, timeoutMs: Number(event.target.value) })} /></label>
      <p className="input-hint">此节点会先监听弹窗，再执行上方控件事件。请用它替换原来的触发点击节点，避免重复点击。取消也是成功执行，弹窗未出现或应答失败走失败出口；输出包含 type、message、accepted、promptText。</p>
      <p className="input-hint">支持浏览器原生弹窗。网页内的自定义弹层继续使用 Selector 节点。离开页面确认框需要网页已有用户交互，浏览器实际允许弹出时才能处理。</p>
    </>}
    {node.kind === 'calendar' && <>
      <button className="secondary" onClick={onPickQueryScope}>⌖ 选择日历容器</button>
      <label>日历容器 Selector<textarea value={node.target.selector} onChange={(event) => onChange({ ...node, target: { ...node.target, selector: event.target.value } })} /></label>
      <label>选择方式<select value={node.mode} onChange={(event) => onChange({ ...node, mode: event.target.value as 'single' | 'range' })}><option value="single">选择一个日期（也可用于区间的一端）</option><option value="range">选择开始和结束日期</option></select></label>
      <label>目标日期 / 开始时间<input value={node.date} placeholder="2026-10-17 09:10:11 或 {{start_time}}" onChange={(event) => onChange({ ...node, date: event.target.value })} /></label>
      {node.mode === 'range' && <label>结束日期 / 时间<input value={node.endDate} placeholder="2026-11-17 18:20:21 或 {{end_time}}" onChange={(event) => onChange({ ...node, endDate: event.target.value })} /></label>}
      <p className="input-hint">先通过上游点击节点打开日历，再运行此节点。自动识别年月并翻页；禁用日期或识别不明确时走失败路径，不会盲目点击。</p>
      <p className="input-hint">仅日期仍填 YYYY-MM-DD。Fusion Next 日期时间区间可填 YYYY-MM-DD HH:mm:ss：自动点击日期和时分秒选项、点击日历内确定，并同时核验主表单开始和结束的完整实际值。不会提交业务表单；不支持的时间控件会明确报错。</p>
    </>}

    {node.kind === 'tableFill' && <>
      <button className="secondary" onClick={onPickQueryScope}>⌖ 在网页选择可编辑表格</button>
      <label>表格 Selector<textarea value={node.target.selector} onChange={event => onChange({ ...node, target: { ...node.target, selector: event.target.value } })} /><small>支持 table、ul/li、div、ARIA 表格及分离表头/数据行。请选择同时包含表头和行的完整容器；Frame：{node.target.frameId}。仅处理已加载行。</small></label>
      <details><summary>高级结构配置（自动识别不明确时使用）</summary><small>均为相对上方容器的 CSS Selector；单元格相对每一数据行。留空自动识别。请选择单元格外层，不要只选择输入框。</small>
        <label>表头单元格 Selector<input value={node.structure?.headerSelector ?? ''} placeholder="例如 .header .cell 或 thead th" onChange={event => onChange({ ...node, structure: { ...node.structure, headerSelector: event.target.value } })} /></label>
        <label>数据行 Selector<input value={node.structure?.rowSelector ?? ''} placeholder="例如 .body > li 或 .body > .row" onChange={event => onChange({ ...node, structure: { ...node.structure, rowSelector: event.target.value } })} /></label>
        <label>行内单元格 Selector<input value={node.structure?.cellSelector ?? ''} placeholder="例如 :scope > .cell" onChange={event => onChange({ ...node, structure: { ...node.structure, cellSelector: event.target.value } })} /></label>
      </details>
      <label>填充数据<input value={node.data} placeholder="{{data}} 或 {{数据表.rows}}" onChange={event => onChange({ ...node, data: event.target.value })} /><small>输入对象数组变量或 JSON；对象字段名与网页表头一致。MCP 使用 data 参数时，请在开始节点声明 data（对象数组）。</small></label>
      <label>匹配 key 列（组合匹配）</label>
      {node.keyColumns.map((key, index) => <div className="field-grid" key={index}><input aria-label={`匹配 key 列 ${index + 1}`} value={key} placeholder="例如 SKU 编号、仓库" onChange={event => onChange({ ...node, keyColumns: node.keyColumns.map((item, i) => i === index ? event.target.value : item) })} /><button className="secondary compact" onClick={() => onChange({ ...node, keyColumns: node.keyColumns.filter((_, i) => i !== index) })}>移除</button></div>)}
      <button className="secondary compact" onClick={() => onChange({ ...node, keyColumns: [...node.keyColumns, ''] })}>＋ 添加 key 列</button>
      <label className="check-label"><input type="checkbox" checked={node.skipUnmatchedRows} onChange={event => onChange({ ...node, skipUnmatchedRows: event.target.checked })} />跳过当前页面未匹配的数据行（分页场景）</label>
      <small>key 列不改写；只读或禁用列自动跳过。下拉、单选、多选按文字或 value 精确匹配，歧义会失败；填充后校验实际值，不自动提交。失败时已填内容不会自动回滚，详情见日志中的 verification.actual。</small>
    </>}
    {node.kind === 'datatable' && <>
      <button className="secondary" onClick={onPickQueryScope}>⌖ 在网页选择表格</button>
      <label>表格 Selector<textarea value={node.target.selector} onChange={event=>onChange({...node,target:{...node.target,selector:event.target.value}})}/><small>可选择 table、表格内单元格或只含一个 table 的容器；Frame：{node.target.frameId}</small></label>
      <label>表头<select value={node.header} onChange={event=>onChange({...node,header:event.target.value as typeof node.header})}><option value="auto">自动识别 thead / th</option><option value="firstRow">第一行作为表头</option><option value="none">没有表头（自动命名列）</option></select></label>
      <label className="check-label"><input type="checkbox" checked={node.parseNumbers} onChange={event=>onChange({...node,parseNumbers:event.target.checked})}/>将纯数字转成数值（保留前导零和长编号）</label>
      <label className="check-label"><input type="checkbox" checked={node.exportExcel} onChange={event=>onChange({...node,exportExcel:event.target.checked})}/>运行时生成 Excel 文件</label>
      {node.exportExcel&&<label>Excel 文件名<input value={node.fileName} onChange={event=>onChange({...node,fileName:event.target.value})}/></label>}
      <FileDownloads data={lastRun?.steps.filter(step=>step.nodeId===node.id&&step.ok).at(-1)?.data}/>
      <small>循环输入可填写 {'{{'+node.name+'}}'} 或 {'{{'+node.name+'.rows}}'}；每行按列名取值，例如 {'{{item.金额}}'}。Excel 可从运行日志下载，邮件附件填写 {'{{'+node.name+'.excel}}'}。仅读取当前 DOM，分页与虚拟滚动中未加载的行不包含在内。</small>
    </>}
    {node.kind === 'screenshot' && <>
      <label>截图范围<select value={node.mode} onChange={event=>onChange({...node,mode:event.target.value as typeof node.mode})}><option value="fullPage">整页（滚动拼接）</option><option value="viewport">可视窗口</option><option value="region">框选区域</option></select></label>
      {node.mode === 'region' && <><button className="secondary" onClick={onPickScreenshotRegion}>▣ 到网页框选区域</button><small>{node.region ? `x=${node.region.x}, y=${node.region.y}, ${node.region.width} × ${node.region.height}` : '尚未框选'}</small></>}
      <label>文件名称<input value={node.fileName} placeholder="截图，支持 {{变量}}" onChange={event=>onChange({...node,fileName:event.target.value})}/></label>
      <small>输出 PNG 文件。后续邮件附件可填写 {'{{'+node.name+'}}'}；超长页面可能输出多个分段文件。框选区域使用文档坐标，布局变化后请重新框选。</small>
    </>}
    {node.kind === 'request' && <>
      <label>请求链接<input value={node.url} placeholder="https://example.com/api，支持 {{变量}}" onChange={event => onChange({ ...node, url: event.target.value })} /></label>
      <label>请求方法<select value={node.method} onChange={event => onChange({ ...node, method: event.target.value as typeof node.method, body: ['GET', 'HEAD'].includes(event.target.value) ? '' : node.body })}>{REQUEST_METHODS.map(method => <option key={method}>{method}</option>)}</select></label>
      <label>返回类型<select value={node.responseType} onChange={event => onChange({ ...node, responseType: event.target.value as typeof node.responseType })}><option value="json">JSON（解析为对象、数组或值）</option><option value="text">Text（原始文本）</option></select></label>
      <label>请求头（JSON 对象）<textarea value={node.headers} placeholder={'{"Content-Type":"application/json","Authorization":"Bearer {{令牌}}"}'} onChange={event => onChange({ ...node, headers: event.target.value })} /></label>
      {!['GET', 'HEAD'].includes(node.method) && <label>请求体<textarea value={node.body} placeholder="支持固定文本或 {{参数}}，对象变量自动转为 JSON" onChange={event => onChange({ ...node, body: event.target.value })} /></label>}
      <label>请求超时（毫秒）<input type="number" min="100" max="300000" value={node.timeoutMs} onChange={event => onChange({ ...node, timeoutMs: Number(event.target.value) })} /></label>
      <small>由扩展后台发送 HTTP/HTTPS 请求，默认不携带网页 Cookie。HTTP 非 2xx、网络错误、超时或 JSON 解析失败走失败出口；不会自动重试。后续可使用 {'{{'+node.name+'.output}}'} 引用返回内容。</small>
    </>}
    {node.kind === 'email' && <>
      <EmailSettings notify={notify}/>
      <label>收件人<input value={node.to} placeholder="name@example.com；多个地址用逗号分隔，支持变量" onChange={event=>onChange({...node,to:event.target.value})}/></label>
      <label>主题<input value={node.subject} placeholder="支持 {{变量}}" onChange={event=>onChange({...node,subject:event.target.value})}/></label>
      <label>正文<textarea value={node.body} placeholder="固定文字或 {{节点名称}}；单独引用文件变量时自动作为附件" onChange={event=>onChange({...node,body:event.target.value})}/></label>
      <label>附件变量（每行一个）<textarea value={node.attachments.join('\n')} placeholder="{{页面截图}}" onChange={event=>onChange({...node,attachments:event.target.value.split('\n').filter(value=>value.trim())})}/></label>
      <small>变量引用前面已执行节点的输出。文件不能拼接进正文文字；附件合计上限 10 MB。发送结果不确定时不会自动重试。</small>
    </>}
    {node.kind === 'watch' && <>
      <button className="secondary" onClick={onPickQueryScope}>⌖ 在网页选择监控 DOM</button>
      <label>Selector<textarea value={node.target.selector} onChange={(event) => onChange({ ...node, target: { ...node.target, selector: event.target.value } })} /><small>Frame：{node.target.frameId}；只读取状态，不触发页面事件。</small></label>
      <label>监控内容<select value={node.source} onChange={(event) => onChange({ ...node, source: event.target.value as typeof node.source })}><option value="text">文本内容</option><option value="value">输入框 / 选项框的值</option><option value="attribute">DOM 属性</option></select></label>
      {node.source === 'attribute' && <label>属性名称<input value={node.attributeName} placeholder="aria-valuenow、data-status、class" onChange={(event) => onChange({ ...node, attributeName: event.target.value })} /></label>}
      <label>达到预期的条件<select value={node.match} onChange={(event) => onChange({ ...node, match: event.target.value as typeof node.match })}><option value="equals">完全相同</option><option value="contains">包含内容</option><option value="regex">正则匹配</option><option value="exists">存在值 / 属性</option></select></label>
      {node.match !== 'exists' && <label>预期值<input value={node.expected} placeholder="例如 导出完成、100，支持 {{变量}}" onChange={(event) => onChange({ ...node, expected: event.target.value })} /></label>}
      <label>最长等待（毫秒）<input type="number" min="100" max="3600000" value={node.timeoutMs} onChange={(event) => onChange({ ...node, timeoutMs: Number(event.target.value) })} /></label>
      <label>检查间隔（毫秒）<input type="number" min="100" max="10000" value={node.intervalMs} onChange={(event) => onChange({ ...node, intervalMs: Number(event.target.value) })} /></label>
      <small>已符合预期时立即继续；否则持续监控，超时走失败出口。</small>
    </>}
    {node.kind === 'pagination' && <>
      <button className="secondary" onClick={onPickQueryScope}>⌖ 选择分页容器</button>
      <label>分页容器 Selector<textarea value={node.target.selector} onChange={(event) => onChange({ ...node, target: { ...node.target, selector: event.target.value } })} /></label>
      <label>操作方式<select value={node.mode} onChange={(event) => onChange({ ...node, mode: event.target.value as 'goto' | 'all' })}><option value="goto">到指定页</option><option value="all">遍历每一页（从第 1 页开始）</option></select></label>
      {node.mode === 'goto' && <label>目标页<input value={node.page} placeholder="3 或 {{page_number}}" onChange={(event) => onChange({ ...node, page: event.target.value })} /></label>}
      {node.mode === 'all' && <>
        <label>终止条件<select value={node.stopAtPage !== undefined ? 'page' : 'lastPage'} onChange={(event) => onChange({ ...node, stopAtPage: event.target.value === 'page' ? '10' : undefined })}><option value="lastPage">遍历到最后一页</option><option value="page">到指定页码后结束</option></select></label>
        {node.stopAtPage !== undefined && <label>终止页码<input value={node.stopAtPage} placeholder="10 或 {{last_page}}" onChange={(event) => onChange({ ...node, stopAtPage: event.target.value })} /><small>包含该页：处理完这一页的内部流程后正常结束，不再翻下一页。如果提前到达末页，也会正常结束。</small></label>}
        <label>内部结果非空时提前结束（可选）<input value={node.stopWhen ?? ''} placeholder="{{本页精确匹配.output}}" onChange={event => onChange({ ...node, stopWhen: event.target.value || undefined })} /><small>内部流程成功后检查此变量：空列表继续翻页，非空列表停止。不会执行表达式；子节点报错仍然走失败出口。</small></label>
      </>}
      <label>当前页变量<input value={node.pageVariable} onChange={(event) => onChange({ ...node, pageVariable: event.target.value })} /><small>内部节点可使用 {'{{page}}'}（或上方设定的变量名）。</small></label>
      <label>安全上限：最大页数 / 导航操作数<input type="number" min="1" max="5000" value={node.maxPages} onChange={(event) => onChange({ ...node, maxPages: Number(event.target.value) })} /><small>不是正常终止条件；到达上限仍未完成目标时会报错。</small></label>
      <div className="field-grid"><label>翻页超时（毫秒）<input type="number" min="100" max="30000" value={node.timeoutMs} onChange={(event) => onChange({ ...node, timeoutMs: Number(event.target.value) })} /></label><label>翻页后等待（毫秒）<input type="number" min="0" max="10000" value={node.settleMs} onChange={(event) => onChange({ ...node, settleMs: Number(event.target.value) })} /></label></div>
      <div className="port-help">在卡片内部添加每页执行的子流程；内部执行完毕自动翻页。识别页码与图标按钮，操作后校验真实页码；无法确认末页或达到安全上限时走失败出口。</div>
    </>}
    {node.kind === 'query' && <>
      <button className="secondary" onClick={onPickQueryScope}>⌖ 在网页选择检索范围</button>
      <label>或使用已选 DOM<select value="" onChange={(event) => {
        const source = nodes.find((item) => item.id === event.target.value);
        if (source?.kind === 'dom' || source?.kind === 'query') onChange({ ...node, target: { ...source.target, name: node.name } });
      }}><option value="">从节点列表选择范围</option>{nodes.filter((item) => item.id !== node.id && (item.kind === 'dom' || item.kind === 'query')).map((item) => <option key={item.id} value={item.id}>{item.name} · {NODE_KIND_LABELS[item.kind]}</option>)}</select></label>
      <label>范围 Selector<textarea className="code-input" value={node.target.selector} placeholder="先选择页面中的容器，或填写 {{变量}}" onChange={(event) => onChange({ ...node, target: { ...node.target, selector: event.target.value } })} /><small>遍历范围内的 DOM，不触发页面事件。Frame：{node.target.frameId}</small></label>
      <label>候选元素<input value={node.query.candidateSelector} placeholder="*（全部）、input、a、.item" onChange={(event) => updateQuery({ candidateSelector: event.target.value })} /><small>可留空检索全部后代；填写 CSS selector 可缩小候选范围。</small></label>
      <label>候选内部读取位置（可选）<input value={node.query.readSelector ?? ''} placeholder=":scope > td:nth-child(2)" onChange={event => updateQuery({ readSelector: event.target.value || undefined })} /><small>例如候选为表格行，只比对第二列，但返回整行供后续勾选。每个候选内必须唯一；缺少该位置则跳过。</small></label>
      <label className="check-label"><input type="checkbox" checked={Boolean(node.query.normalizeWhitespace)} onChange={event => updateQuery({ normalizeWhitespace: event.target.checked })} />忽略首尾空白，并将连续空白合为一个空格</label>
      <label>最多返回匹配项（可选）<input type="number" min="1" max="500" value={node.query.maxResults ?? ''} placeholder="留空返回全部；1 为第一个匹配项" onChange={event => updateQuery({ maxResults: event.target.value ? Number(event.target.value) : undefined })} /></label>
      <label className="check-label"><input type="checkbox" checked={node.query.includeRoot} onChange={(event) => updateQuery({ includeRoot: event.target.checked })} />同时检索选中的元素本身</label>
      <label>检索内容<select value={node.query.source} onChange={(event) => updateQuery({ source: event.target.value as DomQuery['source'] })}><option value="attribute">DOM 属性</option><option value="value">DOM 值</option><option value="text">文本内容</option></select><small>DOM 值读取输入框、选项框的当前 value；其他元素读取文本。</small></label>
      {node.query.source === 'attribute' && <label>属性名称<input value={node.query.attributeName} placeholder="例如 href、class、data-id，支持 {{变量}}" onChange={(event) => updateQuery({ attributeName: event.target.value })} /></label>}
      <label>匹配方式<select value={node.query.match} onChange={(event) => updateQuery({ match: event.target.value as DomQuery['match'] })}><option value="exists">{node.query.source === 'attribute' ? '存在该属性' : '全部值（不筛选）'}</option><option value="equals">完全相同</option><option value="contains">包含内容</option><option value="regex">正则匹配</option></select></label>
      {node.query.match !== 'exists' && <label>{node.query.match === 'regex' ? '正则表达式' : '匹配内容'}<input value={node.query.pattern} placeholder={node.query.match === 'regex' ? '^订单\\d+$（无需 /，支持 {{变量}}）' : '支持 {{变量}}'} onChange={(event) => updateQuery({ pattern: event.target.value })} /></label>}
      {node.query.match === 'regex' && <label>正则选项<input value={node.query.regexFlags} placeholder="例如 i 忽略大小写、m 多行；可留空" onChange={(event) => updateQuery({ regexFlags: event.target.value })} /></label>}
      <label>没有匹配项时<select value={node.onEmpty ?? 'success'} onChange={event => onChange({ ...node, onEmpty: event.target.value as 'success' | 'failure' })}><option value="success">返回空列表，走成功出口（默认）</option><option value="failure">走失败出口（可连接 Output）</option></select></label>
      <div className="port-help">输出 DOM 列表：<code>{`{{${node.name}.output}}`}</code><br />循环可用 <code>{'{{item.selector}}'}</code>、<code>{'{{item.value}}'}</code>、<code>{'{{item.attributes.href}}'}</code>；AI 输入可选择此节点。范围不存在或配置无效也走失败出口；可在运行日志区分原因。</div>
      {queryStep && <div className="query-results"><strong>{queryStep.message}</strong>{queryMatches && <details><summary>查看匹配 DOM（{queryMatches.length}）</summary>{queryMatches.map((item, index) => <div key={`${item.selector}_${index}`}><code>{item.selector}</code><span>{item.matchedValue || '（空值）'}</span></div>)}</details>}</div>}
    </>}

    {node.kind === 'ai' && <>
      <label>AI 指令<textarea value={node.instruction} placeholder="分析输入并决定下一步；可返回 Action 或 selector 事件" onChange={(event) => onChange({ ...node, instruction: event.target.value })} /></label>
      <div className="input-section">
        <div className="input-title"><strong>输入列表</strong><span>{node.inputs.length} 项</span></div>
        {node.inputs.map((input) => <div className="ai-input-card" key={input.id}>
          <div className="ai-input-head"><span className={`input-type type-${input.type}`}>{input.type}</span><input value={input.name} onChange={(event) => updateInput(input.id, { name: event.target.value })} /><button className="icon-btn danger" onClick={() => onChange({ ...node, inputs: node.inputs.filter((item) => item.id !== input.id) })}>×</button></div>
          {input.type === 'selector' && <><code>{input.target?.name} · {input.target?.tagName}</code><div className="field-grid"><select value={input.attribute ?? 'text'} onChange={(event) => updateInput(input.id, { attribute: event.target.value as AiInputBinding['attribute'] })}><option value="text">文本</option><option value="value">值</option><option value="html">HTML</option><option value="attributes">属性</option></select><label className="check-label"><input type="checkbox" checked={Boolean(input.multiple)} onChange={(event) => updateInput(input.id, { multiple: event.target.checked })} />读取列表</label></div></>}
          {input.type === 'node' && <select value={input.sourceNodeId ?? ''} onChange={(event) => updateInput(input.id, { sourceNodeId: event.target.value })}><option value="">选择上游节点</option>{nodes.filter((item) => item.id !== node.id).map((item) => <option key={item.id} value={item.id}>{item.name} · {NODE_KIND_LABELS[item.kind]}</option>)}</select>}
          {input.type === 'literal' && <input value={input.value ?? ''} placeholder="文本或 {{变量}}" onChange={(event) => updateInput(input.id, { value: event.target.value })} />}
        </div>)}
        <div className="input-actions"><button className="secondary" onClick={onPickAiSelector}>⌖ Selector 输入</button><button className="secondary" onClick={addNodeInput}>节点输入</button><button className="secondary" onClick={addLiteralInput}>文本输入</button></div>
      </div>
      <div className="ai-behavior"><strong>模型可执行的动作</strong><p>AI 可以返回一个输入 selector 上的事件，或按准确名称调用已保存 Action。被调用的网页操作会自动验收执行结果。</p></div>
    </>}

    {node.kind === 'loop' && <>
      <label>遍历数组<input value={node.items} placeholder="{{Query.output}}、{{AI节点.output.items}} 或 [1,2,3]" onChange={(event) => onChange({ ...node, items: event.target.value })} /></label>
      <div className="field-grid"><label>当前项变量<input value={node.itemVariable} onChange={(event) => onChange({ ...node, itemVariable: event.target.value })} /></label><label>索引变量<input value={node.indexVariable} onChange={(event) => onChange({ ...node, indexVariable: event.target.value })} /></label></div>
      <label>最大循环次数<input type="number" min="1" max="1000" value={node.maxIterations} onChange={(event) => onChange({ ...node, maxIterations: Number(event.target.value) })} /></label>
      <div className="port-help">{node.body ? '在卡片内部添加子节点；每一项自动运行内部子流程，无需回连。完成出口连接循环后的流程。' : '旧版循环：遍历端口连接循环体，最后一个节点连回本循环节点。'}</div>
    </>}

    {node.kind === 'wait' && <>
      <label>等待方式<select value={node.mode ?? 'fixed'} onChange={(event) => onChange({ ...node, mode: event.target.value as 'fixed' | 'random', minDurationMs: node.minDurationMs ?? 500, maxDurationMs: node.maxDurationMs ?? 1500 })}><option value="fixed">固定时长</option><option value="random">随机区间</option></select></label>
      {node.mode === 'random' ? <div className="field-grid"><label>最短等待（毫秒）<input type="number" min="0" max="60000" step="1" value={node.minDurationMs ?? 500} onChange={(event) => onChange({ ...node, minDurationMs: Number(event.target.value) })} /></label><label>最长等待（毫秒）<input type="number" min="0" max="60000" step="1" value={node.maxDurationMs ?? 1500} onChange={(event) => onChange({ ...node, maxDurationMs: Number(event.target.value) })} /></label></div> : <label>等待毫秒<input type="number" min="0" max="60000" value={node.durationMs} onChange={(event) => onChange({ ...node, durationMs: Number(event.target.value) })} /></label>}
      {node.mode === 'random' && <small>每次执行独立随机取值，包含区间两端；日志显示实际等待时间。</small>}
    </>}
    {node.kind === 'action' && <label>选择 Action<select value={node.actionId} onChange={(event) => onChange({ ...node, actionId: event.target.value })}><option value="">请选择</option>{actions.map((action) => <option value={action.id} key={action.id}>{action.name}</option>)}</select></label>}
    {node.kind !== 'loop' && node.kind !== 'start' && node.kind !== 'query' && <div className="port-help"><strong>自动验收</strong><br />Page Agent 会根据操作类型检查真实页面状态；结果符合预期走成功出口，否则走失败出口。没有失败连线时终止流程。</div>}
  </aside>;
}

function EventEditor({ target, event, onChange, allowUpload = true }: {
  target: PageTarget;
  event: EventDefinition;
  onChange: (patch: Partial<EventDefinition>) => void;
  allowUpload?: boolean;
}) {
  const options = allowedEventsForTarget(target).filter(type => allowUpload || type !== 'upload');
  const changeType = (type: EventDefinition['type']) => onChange({ type, value: type === 'drag' ? '{"dx":100,"dy":0,"durationMs":500}' : undefined, customEvent: undefined, code: undefined, modifiers: undefined, keepFocus: undefined, relatedSelector: undefined, optionalValue: undefined, minWaitMs: undefined, maxWaitMs: undefined });
  let scrollPosition = { x: 0, y: 0 };
  if (event.type === 'scrollPage') {
    try { scrollPosition = JSON.parse(event.value || '{}') as { x: number; y: number }; } catch { /* keep origin */ }
  }
  const updateScroll = (axis: 'x' | 'y', value: number) => onChange({ value: JSON.stringify({ ...scrollPosition, [axis]: value }) });
  return <>
    <label>操作<select value={event.type} onChange={(item) => changeType(item.target.value as EventDefinition['type'])}>{options.map((value) => <option key={value} value={value}>{EVENT_LABELS[value]}</option>)}</select><small>已根据 {target.tagName}{target.attributes?.type ? ` · ${target.attributes.type}` : ''} 元素筛选可用操作。</small></label>
    {event.type === 'upload' && <><label>文件路径<textarea aria-label="上传文件路径" value={event.value ?? ''} placeholder={'{{文件路径}} 或每行一个本机绝对路径'} onChange={item => onChange({ value: item.target.value })} /></label><small>支持字符串、字符串数组或每行一个路径。路径属于运行本机 MCP 服务的电脑，需启动新版 MCP 服务；最多 20 个文件；大小由目标网站和浏览器限制，插件不再限制为 20 MB。Selector 指向文件框、关联 label 或包含唯一文件框的容器（可隐藏）。选择文件会触发网页 input/change，页面可能立即上传；服务端成功状态请用后续 Watch/Query 节点验证。不支持目录或系统文件选择窗口操作。</small></>}
    {event.type === 'input' && <label>输入内容<input value={event.value ?? ''} placeholder="支持 {{变量}}" onChange={(item) => onChange({ value: item.target.value })} /></label>}
    {event.type === 'input' && <label className="check-label"><input type="checkbox" checked={Boolean(event.keepFocus)} onChange={item => onChange({ keepFocus: item.target.checked })} />输入后保留焦点，交给后续焦点节点处理</label>}
    {(event.type === 'focusout' || event.type === 'blur') && <label>焦点转移目标 Selector（可选）<input value={event.relatedSelector ?? ''} onChange={item => onChange({ relatedSelector: item.target.value || undefined })} /><small>录制自动记录下一焦点；可保持 focusout.relatedTarget，避免重复失焦。留空仅离开当前控件。</small></label>}
    {event.type === 'select' && <label>选择选项{target.options?.length
      ? <select value={event.value ?? ''} onChange={(item) => onChange({ value: item.target.value })}><option value="">请选择</option>{event.value && !target.options.some((option) => option.value === event.value) && <option value={event.value}>{event.value}（动态值）</option>}{target.options.map((option, index) => <option key={`${option.value}_${index}`} value={option.value}>{option.label || option.value}</option>)}</select>
      : <input value={event.value ?? ''} placeholder="选项 value 或 {{变量}}" onChange={(item) => onChange({ value: item.target.value })} />}</label>}
    {event.type === 'select' && <><label className="check-label"><input type="checkbox" checked={Boolean(event.optionalValue)} onChange={item => onChange({ optionalValue: item.target.checked })} />参数为空时跳过选择（可选筛选条件）</label>{target.tagName !== 'select' && <div className="field-grid"><label>展开后最短等待（毫秒）<input type="number" min="0" max="10000" value={event.minWaitMs ?? 1000} onChange={item => onChange({ minWaitMs: Number(item.target.value) })} /></label><label>最长等待（毫秒）<input type="number" min="0" max="10000" value={event.maxWaitMs ?? 2000} onChange={item => onChange({ maxWaitMs: Number(item.target.value) })} /></label><small>随机等待后，继续等待异步选项加载；完全匹配名称并验证选中标签。</small></div>}</>}
    {event.type === 'check' && <label>目标状态<select value={event.value ?? ''} onChange={(item) => onChange({ value: item.target.value || undefined })}><option value="">切换当前状态</option><option value="true">勾选</option><option value="false">取消勾选</option></select></label>}
    {event.type === 'pressKey' && <><label>按键<input value={event.value ?? ''} placeholder="Enter、Tab、Space、F2 或 {{变量}}" onChange={(item) => onChange({ value: item.target.value })} /></label><div className="field-grid">{(['ctrl', 'alt', 'shift', 'meta'] as const).map(key => <label className="check-label" key={key}><input type="checkbox" checked={Boolean(event.modifiers?.[key])} onChange={item => onChange({ modifiers: { ...event.modifiers, [key]: item.target.checked } })} />{{ ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Command / Meta' }[key]}</label>)}</div><label>物理按键 code（可选）<input value={event.code ?? ''} placeholder="例如 KeyS、Space" onChange={item => onChange({ code: item.target.value || undefined })} /></label><small>回放会发送 keydown/keypress/keyup；浏览器和系统快捷键、剪贴板权限不保证由模拟事件执行。</small></>}
    {event.type === 'longPress' && <label>长按时长（毫秒）<input type="number" min="650" max="5000" value={Number(event.value) || 650} onChange={(item) => onChange({ value: item.target.value })} /></label>}
    {event.type === 'drag' && <label>拖拽参数<textarea value={event.value ?? '{"dx":100,"dy":0,"durationMs":500}'} onChange={(item) => onChange({ value: item.target.value })} /><small>录制时自动填写轨迹。dx 为水平位移，dy 为垂直位移（像素）；正数向右/下，负数向左/上。</small></label>}
    {event.type === 'scrollPage' && <div className="field-grid"><label>横向位置<input type="number" value={Number(scrollPosition.x) || 0} onChange={(item) => updateScroll('x', Number(item.target.value))} /></label><label>纵向位置<input type="number" value={Number(scrollPosition.y) || 0} onChange={(item) => updateScroll('y', Number(item.target.value))} /></label></div>}
    {event.type === 'custom' && <><label>自定义事件名<input value={event.customEvent ?? ''} onChange={(item) => onChange({ customEvent: item.target.value })} /></label><label>事件数据<input value={event.value ?? ''} placeholder="可选，支持 {{变量}}" onChange={(item) => onChange({ value: item.target.value })} /></label></>}
  </>;
}
