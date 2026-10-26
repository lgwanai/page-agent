import type { TableFillStructure } from '@/types/workflow';
import { fillCellValue as cellValue, fillVisible as visible, readFillGrid } from './table-fill-grid';
type RowData = Record<string, unknown>;
export interface TableFillReport {
  type: 'tableFill'; matchedRows: number; filledCells: number; skippedCells: number; unmatchedRows: number;
  cells: Array<{ row: number; column: string; status: 'filled' | 'skipped' | 'failed'; reason?: string }>;
  structure: { layout: string; columns: string[]; rowCount: number };
}
const norm = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const pause = () => new Promise(resolve => setTimeout(resolve, 60));
function editable(element: Element): boolean {
  return visible(element) && !element.matches(':disabled,[readonly],[aria-disabled="true"],[aria-readonly="true"]');
}
function values(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(norm);
  if (value === null || value === undefined || value === '') return [];
  return [norm(value)];
}
function matchOption<T>(items: T[], requested: string, value: (item: T) => string, label: (item: T) => string): T {
  let matches = items.filter(item => norm(value(item)) === requested);
  if (!matches.length) matches = items.filter(item => norm(label(item)) === requested);
  if (matches.length !== 1) throw new Error(`选项「${requested}」${matches.length ? '不唯一' : '不存在'}，未猜选`);
  return matches[0];
}
const label = (el: HTMLInputElement) => norm(el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.value);
function boolean(value: unknown): boolean {
  if (['true', '1', '是', '选中', 'yes'].includes(norm(value).toLowerCase())) return true;
  if (['false', '0', '否', '未选中', 'no', ''].includes(norm(value).toLowerCase())) return false;
  throw new Error('单个复选框需提供 true/false、1/0 或 是/否');
}
type Plan = { reason?: string; apply?: () => void | Promise<void>; verify?: (fresh: Element) => boolean };
function planNative(cell: Element, value: unknown): Plan | undefined {
  if (!editable(cell)) return { reason: '单元格不可编辑' };
  const controls = [...cell.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input:not([type="hidden"]),select,textarea')].filter(visible);
  const roles = [...cell.querySelectorAll<HTMLElement>('[role="radio"],[role="checkbox"]')].filter(visible);
  if (roles.length && !controls.length) {
    if (roles.some(el => !editable(el))) return { reason: '选项组禁用或只读' };
    const radio = roles.some(el => el.getAttribute('role') === 'radio');
    let requested = values(value);
    if (!radio && roles.length === 1) requested = boolean(value) ? [norm(roles[0].getAttribute('data-value') || roles[0].getAttribute('aria-label') || roles[0].textContent)] : [];
    if (radio && requested.length !== 1) throw new Error('单选组需且仅需提供一个选项');
    const chosen = requested.map(v => matchOption(roles, v, el => el.getAttribute('data-value') || '', el => el.getAttribute('aria-label') || norm(el.textContent)));
    const expected = roles.map(el => chosen.includes(el));
    return { apply: () => { roles.forEach((el, i) => { if ((el.getAttribute('aria-checked') === 'true') !== expected[i]) el.click(); }); }, verify: fresh => {
      const next = [...fresh.querySelectorAll('[role="radio"],[role="checkbox"]')].filter(visible);
      return next.length === expected.length && next.every((el, i) => (el.getAttribute('aria-checked') === 'true') === expected[i]);
    } };
  }
  const selects = controls.filter((el): el is HTMLSelectElement => el instanceof HTMLSelectElement);
  if (selects.length === 1 && controls.length === 1) {
    const select = selects[0]; if (!editable(select)) return { reason: '下拉框禁用或只读' };
    let requested = values(value);
    if (select.multiple && requested.length === 1 && ![...select.options].some(o => norm(o.value) === requested[0] || norm(o.text) === requested[0])) requested = requested[0].split(/[,，;；|]/).map(norm).filter(Boolean);
    if (!select.multiple && requested.length > 1) throw new Error('单选下拉框不能填入多个值');
    const options = requested.map(v => matchOption([...select.options], v, o => o.value, o => o.text));
    if (options.some(o => o.disabled || o.parentElement instanceof HTMLOptGroupElement && o.parentElement.disabled)) throw new Error('匹配的下拉选项已禁用');
    const expected = options.map(o => o.value).sort();
    return { apply: () => { select.focus(); for (const option of [...select.options]) option.selected = options.includes(option); if (!options.length) select.selectedIndex = -1; select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true })); select.blur(); }, verify: fresh => {
      const el = fresh.querySelector('select'); return Boolean(el) && JSON.stringify([...el!.selectedOptions].map(o => o.value).sort()) === JSON.stringify(expected);
    } };
  }
  const checks = controls.filter((el): el is HTMLInputElement => el instanceof HTMLInputElement && ['radio', 'checkbox'].includes(el.type));
  if (checks.length && checks.length === controls.length) {
    if (checks.some(el => !editable(el))) return { reason: '单选/多选组包含禁用或只读控件' };
    let chosen: HTMLInputElement[];
    if (checks.length === 1 && checks[0].type === 'checkbox') chosen = boolean(value) ? checks : [];
    else {
      let requested = values(value);
      if (checks[0].type === 'checkbox' && requested.length === 1 && !checks.some(el => norm(el.value) === requested[0] || label(el) === requested[0])) requested = requested[0].split(/[,，;；|]/).map(norm).filter(Boolean);
      if (checks.some(el => el.type === 'radio') && requested.length !== 1) throw new Error('单选组需且仅需提供一个选项');
      chosen = requested.map(v => matchOption(checks, v, el => el.value, label));
    }
    const expected = checks.map(el => chosen.includes(el));
    return { apply: () => { checks.forEach((el, i) => { if (el.checked !== expected[i]) el.click(); }); }, verify: fresh => {
      const next = [...fresh.querySelectorAll<HTMLInputElement>('input[type="radio"],input[type="checkbox"]')]; return next.length === expected.length && next.every((el, i) => el.checked === expected[i]);
    } };
  }
  if (controls.length === 1 && !(controls[0] instanceof HTMLSelectElement)) {
    const input = controls[0]; if (!editable(input)) return { reason: '输入框只读或禁用' };
    if (input instanceof HTMLInputElement && ['button', 'submit', 'reset', 'image', 'file', 'password', 'color', 'range'].includes(input.type)) return { reason: '不自动操作此输入类型' };
    if (value !== null && typeof value === 'object') throw new Error('普通输入框需要文本或数字，不能直接填写数组或对象');
    const expected = String(value ?? '');
    if (input instanceof HTMLInputElement && input.type === 'number' && expected && !Number.isFinite(Number(expected))) throw new Error('数字框不能填写非数字内容');
    return { apply: () => { input.focus(); const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, expected); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); input.blur(); }, verify: fresh => fresh.querySelector<HTMLInputElement | HTMLTextAreaElement>('input:not([type="hidden"]),textarea')?.value === expected };
  }
  const rich = cell.querySelector<HTMLElement>('[contenteditable="true"],[contenteditable="plaintext-only"]');
  if (rich && editable(rich)) {
    if (value !== null && typeof value === 'object') throw new Error('可编辑文本需要文本或数字');
    const expected = String(value ?? ''); return { apply: () => { rich.focus(); rich.textContent = expected; rich.dispatchEvent(new Event('input', { bubbles: true })); rich.dispatchEvent(new Event('change', { bubbles: true })); rich.blur(); }, verify: fresh => fresh.querySelector('[contenteditable]')?.textContent === expected };
  }
  if (controls.length > 1) throw new Error('同一单元格有多个非选项输入框，无法确定如何分配字段');
  return undefined;
}

