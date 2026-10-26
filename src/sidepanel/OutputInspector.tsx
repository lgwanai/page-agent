import type { OutputNode, PageTarget, WorkflowNode } from '@/types/workflow';
import { NODE_KIND_LABELS } from '@/types/workflow';

export function OutputInspector({ node, nodes, onChange, onPick }: {
  node: OutputNode; nodes: WorkflowNode[]; onChange: (node: OutputNode) => void; onPick: () => void;
}) {
  const target: PageTarget = node.target ?? { name: node.name, selector: '', frameId: 0, tagName: '', label: '' };
  return <>
    <label>输出来源<select value={node.source} onChange={event => onChange({ ...node, source: event.target.value as OutputNode['source'], value: node.value ?? '', read: node.read ?? 'text', target })}>
      <option value="text">文本（支持拼接变量）</option><option value="variable">变量（保留原始类型）</option><option value="node">前序节点输出</option><option value="dom">读取 DOM</option>
    </select></label>
    {(node.source === 'text' || node.source === 'variable') && <label>返回内容<textarea value={node.value ?? ''} placeholder={node.source === 'text' ? '例如：未成功，或 任务状态：{{状态}}' : '{{参数名}} 或 {{节点名称.output}}'} onChange={event => onChange({ ...node, value: event.target.value })} /><small>{node.source === 'variable' ? '单独引用变量，数字、对象和列表保持原始类型；不存在的变量会报错。' : '文本返回字符串；可通过 {{变量}} 插入内容。'}</small></label>}
    {node.source === 'node' && <>
      <label>引用节点<select value={node.sourceNodeId ?? ''} onChange={event => onChange({ ...node, sourceNodeId: event.target.value })}><option value="">选择已执行的前序节点</option>{nodes.filter(item => item.id !== node.id).map(item => <option key={item.id} value={item.id}>{item.name} · {NODE_KIND_LABELS[item.kind]}</option>)}</select></label>
      <label>返回字段（可选）<input value={node.path ?? ''} placeholder="留空返回完整输出，例如 rows.0.金额" onChange={event => onChange({ ...node, path: event.target.value })} /><small>只读取已执行节点；不存在的字段会报错，不会返回伪造的空值。</small></label>
    </>}
    {node.source === 'dom' && <>
      <button className="secondary" onClick={onPick}>⌖ 在网页选择输出 DOM</button>
      <label>使用已有节点的 DOM<select value="" onChange={event => { const source = nodes.find(item => item.id === event.target.value); if (source && 'target' in source && source.target) onChange({ ...node, target: { ...source.target, name: node.name } }); }}><option value="">选择已有节点</option>{nodes.filter(item => item.id !== node.id && 'target' in item && item.target).map(item => <option key={item.id} value={item.id}>{item.name} · {NODE_KIND_LABELS[item.kind]}</option>)}</select></label>
      <label>输出 Selector<textarea value={target.selector} onChange={event => onChange({ ...node, target: { ...target, selector: event.target.value } })} /><small>支持变量；Frame：{target.frameId}。只读取，不点击、不修改页面。</small></label>
      <label>读取内容<select value={node.read ?? 'text'} onChange={event => onChange({ ...node, read: event.target.value as OutputNode['read'] })}><option value="text">文本内容</option><option value="value">输入框 / 下拉框的当前值</option><option value="attribute">指定 DOM 属性</option></select></label>
      {node.read === 'attribute' && <label>属性名称<input value={node.attributeName ?? ''} placeholder="例如 href、data-status、aria-valuenow" onChange={event => onChange({ ...node, attributeName: event.target.value })} /></label>}
      <label className="check-label"><input type="checkbox" checked={Boolean(node.multiple)} onChange={event => onChange({ ...node, multiple: event.target.checked })} />读取全部匹配项（返回列表）</label>
      <small>默认必须唯一匹配；缺失节点、属性或读取密码 / 隐藏输入会报错。</small>
    </>}
    <label>业务结果<select value={node.outcome ?? 'neutral'} onChange={event => onChange({ ...node, outcome: event.target.value as OutputNode['outcome'] })}><option value="neutral">仅返回内容，不标记业务结果</option><option value="success">业务成功</option><option value="failure">业务未成功</option></select></label>
    <div className="port-help">MCP 返回 <code>output</code>（最后一次输出）、<code>outputs</code>（按节点名称汇总）。业务标记使用 <code>businessOk</code>，不与执行状态 <code>ok</code> 混用。输出后按连线继续；不连接后续节点即结束。</div>
  </>;
}
