import type { TableFillStructure } from '@/types/workflow';

const norm = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim();
const TABLE = 'table,[role="table"],[role="grid"]';
const IGNORE = 'script,style,template,svg,colgroup';
export function fillVisible(element: Element): boolean {
  for (let el: Element | null = element; el; el = el.parentElement) {
    const style = getComputedStyle(el);
    if (el.hasAttribute('hidden') || style.display === 'none' || style.visibility === 'hidden' || el.getAttribute('aria-hidden') === 'true') return false;
  }
  return true;
}
export function fillCellValue(cell: Element): string {
  const input = cell.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]),textarea,select');
  return norm(input ? input.value : cell.textContent);
}
function query(scope: Element, selector: string, purpose: string): Element[] {
  try { return [...scope.querySelectorAll(selector)].filter(fillVisible); }
  catch { throw new Error(`${purpose} Selector 无效：${selector}`); }
}
function children(element: Element): Element[] {
  return [...element.children].filter(el => !el.matches(IGNORE) && fillVisible(el));
}
function cells(row: Element, selector?: string): Element[] {
  if (selector?.trim()) return query(row, selector, '单元格');
  if (row instanceof HTMLTableRowElement) return [...row.cells].filter(fillVisible);
  const semantic = [...row.querySelectorAll('[role="columnheader"],[role="cell"],[role="gridcell"]')]
    .filter(cell => cell.closest('[role="row"]') === row && fillVisible(cell));
  if (semantic.length) return semantic;
  let result = children(row);
  // Some grids put one transparent wrapper between the row and its cells.
  for (let depth = 0; result.length === 1 && depth < 8; depth++) {
    const child = result[0];
    if (child.matches('input,select,textarea,[contenteditable],[role="combobox"]')) break;
    const next = children(child);
    if (!next.length) break;
    result = next;
  }
  return result;
}
function headerName(cell: Element): string {
  const copy = cell.cloneNode(true) as Element;
  copy.querySelectorAll('script,style,svg,[aria-hidden="true"]').forEach(el => el.remove());
  return norm(copy.textContent || cell.getAttribute('data-field') || cell.getAttribute('data-column-key') || cell.getAttribute('aria-label')).replace(/\s*[*＊]\s*$/, '');
}
function field(cell: Element): string {
  return norm(cell.getAttribute('data-field') || cell.getAttribute('data-column-key') || cell.getAttribute('data-prop') || cell.getAttribute('data-column'));
}
interface Header { rows: Element[][]; elements: Set<Element>; columns: string[]; identifiers: string[] }
function header(rows: Element[][]): Header {
  const grid: Array<Array<{ name: string; identifier: string }>> = [];
  rows.forEach((row, r) => {
    grid[r] ??= []; let c = 0;
    for (const cell of row) {
      while (grid[r][c] !== undefined) c++;
      const xspan = Math.max(1, Number(cell.getAttribute('colspan') || cell.getAttribute('aria-colspan')) || 1);
      const yspan = Math.max(1, Number(cell.getAttribute('rowspan') || cell.getAttribute('aria-rowspan')) || 1);
      if (c + xspan > 200 || r + yspan > 50) throw new Error('表头过大或合并表头无效');
      const value = { name: headerName(cell), identifier: field(cell) };
      for (let y = r; y < r + yspan; y++) {
        grid[y] ??= [];
        for (let x = c; x < c + xspan; x++) {
          if (grid[y][x] !== undefined) throw new Error('表头合并单元格重叠，不能安全填充');
          grid[y][x] = value;
        }
      }
      c += xspan;
    }
  });
  const width = Math.max(0, ...grid.map(row => row.length));
  const leaf = Array.from({ length: width }, (_, c) => [...grid].reverse().map(row => row[c]).find(item => item?.name));
  return { rows, elements: new Set(rows.flat()), columns: leaf.map(item => item?.name ?? ''), identifiers: leaf.map(item => item?.identifier || item?.name || '') };
}
function sameCells(a: Element[], b: Element[]): boolean { return a.length === b.length && a.every((el, i) => el === b[i]); }
function nestedInCell(el: Element, scope: Element): boolean {
  const parent = el.parentElement?.closest('td,[role="cell"],[role="gridcell"]');
  return Boolean(parent && scope.contains(parent));
}
function location(element: Element, scope: Element): string {
  const parts: string[] = [];
  for (let el: Element | null = element; el && el !== scope; el = el.parentElement) {
    parts.unshift(`${el.tagName}:${el.parentElement ? [...el.parentElement.children].indexOf(el) : 0}`);
  }
  return parts.join('/');
}

