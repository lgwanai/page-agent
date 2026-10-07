import {
  allowedEventsForTarget, createId, EVENT_LABELS, NODE_KIND_LABELS, START_INPUT_TYPE_LABELS, type ActionDefinition,
  type AiInputBinding, type EventDefinition, type PageTarget, type StartInputDeclaration, type StartInputType, type WorkflowNode,
} from '@/types/workflow';

export function NodeInspector({ node, nodes, actions, onChange, onDelete, onRun, onClose, onPickAiSelector, notify }: {
  node: WorkflowNode | undefined;
  nodes: WorkflowNode[];
  actions: ActionDefinition[];
  onChange: (node: WorkflowNode) => void;
  onDelete: () => void;
  onRun: () => void;
  onClose: () => void;
  onPickAiSelector: () => void;
  notify: (message: string) => void;
}) {
  if (!node) return <aside className="node-inspector empty-inspector"><strong>节点设置</strong><p>在画布中选择节点编辑属性。每张执行卡片都有成功和失败出口，连接后即形成顺序逻辑。</p></aside>;
  const updateName = (name: string) => {
    if (nodes.some((item) => item.id !== node.id && item.name === name)) return notify(`节点名称「${name}」已存在`);
    onChange(node.kind === 'dom' ? { ...node, name, target: { ...node.target, name } } : { ...node, name });
  };
  const updateEvent = (patch: Partial<EventDefinition>) => {
    if (node.kind !== 'dom' && node.kind !== 'ai') return;
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
    <div className="inspector-head"><div><strong>{NODE_KIND_LABELS[node.kind]}</strong><span>{node.id}</span></div><div><button className="icon-btn" title="运行节点" onClick={onRun}>▶</button>{node.kind !== 'start' && <button className="icon-btn danger" title="删除节点" onClick={onDelete}>×</button>}<button className="icon-btn inspector-close" title="收起属性" onClick={onClose}>⌄</button></div></div>
    <label>节点名称<input value={node.name} onChange={(event) => updateName(event.target.value)} /><small>在 AI 输入和 `{'{{节点名.output}}'}` 表达式中使用，必须唯一。</small></label>

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
      <label>目标页面 URL<input value={node.targetUrl} placeholder="留空则使用当前页面，支持 {{变量}}" onChange={(event) => onChange({ ...node, targetUrl: event.target.value })} /><small>运行流程时先打开此页面；如果已经在目标页面则不会重复跳转。</small></label>
      <label className="check-label"><input type="checkbox" checked={node.strictValidation} onChange={(event) => onChange({ ...node, strictValidation: event.target.checked })} />开启强校验（包含查询参数）</label>
      <label className="check-label"><input type="checkbox" checked={node.waitForLogin} onChange={(event) => onChange({ ...node, waitForLogin: event.target.checked })} />跳转到登录页时，等待登录完成后自动继续</label>
      <div className="field-grid"><label>页面加载超时（秒）<input type="number" min="1" max="300" value={Math.round(node.loadTimeoutMs / 1000)} onChange={(event) => onChange({ ...node, loadTimeoutMs: Number(event.target.value) * 1000 })} /></label><label>页面稳定等待（毫秒）<input type="number" min="0" max="60000" value={node.settleDelayMs} onChange={(event) => onChange({ ...node, settleDelayMs: Number(event.target.value) })} /></label></div>
      {node.waitForLogin && <label>登录等待上限（秒）<input type="number" min="10" max="1800" value={Math.round(node.loginTimeoutMs / 1000)} onChange={(event) => onChange({ ...node, loginTimeoutMs: Number(event.target.value) * 1000 })} /><small>用户完成登录并回到目标 URL 后，流程会自动从成功出口继续。</small></label>}
      <div className="port-help"><strong>Start 页面准备</strong><br />普通校验匹配域名和路径；强校验还会匹配查询参数。页面未就绪或等待超时将走失败出口。</div>
    </>}

    {node.kind === 'dom' && <>
      <label>Selector 名称<input value={node.target.name} onChange={(event) => updateName(event.target.value)} /></label>
      <label>Selector<textarea className="code-input" value={node.target.selector} onChange={(event) => onChange({ ...node, target: { ...node.target, selector: event.target.value } })} /></label>
      <div className="field-grid"><label>元素类型<input value={node.target.tagName} disabled /></label><label>Frame<input value={node.target.frameId} disabled /></label></div>
      <EventEditor target={node.target} event={node.event} onChange={updateEvent} />
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
      <label>遍历数组<input value={node.items} placeholder="{{AI节点.output.items}} 或 [1,2,3]" onChange={(event) => onChange({ ...node, items: event.target.value })} /></label>
      <div className="field-grid"><label>当前项变量<input value={node.itemVariable} onChange={(event) => onChange({ ...node, itemVariable: event.target.value })} /></label><label>索引变量<input value={node.indexVariable} onChange={(event) => onChange({ ...node, indexVariable: event.target.value })} /></label></div>
      <label>最大循环次数<input type="number" min="1" max="1000" value={node.maxIterations} onChange={(event) => onChange({ ...node, maxIterations: Number(event.target.value) })} /></label>
      <div className="port-help">遍历端口连接循环体，循环体最后一个节点需要连回本循环节点；完成端口连接循环后的流程。</div>
    </>}

    {node.kind === 'wait' && <label>等待毫秒<input type="number" min="0" max="60000" value={node.durationMs} onChange={(event) => onChange({ ...node, durationMs: Number(event.target.value) })} /></label>}
    {node.kind === 'action' && <label>选择 Action<select value={node.actionId} onChange={(event) => onChange({ ...node, actionId: event.target.value })}><option value="">请选择</option>{actions.map((action) => <option value={action.id} key={action.id}>{action.name}</option>)}</select></label>}
    {node.kind !== 'loop' && node.kind !== 'start' && <div className="port-help"><strong>自动验收</strong><br />Page Agent 会根据操作类型检查真实页面状态；结果符合预期走成功出口，否则走失败出口。没有失败连线时终止流程。</div>}
  </aside>;
}

