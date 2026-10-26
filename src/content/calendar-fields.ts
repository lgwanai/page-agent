// Associate a popup with its own editable fields. Never infer a range from
// arbitrary input changes elsewhere on the document.
type FieldKind = 'pair' | 'combined' | 'single';
export interface CalendarFields { kind: FieldKind; read: () => HTMLInputElement[] }

function fieldVisible(input: HTMLInputElement): boolean {
  if (!input.isConnected || !['text', 'date', 'datetime-local', ''].includes(input.type)) return false;
  for (let element: HTMLElement | null = input; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  }
  return Array.from(input.getClientRects()).some(rect => rect.width > 0 && rect.height > 0);
}
function fieldsIn(scope: HTMLElement): HTMLInputElement[] {
  return Array.from(scope.querySelectorAll<HTMLInputElement>('input')).filter(fieldVisible);
}
function fieldRole(input: HTMLInputElement): 'start' | 'end' | undefined {
  const label = [input.placeholder, input.getAttribute('aria-label'), input.name, input.id, input.getAttribute('data-field')]
    .join(' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  const start = /开始|起始|起点|起日|(?:^|[\s_-])(?:start|begin|from)(?:$|[\s_-])/i.test(label);
  const end = /结束|截止|终止|止日|(?:^|[\s_-])(?:end|until|to)(?:$|[\s_-])/i.test(label);
  return start === end ? undefined : start ? 'start' : 'end';
}
function orderedPair(fields: HTMLInputElement[], trustedOrder: boolean): HTMLInputElement[] | undefined {
  const starts = fields.filter(field => fieldRole(field) === 'start');
  const ends = fields.filter(field => fieldRole(field) === 'end');
  if (starts.length === 1 && ends.length === 1) return [starts[0], ends[0]];
  if (!trustedOrder || fields.length !== 2 || starts.length > 1 || ends.length > 1) return undefined;
  if (starts.length === 1) return [starts[0], fields.find(field => field !== starts[0])!];
  if (ends.length === 1) return [fields.find(field => field !== ends[0])!, ends[0]];
  return fields;
}
function pickerScope(element: HTMLElement): boolean {
  return /(?:^|[\s_-])(?:picker|datepicker|date-editor|date-range|daterange)(?:$|[\s_-])/i.test(element.className);
}
function bind(scope: HTMLElement, range: boolean, trustedOrder: boolean): CalendarFields | undefined {
  const fields = fieldsIn(scope);
  const pair = orderedPair(fields, trustedOrder);
  if (range && pair) return { kind: 'pair', read: () => scope.isConnected ? orderedPair(fieldsIn(scope), trustedOrder) ?? [] : [] };
  if (fields.length === 1) return { kind: range ? 'combined' : 'single', read: () => scope.isConnected ? fieldsIn(scope) : [] };
  return undefined;
}

export function findCalendarFields(container: HTMLElement, range: boolean): CalendarFields | undefined {
  const active = document.activeElement;
  const activeInputs = active instanceof HTMLInputElement && fieldVisible(active) ? [active]
    : Array.from(document.querySelectorAll<HTMLInputElement>('[class*="picker-input-active"] input')).filter(fieldVisible);
  // A focused opener is the strongest association, including portal popups
  // that are rendered as body children rather than inside the input wrapper.
  if (activeInputs.length === 1) {
    let combined: CalendarFields | undefined;
    for (let scope = activeInputs[0].parentElement; scope && scope !== document.body; scope = scope.parentElement) {
      const trusted = pickerScope(scope);
      const fields = fieldsIn(scope);
      if (trusted || orderedPair(fields, false)) {
        const binding = bind(scope, range, trusted);
        if (trusted && fields.length > 1 && !binding) combined = undefined;
        if (binding?.kind === 'combined' && trusted) combined = binding;
        else if (binding && binding.read().includes(activeInputs[0])) return binding;
      }
      if (scope.tagName === 'FORM') break;
    }
    if (combined) return combined;
  }
  // Native/custom widgets can explicitly link their opener to the popup.
  const linked = Array.from(document.querySelectorAll<HTMLElement>('[aria-controls], [aria-owns]')).filter(element =>
    [element.getAttribute('aria-controls'), element.getAttribute('aria-owns')].join(' ').split(/\s+/).some(id => {
      const popup = id ? document.getElementById(id) : null;
      return popup && (popup === container || popup.contains(container) || container.contains(popup));
    }));
  if (linked.length === 1) {
    const opener = linked[0];
    if (opener instanceof HTMLInputElement) {
      let combined: CalendarFields | undefined;
      for (let scope = opener.parentElement; scope && scope !== document.body; scope = scope.parentElement) {
        if (pickerScope(scope) || orderedPair(fieldsIn(scope), false)) {
          const binding = bind(scope, range, pickerScope(scope));
          if (binding?.kind === 'combined') combined = binding;
          else if (binding) return binding;
        }
      }
      if (combined) return combined;
      if (fieldVisible(opener)) return { kind: range ? 'combined' : 'single', read: () => fieldVisible(opener) ? [opener] : [] };
    }
    const binding = bind(opener, range, true);
    if (binding) return binding;
  }
  return bind(container, range, true);
}

export function normalizeCalendarField(value: string): string | undefined {
  const normalized = value.trim().replace(/年|月/g, '-').replace(/日$/, '');
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/.exec(normalized);
  if (!match) return undefined;
  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : undefined;
}

export function hasUnboundCalendarFields(): boolean {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input')).filter(fieldVisible).some(input =>
    fieldRole(input) !== undefined || /^date/.test(input.type) || /日期|date|range/i.test([input.placeholder, input.getAttribute('aria-label'), input.name, input.id].join(' ')) || normalizeCalendarField(input.value) !== undefined);
}

export function readCalendarFields(binding: CalendarFields): { dates: string[]; fields: Record<string, string> } {
  const fields = binding.read();
  if (binding.kind === 'pair') return { dates: fields.length === 2 ? fields.map(field => normalizeCalendarField(field.value) ?? '') : [], fields: { start: fields[0]?.value ?? '', end: fields[1]?.value ?? '' } };
  const raw = fields.length === 1 ? fields[0].value : '';
  if (binding.kind === 'single') return { dates: [normalizeCalendarField(raw) ?? ''], fields: { date: raw } };
  // A combined field has no separate end focus target; verify BOTH dates from
  // its current value instead of using two remembered click receipts.
  const parts = raw.match(/\d{4}[-/年]\d{1,2}[-/月]\d{1,2}日?/g) ?? [];
  if (parts.length === 2) {
    // Do not ignore an error suffix/prefix or unrelated text around two dates.
    const remainder = raw.replace(parts[0], '@').replace(parts[1], '@').trim();
    if (!/^@\s*(?:~|～|至|到|—|–|-|,)\s*@$/.test(remainder)) return { dates: [], fields: { range: raw } };
  }
  return { dates: parts.map(part => normalizeCalendarField(part) ?? ''), fields: { range: raw } };
}