/** Discover one logical grid, not one HTML table. All searches stay in the chosen scope. */
export function readFillGrid(selector: string, keyColumns: string[], fields: string[], data: Record<string, unknown>[], structure: TableFillStructure = {}) {
  let roots: Element[];
  try { roots = [...document.querySelectorAll(selector)]; } catch { throw new Error(`表格容器 Selector 无效：${selector}`); }
  if (roots.length !== 1) throw new Error(`表格填充需要唯一 Selector，当前匹配 ${roots.length} 个`);
  const picked = roots[0];
  const explicit = Object.values(structure).some(value => Boolean(value?.trim()));
  const scope = !explicit && !picked.matches(TABLE) ? picked.closest(TABLE) ?? picked : picked;
  if (!fillVisible(scope)) throw new Error('表格容器当前不可见');
  const nodes = [scope, ...scope.querySelectorAll('table,tr,div,ul,ol,li,section,header,[role="row"]')];
  if (nodes.length > 60000) throw new Error('表格结构超过 60000 个候选节点，请缩小容器或按页处理');
  const candidates: Header[] = [];
  if (structure.headerSelector?.trim()) {
    const selected = query(scope, structure.headerSelector, '表头单元格');
    if (!selected.length) throw new Error('表头单元格 Selector 没有匹配可见节点');
    if (selected.some(cell => selected.some(other => other !== cell && cell.contains(other)))) throw new Error('表头 Selector 同时包含父子节点，请只选择各列的表头单元格');
    candidates.push(header([selected]));
  } else {
    const tables = nodes.filter((el): el is HTMLTableElement => el instanceof HTMLTableElement && !nestedInCell(el, scope) && fillVisible(el));
    for (const table of tables) {
      const rows = [...table.rows].filter(row => row.closest('table') === table && fillVisible(row));
      let heads = rows.filter(row => row.parentElement?.tagName === 'THEAD');
      if (!heads.length && rows[0] && cells(rows[0]).length && cells(rows[0]).every(cell => cell.tagName === 'TH')) heads = [rows[0]];
      if (heads.length) candidates.push(header(heads.map(row => cells(row))));
    }
    const roles = query(scope, '[role="columnheader"]', '表头');
    const roleGroups = new Map<Element, Map<Element, Element[]>>();
    for (const cell of roles) {
      const row = cell.closest('[role="row"]') ?? cell.parentElement!;
      const owner = row.closest('[role="rowgroup"]') ?? row.closest(TABLE) ?? row.parentElement!;
      const rows = roleGroups.get(owner) ?? new Map<Element, Element[]>();
      rows.set(row, [...(rows.get(row) ?? []), cell]); roleGroups.set(owner, rows);
    }
    for (const rows of roleGroups.values()) {
      const list = [...rows.values()];
      if (!candidates.some(h => sameCells(h.rows.flat(), list.flat()))) candidates.push(header(list));
    }
    // Generic UL/DIV headers are recognized by the configured field names, not
    // English-only class names or the assumption that any first row is a header.
    if (!candidates.some(h => keyColumns.every(key => h.columns.includes(key)))) {
      for (const node of nodes) {
        if (nestedInCell(node, scope) || node.matches('table,tr') || node.closest('thead')) continue;
        const row = cells(node);
        if (row.length < 2 || row.length > 200 || row.some(cell => cell.querySelector('input,select,textarea,[contenteditable="true"]'))) continue;
        const names = row.map(headerName);
        if (!keyColumns.every(key => names.includes(key)) || !names.some(name => fields.includes(name))) continue;
        if (!candidates.some(h => sameCells(h.rows.flat(), row))) candidates.push(header([row]));
      }
    }
  }
  const matching = candidates.filter(h => keyColumns.every(key => h.columns.includes(key)));
  const possible = matching.length ? matching : candidates;
  if (possible.length !== 1) throw new Error(possible.length ? '发现多个可能的表头，未填充；请缩小完整容器或在高级结构中指定表头单元格' : '无法识别表头；请选择同时包含表头和数据行的外层容器，或在高级结构中指定表头单元格');
  const head = possible[0], width = head.columns.length;
  if (!width || head.columns.some(name => !name) || new Set(head.columns).size !== width) throw new Error('表头为空或重名，无法安全按字段自动填充');
  if (keyColumns.some(key => !head.columns.includes(key))) throw new Error('key 列在网页表头中不存在');
  const headerParents = new Set<Element | null>([...head.elements].map(cell => cell.parentElement));
  const isHeader = (el: Element) => [...head.elements].some(cell => el === cell || el.contains(cell) || cell.contains(el));
  const keyIndexes = keyColumns.map(key => head.columns.indexOf(key));
  const ordered = (row: Element) => {
    const result = cells(row, structure.cellSelector);
    if (result.some(cell => result.some(other => cell !== other && cell.contains(other)))) throw new Error('单元格 Selector 同时包含父子节点，无法安全按列填写');
    const ids = result.map(field);
    if (ids.some(Boolean)) {
      const wanted = head.identifiers;
      if (ids.every(Boolean) && new Set(ids).size === ids.length && wanted.every(id => ids.includes(id)) && ids.length === wanted.length) return wanted.map(id => result[ids.indexOf(id)]);
      if (ids.some((id, i) => id && id !== wanted[i] && id !== head.columns[i])) throw new Error('数据列标识与表头顺序不一致，请配置单元格 Selector，未按位置猜测');
    }
    return result;
  };
  let rowElements: Element[];
  let layout = 'custom';
  if (structure.rowSelector?.trim()) {
    rowElements = query(scope, structure.rowSelector, '数据行').filter(el => !isHeader(el));
    if (!rowElements.length) throw new Error('数据行 Selector 没有匹配可见数据行');
    if (rowElements.some(row => rowElements.some(other => row !== other && row.contains(other)))) throw new Error('数据行 Selector 同时包含父子行，请只选择实际数据行');
  } else {
    const groups = new Map<Element, Element[]>();
    const seen = new Set<Element>();
    for (const node of nodes) {
      if (node.matches(TABLE) || node.closest('thead,tfoot') || nestedInCell(node, scope) || isHeader(node) || !fillVisible(node)) continue;
      const rowCells = cells(node, structure.cellSelector);
      if (rowCells.length !== width || !rowCells.length) continue;
      const canonical = rowCells[0].parentElement!;
      if (!sameCells(cells(canonical, structure.cellSelector), rowCells) || seen.has(canonical)) continue;
      // A body wrapper isn't a row: its supposed key cell must not itself
      // contain a complete header/data row. This also excludes nested grids.
      if (keyIndexes.some(index => rowCells[index].matches('li,tr,[role="row"]') || rowCells[index].querySelector('tr,[role="row"]') || cells(rowCells[index]).length === width || [...rowCells[index].children].some(el => cells(el).length === width))) continue;
      seen.add(canonical);
      const parent = canonical.parentElement!;
      groups.set(parent, [...(groups.get(parent) ?? []), canonical]);
    }
    // Multiple TBODY/ARIA row groups still belong to the same explicit table.
    // Only merge that declared owner, never unrelated DIV groups in a wrapper.
    const owner = [...head.elements][0].closest(TABLE);
    if (owner) {
      const related = [...groups].filter(([, rows]) => rows.every(row => row.closest(TABLE) === owner));
      if (related.length > 1) {
        const combined = related.flatMap(([, rows]) => rows);
        related.forEach(([parent]) => groups.delete(parent));
        groups.set(owner, combined);
      }
    }
    const sourceKeys = new Set(data.map(row => JSON.stringify(keyColumns.map(key => norm(row[key])))));
    const choices = [...groups].map(([parent, rows]) => ({ parent, rows, matches: rows.filter(row => { const list = ordered(row); return sourceKeys.has(JSON.stringify(keyIndexes.map(i => fillCellValue(list[i])))); }).length }));
    const hit = choices.filter(choice => choice.matches > 0);
    const nearHeader = choices.filter(choice => choice.rows.some(row => headerParents.has(row)) || [...head.elements].some(cell => cell.parentElement?.parentElement === choice.parent));
    const eligible = hit.length ? hit : nearHeader.length ? nearHeader : choices;
    if (eligible.length !== 1) throw new Error(eligible.length ? '发现多个可能的数据行区域，未填充；请缩小容器或在高级结构中指定数据行' : '未识别到数据行；请选择同时包含表头和行的外层容器，或配置高级数据行 Selector');
    const chosen = eligible[0];
    rowElements = chosen.rows;
    // Do not silently drop a malformed sibling row and report a successful fill.
    for (const parent of new Set(rowElements.map(row => row.parentElement!))) {
      for (const sibling of children(parent)) {
        if (!isHeader(sibling) && sibling.tagName === rowElements[0].tagName && !rowElements.includes(sibling) && cells(sibling, structure.cellSelector).length) throw new Error('数据行包含列数不一致或无法识别的行，请配置高级数据行/单元格 Selector');
      }
    }
    layout = rowElements[0] instanceof HTMLTableRowElement ? 'table' : rowElements[0].matches('li') || chosen.parent.matches('ul,ol') ? 'list' : 'div';
    if (head.rows.some(row => row.some(cell => cell.closest('table'))) && layout !== 'table') layout = 'mixed';
  }
  const body = rowElements.map(ordered);
  if (body.length > 5000 || width > 200) throw new Error('表格超过 5000 行或 200 列，请按页处理');
  if (body.some(row => row.length !== width || row.some(cell => Number(cell.getAttribute('colspan') || cell.getAttribute('aria-colspan') || 1) !== 1 || Number(cell.getAttribute('rowspan') || cell.getAttribute('aria-rowspan') || 1) !== 1))) throw new Error('数据行包含合并单元格或列数不一致，不能安全自动填充');
  const identity = structure.rowSelector?.trim() ? `explicit:${structure.rowSelector}` : location(rowElements[0].parentElement!, scope);
  return { columns: head.columns, rows: body, layout, identity };
}