function EventEditor({ target, event, onChange }: {
  target: PageTarget;
  event: EventDefinition;
  onChange: (patch: Partial<EventDefinition>) => void;
}) {
  const options = allowedEventsForTarget(target);
  const changeType = (type: EventDefinition['type']) => onChange({ type, value: undefined, customEvent: undefined });
  return <>
    <label>操作<select value={event.type} onChange={(item) => changeType(item.target.value as EventDefinition['type'])}>{options.map((value) => <option key={value} value={value}>{EVENT_LABELS[value]}</option>)}</select><small>已根据 {target.tagName}{target.attributes?.type ? ` · ${target.attributes.type}` : ''} 元素筛选可用操作。</small></label>
    {event.type === 'input' && <label>输入内容<input value={event.value ?? ''} placeholder="支持 {{变量}}" onChange={(item) => onChange({ value: item.target.value })} /></label>}
    {event.type === 'select' && <label>选择选项{target.options?.length
      ? <select value={event.value ?? ''} onChange={(item) => onChange({ value: item.target.value })}><option value="">请选择</option>{event.value && !target.options.some((option) => option.value === event.value) && <option value={event.value}>{event.value}（动态值）</option>}{target.options.map((option, index) => <option key={`${option.value}_${index}`} value={option.value}>{option.label || option.value}</option>)}</select>
      : <input value={event.value ?? ''} placeholder="选项 value 或 {{变量}}" onChange={(item) => onChange({ value: item.target.value })} />}</label>}
    {event.type === 'check' && <label>目标状态<select value={event.value ?? ''} onChange={(item) => onChange({ value: item.target.value || undefined })}><option value="">切换当前状态</option><option value="true">勾选</option><option value="false">取消勾选</option></select></label>}
    {event.type === 'pressKey' && <label>按键<input value={event.value ?? ''} placeholder="Enter、Escape 或 {{变量}}" onChange={(item) => onChange({ value: item.target.value })} /></label>}
    {event.type === 'custom' && <><label>自定义事件名<input value={event.customEvent ?? ''} onChange={(item) => onChange({ customEvent: item.target.value })} /></label><label>事件数据<input value={event.value ?? ''} placeholder="可选，支持 {{变量}}" onChange={(item) => onChange({ value: item.target.value })} /></label></>}
  </>;
}
