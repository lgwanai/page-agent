import {
  createId, EVENT_LABELS, NODE_KIND_LABELS, type ActionDefinition, type AiInputBinding,
  type ConditionOperator, type EventDefinition, type WorkflowNode,
} from '@/types/workflow';

const eventOptions = Object.entries(EVENT_LABELS) as Array<[EventDefinition['type'], string]>;
const conditionOptions: Array<[ConditionOperator, string]> = [
  ['equals', '等于'], ['notEquals', '不等于'], ['contains', '包含'], ['exists', '存在'], ['greaterThan', '大于'], ['lessThan', '小于'],
];

export function NodeInspector({ node, nodes, actions, onChange, onDelete, onRun, onPickAiSelector, notify }: {
  node: WorkflowNode | undefined;
  nodes: WorkflowNode[];
  actions: ActionDefinition[];
  onChange: (node: WorkflowNode) => void;
  onDelete: () => void;
  onRun: () => void;
  onPickAiSelector: () => void;
  notify: (message: string) => void;
}) {
  if (!node) return <aside className="node-inspector empty-inspector"><strong>节点设置</strong><p>在画布中选择一个节点查看和编辑属性。拖动节点端口建立成功、失败、条件或循环连线。</p></aside>;
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

  return <aside className="node-inspector">
    <div className="inspector-head"><div><strong>{NODE_KIND_LABELS[node.kind]}</strong><span>{node.id}</span></div><div><button className="icon-btn" title="运行节点" onClick={onRun}>▶</button><button className="icon-btn danger" title="删除节点" onClick={onDelete}>×</button></div></div>
    <label>节点名称<input value={node.name} onChange={(event) => updateName(event.target.value)} /><small>在 AI 输入和 `{'{{节点名.output}}'}` 表达式中使用，必须唯一。</small></label>

    {node.kind === 'dom' && <>
      <label>Selector 名称<input value={node.target.name} onChange={(event) => updateName(event.target.value)} /></label>
      <label>Selector<textarea className="code-input" value={node.target.selector} onChange={(event) => onChange({ ...node, target: { ...node.target, selector: event.target.value } })} /></label>
      <div className="field-grid"><label>元素类型<input value={node.target.tagName} disabled /></label><label>Frame<input value={node.target.frameId} disabled /></label></div>
      <EventEditor event={node.event} onChange={updateEvent} />
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
      <div className="ai-behavior"><strong>模型可执行的动作</strong><p>AI 可以返回一个输入 selector 上的事件，或按准确名称调用已保存 Action。也可以只返回 output，交给条件节点判断。</p></div>
    </>}

    {node.kind === 'condition' && <>
      <label>左值 / 表达式<input value={node.left} placeholder="{{AI判断.decision}}" onChange={(event) => onChange({ ...node, left: event.target.value })} /></label>
      <label>判断方式<select value={node.operator} onChange={(event) => onChange({ ...node, operator: event.target.value as ConditionOperator })}>{conditionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {node.operator !== 'exists' && <label>比较值<input value={node.right ?? ''} placeholder="支持 {{变量}}" onChange={(event) => onChange({ ...node, right: event.target.value })} /></label>}
      <div className="port-help"><span className="port-true">是</span>与<span className="port-false">否</span>端口分别连接两个分支；执行异常走失败端口。</div>
    </>}

    {node.kind === 'loop' && <>
      <label>遍历数组<input value={node.items} placeholder="{{AI节点.output.items}} 或 [1,2,3]" onChange={(event) => onChange({ ...node, items: event.target.value })} /></label>
      <div className="field-grid"><label>当前项变量<input value={node.itemVariable} onChange={(event) => onChange({ ...node, itemVariable: event.target.value })} /></label><label>索引变量<input value={node.indexVariable} onChange={(event) => onChange({ ...node, indexVariable: event.target.value })} /></label></div>
      <label>最大循环次数<input type="number" min="1" max="1000" value={node.maxIterations} onChange={(event) => onChange({ ...node, maxIterations: Number(event.target.value) })} /></label>
      <div className="port-help">遍历端口连接循环体，循环体最后一个节点需要连回本循环节点；完成端口连接循环后的流程。</div>
    </>}

    {node.kind === 'wait' && <label>等待毫秒<input type="number" min="0" max="60000" value={node.durationMs} onChange={(event) => onChange({ ...node, durationMs: Number(event.target.value) })} /></label>}
    {node.kind === 'action' && <label>选择 Action<select value={node.actionId} onChange={(event) => onChange({ ...node, actionId: event.target.value })}><option value="">请选择</option>{actions.map((action) => <option value={action.id} key={action.id}>{action.name}</option>)}</select></label>}
    <label className="check-label"><input type="checkbox" checked={Boolean(node.continueOnError)} onChange={(event) => onChange({ ...node, continueOnError: event.target.checked })} />没有失败连线时，失败后从成功端口继续</label>
  </aside>;
}

function EventEditor({ event, onChange }: { event: EventDefinition; onChange: (patch: Partial<EventDefinition>) => void }) {
  return <><label>操作<select value={event.type} onChange={(item) => onChange({ type: item.target.value as EventDefinition['type'] })}>{eventOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    {['input', 'select', 'check', 'pressKey', 'custom'].includes(event.type) && <label>操作值<input value={event.value ?? ''} placeholder="支持 {{变量}}" onChange={(item) => onChange({ value: item.target.value })} /></label>}
    {event.type === 'custom' && <label>自定义事件名<input value={event.customEvent ?? ''} onChange={(item) => onChange({ customEvent: item.target.value })} /></label>}
  </>;
}
