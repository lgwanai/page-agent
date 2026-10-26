import type { StartNode, StartInputType } from '@/types/workflow';
type Variables = Record<string, unknown>;
type RuntimeContext = Record<string, unknown>;
function getPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, source);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function matchesInputType(value: unknown, type: StartInputType): boolean {
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'array') return Array.isArray(value) && value.every((item) => !isObject(item));
  if (type === 'object') return isObject(value);
  return Array.isArray(value) && value.every(isObject);
}

const INPUT_TYPE_NAMES: Record<StartInputType, string> = {
  string: '文本', number: '数字', array: '列表', object: '对象', objectArray: '对象列表',
};

/** Maps same-named top-level JSON fields onto the variables declared by Start. */
export function mapStartInputs(node: StartNode, payload: Variables): Variables {
  const mapped: Variables = {};
  const names = new Set<string>();
  for (const input of node.inputs ?? []) {
    const name = input.name.trim();
    if (!name) throw new Error('Start 输入存在未命名参数');
    if (names.has(name)) throw new Error(`Start 输入参数名重复：${name}`);
    names.add(name);

    const value = payload[name];
    if (value === undefined) {
      if (input.required) throw new Error(`MCP JSON 缺少必填参数：${name}`);
      continue;
    }
    const type = input.type ?? 'string';
    if (!matchesInputType(value, type)) throw new Error(`MCP 参数「${name}」类型不正确，需要${INPUT_TYPE_NAMES[type]}`);
    mapped[name] = value;
  }
  return mapped;
}

export function resolveValue(value: string | undefined, variables: Variables, context: RuntimeContext): unknown {
  if (value === undefined) return undefined;
  const exact = value.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  const read = (key: string) => {
    const resolved = Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : Object.prototype.hasOwnProperty.call(context, key) ? context[key] : getPath({ ...context, ...variables }, key);
    return Object.prototype.hasOwnProperty.call(context, key) && !Object.prototype.hasOwnProperty.call(variables, key) && resolved && typeof resolved === 'object' && Object.prototype.hasOwnProperty.call(resolved, 'output') ? (resolved as { output: unknown }).output : resolved;
  };
  if (exact) return read(exact[1].trim());
  return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, key: string) => {
    const resolved = read(key.trim());
    if (resolved && typeof resolved === 'object' && (resolved as { type?: string }).type === 'files') throw new Error('文件变量必须单独引用，不能拼接到文本中；请放入邮件附件');
    return typeof resolved === 'object' && resolved !== null ? JSON.stringify(resolved) : String(resolved ?? '');
  });
}

export function interpolate(value: string | undefined, variables: Variables, context: RuntimeContext): string | undefined {
  const resolved = resolveValue(value, variables, context);
  return resolved === undefined ? undefined : typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
}

