import { useEffect, useRef, useState } from 'react';
import type { StartInputType } from '@/types/workflow';

type ValueType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';
interface ValueDraft { id: string; name: string; type: ValueType; value: string; children: ValueDraft[] }
const LABELS: Record<ValueType, string> = { string: '文本', number: '数字', boolean: '是 / 否', null: '空值', object: '对象', array: '列表' };
let nextId = 0;
export function valueDraft(value: unknown, name = '', depth = 0, budget = { remaining: 100000 }): ValueDraft {
  if (depth > 20 || --budget.remaining < 0) throw new Error('数据层级或数量过多，请拆分后再填写');
  const type: ValueType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'object' ? 'object' : typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string';
  return { id: `value-${++nextId}`, name, type, value: type === 'null' ? '' : String(value), children: type === 'object'
    ? Object.entries(value as Record<string, unknown>).map(([key, item]) => valueDraft(item, key, depth + 1, budget))
    : type === 'array' ? (value as unknown[]).map(item => valueDraft(item, '', depth + 1, budget)) : [] };
}
export function readValueDraft(node: ValueDraft, path: string): unknown {
  if (node.type === 'object') {
    const entries: Array<[string, unknown]> = [];
    const names = new Set<string>();
    for (const child of node.children) {
      if (!child.name.trim()) throw new Error(`${path}：请填写字段名`);
      if (names.has(child.name)) throw new Error(`${path}：字段「${child.name}」重复`);
      names.add(child.name);
      entries.push([child.name, readValueDraft(child, `${path}.${child.name}`)]);
    }
    return Object.fromEntries(entries);
  }
  if (node.type === 'array') return node.children.map((child, index) => readValueDraft(child, `${path}[${index + 1}]`));
  if (node.type === 'number') {
    if (!node.value.trim() || !Number.isFinite(Number(node.value))) throw new Error(`${path}：请填写有效数字`);
    return Number(node.value);
  }
  if (node.type === 'boolean') return node.value === 'true';
  if (node.type === 'null') return null;
  return node.value;
}
function changeType(node: ValueDraft, type: ValueType): ValueDraft {
  const initial = type === 'object' ? {} : type === 'array' ? [] : type === 'boolean' ? false : type === 'number' ? 0 : type === 'null' ? null : '';
  return { ...valueDraft(initial, node.name), id: node.id };
}

function ValueEditor({ node, path, rootType, onChange, depth = 0 }: {
  node: ValueDraft; path: string; rootType?: StartInputType; onChange: (node: ValueDraft) => void; depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [limit, setLimit] = useState(30);
  const container = node.type === 'object' || node.type === 'array';
  return <div className="structured-value">
    {!container ? node.type === 'boolean' ? <select aria-label={`${path}的值`} value={node.value} onChange={event => onChange({ ...node, value: event.target.value })}><option value="true">是（true）</option><option value="false">否（false）</option></select>
      : node.type === 'null' ? <span className="structured-empty">空值 null</span>
        : <input aria-label={`${path}的值`} type={node.type === 'number' ? 'number' : 'text'} step="any" value={node.value} onChange={event => onChange({ ...node, value: event.target.value })} />
      : <>
        <div className="structured-heading"><button type="button" className="structured-toggle" aria-label={`${expanded ? '收起' : '展开'}${path}`} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '▾' : '▸'} {node.type === 'object' ? '对象' : '列表'} · {node.children.length} {node.type === 'object' ? '个字段' : '项'}</button>
          <button type="button" className="secondary" disabled={depth >= 20} aria-label={`给${path}添加${node.type === 'object' ? '字段' : '一项'}`} onClick={() => { setExpanded(true); setLimit(node.children.length + 1); onChange({ ...node, children: [...node.children, valueDraft(rootType === 'objectArray' ? {} : '')] }); }}>＋ {node.type === 'object' ? '添加字段' : '添加一项'}</button></div>
        {expanded && <div className="structured-children">
          {!node.children.length && <span className="structured-empty">{node.type === 'object' ? '暂无字段，可添加嵌套对象或列表。' : '暂无项目，点击添加。'}</span>}
          {node.children.slice(0, limit).map((child, index) => {
            const childPath = node.type === 'object' ? `${path}.${child.name || `字段${index + 1}`}` : `${path}[${index + 1}]`;
            const types = rootType === 'objectArray' ? ['object'] : rootType === 'array' ? ['string', 'number', 'boolean', 'null', 'array'] : Object.keys(LABELS);
            const update = (next: ValueDraft) => onChange({ ...node, children: node.children.map(item => item.id === child.id ? next : item) });
            return <div className="structured-row" key={child.id}>
              <div className="structured-row-head">
                {node.type === 'object' ? <input aria-label={`${path}的第${index + 1}个字段名`} placeholder="字段名称" value={child.name} onChange={event => update({ ...child, name: event.target.value })} /> : <span className="structured-index">第 {index + 1} 项</span>}
                <select aria-label={`${childPath}的类型`} value={child.type} onChange={event => update(changeType(child, event.target.value as ValueType))}>{types.map(type => <option key={type} value={type}>{LABELS[type as ValueType]}</option>)}</select>
                <button type="button" className="icon-btn danger" aria-label={`删除${childPath}`} onClick={() => onChange({ ...node, children: node.children.filter(item => item.id !== child.id) })}>×</button>
              </div>
              <ValueEditor node={child} path={childPath} depth={depth + 1} onChange={update} />
            </div>;
          })}
          {node.children.length > limit && <button type="button" className="secondary" onClick={() => setLimit(limit + 30)}>再显示 30 项（还有 {node.children.length - limit} 项）</button>}
        </div>}
      </>}
  </div>;
}

