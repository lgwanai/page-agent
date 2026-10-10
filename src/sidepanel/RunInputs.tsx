import { useEffect, useRef, useState } from 'react';
import { START_INPUT_TYPE_LABELS, type StartInputDeclaration } from '@/types/workflow';

export function parseRunInputs(inputs: StartInputDeclaration[], values: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);
  const names = new Set<string>();
  for (const input of inputs) {
    const name = input.name.trim();
    if (!name || names.has(name)) throw new Error('参数名称不能为空或重复，请修改开始节点');
    names.add(name);
    const raw = values[input.id] ?? '';
    if (!raw.trim()) {
      if (input.required) throw new Error(`请填写必填参数「${name}」`);
      continue;
    }
    let value: unknown = raw;
    if (input.type === 'number') {
      value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`「${name}」需要有效数字`);
    } else if (input.type !== 'string') {
      try { value = JSON.parse(raw); } catch { throw new Error(`「${name}」格式不正确，请填写有效 JSON`); }
      const object = (item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item);
      const valid = input.type === 'object' ? object(value)
        : Array.isArray(value) && (input.type === 'objectArray' ? value.every(object) : value.every((item) => !object(item)));
      if (!valid) throw new Error(`「${name}」需要${START_INPUT_TYPE_LABELS[input.type]}`);
    }
    result[name] = value;
  }
  return result;
}

export function RunInputs({ inputs, historyKey, onCancel, onRun }: {
  inputs: StartInputDeclaration[]; historyKey: string; onCancel: () => void; onRun: (variables: Record<string, unknown>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const panel = useRef<HTMLFormElement>(null);
  const inputSignature = JSON.stringify(inputs);
  useEffect(() => {
    let disposed = false;
    const key = `pageAgentRunInputs:${historyKey}`;
    void chrome.storage.local.get(key).then((stored) => {
      if (disposed) return;
      const history = stored[key] as Record<string, { type: string; value: string }> | undefined;
      const next: Record<string, string> = {};
      for (const input of inputs) {
        const item = history?.[input.name];
        if (item?.type === input.type && typeof item.value === 'string') next[input.id] = item.value;
      }
      setValues(next); setLoading(false);
    }).catch(() => { if (!disposed) { setLoading(false); setError('无法读取上次参数，请重新填写'); } });
    return () => { disposed = true; };
  }, [historyKey, inputSignature]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('input, textarea, button')?.focus();
    return () => previous?.focus();
  }, []);
  return <div className="settings-overlay"><form ref={panel} className="settings-panel run-inputs-panel" role="dialog" aria-modal="true" aria-labelledby="run-inputs-title" onKeyDown={(event) => {
    if (event.key === 'Escape' && !submitting) onCancel();
    if (event.key === 'Tab') {
      const fields = Array.from(panel.current?.querySelectorAll<HTMLElement>('input, textarea, button') ?? []);
      const first = fields[0]; const last = fields[fields.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }} onSubmit={(event) => {
    event.preventDefault();
    if (loading || submitting) return;
    try {
      const variables = parseRunInputs(inputs, values);
      const history = Object.fromEntries(inputs.map((input) => [input.name, { type: input.type, value: values[input.id] ?? '' }]));
      setSubmitting(true);
      void chrome.storage.local.set({ [`pageAgentRunInputs:${historyKey}`]: history })
        .then(() => onRun(variables))
        .catch(() => { setSubmitting(false); setError('无法保存上次参数，请重试'); });
    } catch (reason) { setError((reason as Error).message); }
  }}>
    <h2 id="run-inputs-title">填写运行参数</h2>
    <p>自动回填上次运行参数，仅保存在本机，不写入工作流或导出文件。</p>
    {inputs.map((input) => <label key={input.id} className="run-input-field">
      <strong>{input.name} · {START_INPUT_TYPE_LABELS[input.type]}{input.required ? '（必填）' : '（选填）'}</strong>
      {input.description && <small>{input.description}</small>}
      {input.type === 'string' || input.type === 'number'
        ? <input aria-label={input.name} type={input.type === 'number' ? 'number' : 'text'} step="any" value={values[input.id] ?? ''} onChange={(event) => setValues({ ...values, [input.id]: event.target.value })} />
        : <textarea aria-label={input.name} rows={4} placeholder={input.type === 'object' ? '{"名称":"示例"}' : input.type === 'objectArray' ? '[{"名称":"示例"}]' : '["示例1","示例2"]'} value={values[input.id] ?? ''} onChange={(event) => setValues({ ...values, [input.id]: event.target.value })} />}
    </label>)}
    {error && <p role="alert">{error}</p>}
    <div className="settings-actions"><button type="button" className="secondary" disabled={submitting} onClick={onCancel}>取消</button><button type="submit" className="primary" disabled={loading || submitting}>{loading ? '读取上次参数…' : submitting ? '准备运行…' : '开始运行'}</button></div>
  </form></div>;
}
