// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { fillTable } from './table-fill';
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });
function table(cells = '<td><input value="old"></td>', headers = '<th>名称</th>') {
  document.body.innerHTML = `<table id="t"><thead><tr><th>SKU</th><th>仓库</th>${headers}</tr></thead><tbody><tr><td>001</td><td>上海</td>${cells}</tr><tr><td>001</td><td>北京</td>${cells}</tr></tbody></table>`;
}
it('uses multiple keys, fills by header rather than input data order, and preserves key columns', async () => {
  table();
  const report = await fillTable('#t', [{ 名称: '北京商品', 仓库: '北京', SKU: '001' }, { SKU: '001', 仓库: '上海', 名称: '上海商品' }], ['SKU', '仓库'], false);
  expect([...document.querySelectorAll('input')].map(el => el.value)).toEqual(['上海商品', '北京商品']);
  expect(report).toMatchObject({ matchedRows: 2, filledCells: 2 });
});
it('maps native select labels, multiple select, radio labels, checkbox arrays, and booleans', async () => {
  table('<td><select><option value="a">甲</option><option value="b">乙</option></select></td><td><select multiple><option value="r">红</option><option value="b">蓝</option></select></td><td><label><input type="radio" name="g" value="x">男</label><label><input type="radio" name="g" value="y">女</label></td><td><label><input type="checkbox" value="r">红</label><label><input type="checkbox" value="b">蓝</label></td><td><input type="checkbox" checked></td>', '<th>分类</th><th>颜色</th><th>性别</th><th>爱好</th><th>启用</th>');
  document.querySelector('tbody tr:last-child')!.remove();
  const result = await fillTable('#t', [{ SKU: '001', 仓库: '上海', 分类: '乙', 颜色: ['红', '蓝'], 性别: '女', 爱好: ['蓝'], 启用: 'FALSE' }], ['SKU', '仓库'], false);
  expect(result.filledCells).toBe(5);
  expect([...document.querySelectorAll('select')].map(el => [...el.selectedOptions].map(o => o.value))).toEqual([['b'], ['r', 'b']]);
  expect(document.querySelector<HTMLInputElement>('input[type=radio]:checked')!.value).toBe('y');
  expect([...document.querySelectorAll<HTMLInputElement>('tbody td:nth-child(6) input')].map(el => el.checked)).toEqual([false, true]);
  expect(document.querySelector<HTMLInputElement>('tbody td:last-child input')!.checked).toBe(false);
});
it('skips read-only, disabled and plain text cells without changing them', async () => {
  table('<td><input readonly value="keep"></td><td><select disabled><option>old</option></select></td><td>fixed</td>', '<th>名称</th><th>类型</th><th>备注</th>');
  const result = await fillTable('#t', [{ SKU: '001', 仓库: '上海', 名称: 'new', 类型: 'new', 备注: 'new' }], ['SKU', '仓库'], false);
  expect(result).toMatchObject({ filledCells: 0, skippedCells: 3 });
  expect(document.querySelector('input')!.value).toBe('keep');
});
it('rejects duplicate source keys before writing any row', async () => {
  table();
  await expect(fillTable('#t', [{ SKU: '001', 仓库: '上海', 名称: 'new' }, { SKU: '001', 仓库: '上海', 名称: 'other' }], ['SKU', '仓库'], false)).rejects.toThrow('key 重复');
  expect(document.querySelector('input')!.value).toBe('old');
});
it('rejects ambiguous table row keys before writes and allows explicitly skipping missing rows', async () => {
  table();
  await expect(fillTable('#t', [{ SKU: '001', 名称: 'new' }], ['SKU'], false)).rejects.toThrow('匹配多个网页行');
  const report = await fillTable('#t', [{ SKU: '002', 仓库: '北京', 名称: 'new' }], ['SKU', '仓库'], true);
  expect(report).toMatchObject({ unmatchedRows: 1, filledCells: 0 });
});
it('reports missing/ambiguous options instead of guessing and includes partial results', async () => {
  table('<td><select><option value="a">相同</option><option value="b">相同</option></select></td>', '<th>分类</th>');
  await expect(fillTable('#t', [{ SKU: '001', 仓库: '上海', 分类: '相同' }], ['SKU', '仓库'], false)).rejects.toMatchObject({ report: { filledCells: 0, cells: [expect.objectContaining({ status: 'failed' })] } });
});
it('checks the final component value rather than treating event dispatch as success', async () => {
  table(); const input = document.querySelector('input')!;
  input.addEventListener('input', () => { input.value = 'old'; });
  await expect(fillTable('#t', [{ SKU: '001', 仓库: '上海', 名称: 'new' }], ['SKU', '仓库'], false)).rejects.toThrow('控件值与 data 不符');
});
it('detects earlier values invalidated by later cell updates during final verification', async () => {
  table('<td><input value="old"></td><td><input value="old"></td>', '<th>名称</th><th>备注</th>');
  const inputs = [...document.querySelectorAll<HTMLInputElement>('tbody tr:first-child input')];
  inputs[1].addEventListener('change', () => { inputs[0].value = 'reverted'; });
  await expect(fillTable('#t', [{ SKU: '001', 仓库: '上海', 名称: 'new', 备注: 'next' }], ['SKU', '仓库'], false)).rejects.toThrow('最终复核失败');
});
it('accepts a DataTable output or JSON data and handles DOM rerenders between cells', async () => {
  table('<td><input value="old"></td><td><input value="old"></td>', '<th>名称</th><th>数量</th>');
  const input = document.querySelector('input')!;
  input.addEventListener('change', () => { const next = document.querySelectorAll('tbody tr:first-child input')[1]; next.replaceWith(next.cloneNode(true)); });
  const result = await fillTable('#t', JSON.stringify({ rows: [{ SKU: '001', 仓库: '上海', 名称: '新名', 数量: 0 }] }), ['SKU', '仓库'], false);
  expect(result.filledCells).toBe(2);
  expect([...document.querySelectorAll<HTMLInputElement>('tbody tr:first-child input')].map(el => el.value)).toEqual(['新名', '0']);
});
it('supports ARIA grids and custom radio controls', async () => {
  document.body.innerHTML = '<div role="grid" id="t"><div role="row"><div role="columnheader">编号</div><div role="columnheader">性别</div></div><div role="row"><div role="gridcell">A</div><div role="gridcell"><span role="radio" data-value="m" aria-checked="true">男</span><span role="radio" data-value="f" aria-checked="false">女</span></div></div></div>';
  document.querySelectorAll<HTMLElement>('[role=radio]').forEach(el => el.addEventListener('click', () => document.querySelectorAll('[role=radio]').forEach(item => item.setAttribute('aria-checked', String(item === el)))));
  expect((await fillTable('#t', [{ 编号: 'A', 性别: '女' }], ['编号'], false)).filledCells).toBe(1);
});
it('opens a readonly-input combobox and selects its uniquely matching portaled option', async () => {
  table('<td><input role="combobox" readonly aria-controls="list" value="甲"></td>', '<th>分类</th>');
  const combo = document.querySelector<HTMLInputElement>('[role=combobox]')!;
  combo.addEventListener('click', () => { const list = document.createElement('div'); list.id = 'list'; list.innerHTML = '<div role="option" data-value="b">乙</div>'; list.firstElementChild!.addEventListener('click', () => { combo.value = '乙'; list.remove(); }); document.body.append(list); });
  expect((await fillTable('#t', [{ SKU: '001', 仓库: '上海', 分类: '乙' }], ['SKU', '仓库'], false)).filledCells).toBe(1);
});