async function fillCustom(cell: Element, value: unknown): Promise<(fresh: Element) => boolean> {
  const combo = cell.querySelector<HTMLElement>('[role="combobox"],[aria-haspopup="listbox"]');
  if (!combo || !visible(combo) || combo.matches(':disabled,[aria-disabled="true"],[aria-readonly="true"]')) throw new Error('未识别到可操作的自定义选择控件');
  const requested = values(value); if (!requested.length) throw new Error('自定义选择控件清空语义不明确，请使用专门的 Selector 操作');
  if (requested.length > 1 && !cell.matches('.ant-select-multiple,.el-select--multiple') && !cell.querySelector('[aria-multiselectable="true"],.ant-select-multiple,.el-select--multiple') && combo.getAttribute('aria-multiselectable') !== 'true') throw new Error('无法确认自定义下拉框支持多选，未写入多个值');
  const selected: Array<{ value: string; label: string }> = [];
  const existing = [...cell.querySelectorAll<HTMLElement>('.ant-select-selection-item,.el-tag')].map(el => norm(el.getAttribute('title') || el.textContent));
  if (requested.length > 1 && existing.some(item => !requested.includes(item))) throw new Error('自定义多选框已有额外选项，无法安全确认清空方式，请先用 Selector 清空再填充');
  for (const item of requested) {
    combo.click(); await pause();
    const popupId = combo.getAttribute('aria-controls') || combo.getAttribute('aria-owns');
    const scope = popupId ? document.getElementById(popupId) : document;
    if (!scope) throw new Error('自定义下拉列表未出现');
    const options = [...scope.querySelectorAll<HTMLElement>('[role="option"]')].filter(visible);
    const option = matchOption(options, item, el => el.getAttribute('data-value') ?? el.getAttribute('value') ?? '', el => norm(el.textContent));
    if (!editable(option)) throw new Error('匹配选项已禁用');
    selected.push({ value: norm(option.getAttribute('data-value') || option.getAttribute('value')), label: norm(option.textContent) });
    if (option.getAttribute('aria-selected') !== 'true') option.click();
    await pause();
  }
  return fresh => {
    const input = fresh.querySelector<HTMLInputElement>('input');
    const tags = [...fresh.querySelectorAll<HTMLElement>('.ant-select-selection-item,.el-tag,[aria-selected="true"],[data-selected="true"]')].filter(visible).map(el => norm(el.getAttribute('data-value') || el.getAttribute('title') || el.textContent));
    const matches = (actual: string, i: number) => Boolean(actual) && [requested[i], selected[i].value, selected[i].label].includes(actual);
    return tags.length ? tags.length === requested.length && requested.every((_, i) => tags.some(tag => matches(tag, i))) : requested.length === 1 && (matches(norm(input?.value), 0) || matches(norm(fresh.textContent), 0));
  };
}