export function StructuredRunInput({ type, name, value, onChange }: {
  type: 'object' | 'array' | 'objectArray'; name: string; value: string; onChange: (raw: string, error?: string) => void;
}) {
  const empty = () => valueDraft(type === 'object' ? {} : []);
  const [draft, setDraft] = useState(empty);
  const [jsonMode, setJsonMode] = useState(false);
  const [localError, setLocalError] = useState('');
  const lastValue = useRef<string | null>(null);
  const load = (raw: string) => {
    const parsed = raw.trim() ? JSON.parse(raw) : type === 'object' ? {} : [];
    const object = (item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item);
    if (!(type === 'object' ? object(parsed) : Array.isArray(parsed) && (type === 'objectArray' ? parsed.every(object) : parsed.every(item => !object(item))))) throw new Error('数据类型与参数声明不一致');
    return valueDraft(parsed);
  };
  useEffect(() => {
    if (lastValue.current === value) return;
    lastValue.current = value;
    try { setDraft(load(value)); setLocalError(''); }
    catch { setJsonMode(true); setLocalError('请先修正 JSON，再切换分层表单'); }
  }, [value, type]);
  const update = (next: ValueDraft) => {
    setDraft(next);
    try {
      const raw = JSON.stringify(readValueDraft(next, name));
      lastValue.current = raw; setLocalError(''); onChange(raw);
    } catch (reason) {
      const message = (reason as Error).message;
      setLocalError(message); onChange(value, message);
    }
  };
  return <div className="structured-input" role="group" aria-label={`${name}分层参数`}>
    <div className="structured-mode"><span>{value.trim() ? '已提供此参数' : '尚未提供此参数'}</span><button type="button" className="secondary" disabled={!jsonMode && Boolean(localError)} onClick={() => {
      if (jsonMode) {
        try { setDraft(load(value)); setLocalError(''); onChange(value); setJsonMode(false); }
        catch (reason) { setLocalError((reason as Error).message); }
      } else if (localError) { /* Preserve unfinished fields rather than silently discarding them. */ }
      else setJsonMode(true);
    }}>{jsonMode ? '分层表单' : '粘贴 / 编辑 JSON'}</button></div>
    {jsonMode ? <textarea aria-label={name} rows={5} value={value} placeholder={type === 'object' ? '{"名称":"示例"}' : type === 'objectArray' ? '[{"名称":"示例"}]' : '["示例1", 2]'} onChange={event => { lastValue.current = event.target.value; setLocalError(''); onChange(event.target.value); }} />
      : <ValueEditor node={draft} path={name} rootType={type} onChange={update} />}
    <div className="structured-actions">{!value.trim() && !localError && <button type="button" className="secondary" onClick={() => update(draft)}>使用空{type === 'object' ? '对象' : '列表'}</button>}<button type="button" className="structured-clear" onClick={() => { setDraft(empty()); lastValue.current = ''; setLocalError(''); onChange(''); }}>清空，不提供此参数</button></div>
    {localError && <p className="structured-error" role="alert">{localError}</p>}
  </div>;
}