export async function fillTable(selector: string, raw: unknown, keyColumns: string[], skipUnmatchedRows: boolean, structure?: TableFillStructure): Promise<TableFillReport> {
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { throw new Error('data 不是有效 JSON，对象数组应通过 {{data}} 传入'); } }
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray((raw as { rows?: unknown }).rows)) raw = (raw as { rows: unknown }).rows;
  if (!Array.isArray(raw) || raw.length > 5000 || raw.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('data 必须为不超过 5000 行的对象数组，或包含 rows 的 DataTable 结果');
  if (!keyColumns.length || keyColumns.some(key => !norm(key)) || new Set(keyColumns.map(norm)).size !== keyColumns.length) throw new Error('请配置至少一个不重复的 key 列');
  let fields = 0;
  const rows: RowData[] = raw.map((row: RowData) => {
    const normalized = Object.create(null) as RowData;
    for (const [field, value] of Object.entries(row)) {
      const name = norm(field);
      if (!name || Object.hasOwn(normalized, name)) throw new Error('data 包含空字段名或规范化后重名字段');
      if (++fields > 50000) throw new Error('填充数据超过 50000 个字段，请分批处理');
      normalized[name] = value;
    }
    return normalized;
  });
  const keys = keyColumns.map(norm);
  const fieldNames = [...new Set([...keys, ...rows.flatMap(row => Object.keys(row))])];
  const grid = () => readFillGrid(selector, keys, fieldNames, rows, structure);
  const initial = grid();
  if (keys.some(key => !initial.columns.includes(key))) throw new Error('key 列在网页表头中不存在');
  const keyOf = (row: RowData) => JSON.stringify(keys.map(key => { if (!Object.hasOwn(row, key) || !norm(row[key]) || typeof row[key] === 'object') throw new Error(`data 缺少有效 key：${key}`); return norm(row[key]); }));
  const lookup = () => {
    const current = grid();
    if (JSON.stringify(current.columns) !== JSON.stringify(initial.columns)) throw new Error('运行期间表头改变，已停止以避免写错列');
    if (current.identity !== initial.identity) throw new Error('运行期间识别到的数据行区域改变，已停止以避免切换到其他表格');
    const map = new Map<string, Element[][]>();
    for (const row of current.rows) { const key = JSON.stringify(keys.map(k => cellValue(row[current.columns.indexOf(k)]))); map.set(key, [...(map.get(key) ?? []), row]); }
    return map;
  };
  const initialMap = lookup(), seen = new Set<string>();
  const report: TableFillReport = { type: 'tableFill', matchedRows: 0, filledCells: 0, skippedCells: 0, unmatchedRows: 0, cells: [], structure: { layout: initial.layout, columns: initial.columns, rowCount: initial.rows.length } };
  const work: Array<{ data: RowData; key: string; index: number }> = [];
  // Validate all row identities before causing page writes.
  rows.forEach((data, index) => {
    const key = keyOf(data); if (seen.has(key)) throw new Error(`data 第 ${index + 1} 行 key 重复，未执行填充`); seen.add(key);
      const matches = initialMap.get(key) ?? [];
    if (matches.length > 1) throw new Error(`data 第 ${index + 1} 行匹配多个网页行，请增加 key 列，未执行填充`);
    if (!matches.length) { if (!skipUnmatchedRows) throw new Error(`data 第 ${index + 1} 行在当前表格找不到匹配记录，未执行填充`); report.unmatchedRows++; return; }
    work.push({ data, key, index });
  });
  const fail = (error: unknown) => Object.assign(new Error(`${(error as Error).message}；已填 ${report.filledCells} 个单元格，页面修改不会自动回滚`), { report });
  const currentRows = () => { try { return lookup(); } catch (error) { throw fail(error); } };
  const finalChecks: Array<{ key: string; column: string; c: number; index: number; verify: (fresh: Element) => boolean }> = [];
  for (const { data, key, index } of work) {
    report.matchedRows++;
    for (const [column, value] of Object.entries(data)) {
      if (keys.includes(column)) continue; // Never mutate row identity.
      const c = initial.columns.indexOf(column);
      const row = currentRows().get(key);
      if (row?.length !== 1) throw fail(new Error('运行期间行身份改变或重复，停止填充'));
      if (c < 0) { report.skippedCells++; report.cells.push({ row: index + 1, column, status: 'skipped', reason: '网页无同名列' }); continue; }
      try {
        let cell = row[0][c];
        const combo = cell.querySelector('[role="combobox"],[aria-haspopup="listbox"]');
        let plan = !editable(cell) ? { reason: '单元格不可编辑' } : combo ? !visible(combo) || combo.matches(':disabled,[aria-disabled="true"],[aria-readonly="true"]') ? { reason: '选择控件禁用或只读' } : undefined : planNative(cell, value);
        if (!plan && !combo) {
          const activation = cell.matches('[data-editable="true"],[aria-readonly="false"]') ? cell as HTMLElement : cell.querySelector<HTMLElement>('[data-editable="true"],.editable-cell-value-wrap,[aria-readonly="false"]');
          if (activation && editable(activation)) { activation.click(); await pause(); cell = currentRows().get(key)?.[0]?.[c] ?? cell; plan = planNative(cell, value); }
        }
        if (plan?.reason || (!plan && !cell.querySelector('[role="combobox"],[aria-haspopup="listbox"]'))) {
          report.skippedCells++; report.cells.push({ row: index + 1, column, status: 'skipped', reason: plan?.reason ?? '不可编辑或未发现受支持的编辑控件' }); continue;
        }
        let verify: (fresh: Element) => boolean;
        if (plan?.apply && plan.verify) { await plan.apply(); verify = plan.verify; }
        else { if (!editable(cell)) { report.skippedCells++; continue; } verify = await fillCustom(cell, value); }
        await pause();
        const fresh = currentRows().get(key);
        if (fresh?.length !== 1 || !verify(fresh[0][c])) throw new Error('填充后的控件值与 data 不符（可能未提交到页面组件或被页面恢复）');
        report.filledCells++; report.cells.push({ row: index + 1, column, status: 'filled' });
        finalChecks.push({ key, column, c, index, verify });
      } catch (error) { report.cells.push({ row: index + 1, column, status: 'failed', reason: (error as Error).message }); throw fail(new Error(`第 ${index + 1} 行「${column}」：${(error as Error).message}`)); }
    }
  }
  const finalRows = currentRows();
  for (const check of finalChecks) {
    const row = finalRows.get(check.key);
    if (row?.length !== 1 || !check.verify(row[0][check.c])) {
      report.cells.push({ row: check.index + 1, column: check.column, status: 'failed', reason: '最终复核发现该值被后续页面操作改变' });
      throw fail(new Error(`第 ${check.index + 1} 行「${check.column}」最终复核失败`));
    }
  }
  return report;
}
