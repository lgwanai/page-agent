// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { readFillGrid } from './table-fill-grid';
import { fillTable } from './table-fill';
afterEach(() => { document.body.innerHTML = ''; });
const data = [{ SKU: '001', 仓库: '上海', 数量: 12 }];
const names = ['SKU', '仓库', '数量'];
const head = '<span>SKU</span><span>仓库</span><span>数量</span>';
const row = '<span>001</span><span>上海</span><span><input value="0"></span>';
const tableHead = '<table><thead><tr><th>SKU</th><th>仓库</th><th>数量</th></tr></thead></table>';
const read = () => readFillGrid('#t', ['SKU', '仓库'], names, data);

it('recognizes plain DIV headers and rows with no roles or library-specific classes', async () => {
  document.body.innerHTML = `<div id="t"><div>${head}</div><div><div>${row}</div></div></div>`;
  expect(read()).toMatchObject({ layout: 'div', columns: names, rows: [expect.any(Array)] });
  expect((await fillTable('#t', data, ['SKU', '仓库'], false)).filledCells).toBe(1);
  expect(document.querySelector('input')!.value).toBe('12');
});
it('recognizes UL/LI headers, composite keys and select options', async () => {
  document.body.innerHTML = '<ul id="t"><li><span>SKU</span><span>仓库</span><span>类型</span></li><li><span>001</span><span>上海</span><span><select><option>a</option><option>b</option></select></span></li><li><span>001</span><span>北京</span><span><select><option>a</option><option>b</option></select></span></li></ul>';
  const result = await fillTable('#t', [{ SKU: '001', 仓库: '北京', 类型: 'b' }], ['SKU', '仓库'], false);
  expect(result.structure.layout).toBe('list');
  expect([...document.querySelectorAll('select')].map(el => el.value)).toEqual(['a', 'b']);
});
it('pairs native TABLE headers with DIV rows in a shared outer container', async () => {
  document.body.innerHTML = `<div id="t"><div>${tableHead}</div><div class="body"><div class="row">${row}</div></div></div>`;
  expect(read().layout).toBe('mixed');
  expect((await fillTable('#t', data, ['SKU', '仓库'], false)).filledCells).toBe(1);
});
it('supports a header table and separate native body table without combining independent grids', () => {
  document.body.innerHTML = `<div id="t">${tableHead}<div><table><tbody><tr><td>001</td><td>上海</td><td><input value="0"></td></tr></tbody></table></div></div>`;
  expect(read().rows).toHaveLength(1);
});
it('preserves merged native headers, including headers that also declare ARIA roles', () => {
  document.body.innerHTML = '<table id="t"><thead><tr><th rowspan="2" role="columnheader">SKU</th><th colspan="2" role="columnheader">信息</th></tr><tr><th role="columnheader">仓库</th><th role="columnheader">数量</th></tr></thead><tbody><tr><td>001</td><td>上海</td><td><input></td></tr></tbody></table>';
  expect(read().columns).toEqual(names);
});
it('keeps multiple native TBODY sections inside the same table as one logical body', async () => {
  document.body.innerHTML = '<table id="t"><thead><tr><th>SKU</th><th>仓库</th><th>数量</th></tr></thead><tbody><tr><td>001</td><td>上海</td><td><input value="0"></td></tr></tbody><tbody><tr><td>001</td><td>北京</td><td><input value="0"></td></tr></tbody></table>';
  expect((await fillTable('#t', [...data, { SKU: '001', 仓库: '北京', 数量: 8 }], ['SKU', '仓库'], false)).filledCells).toBe(2);
  expect([...document.querySelectorAll('input')].map(el => el.value)).toEqual(['12', '8']);
});
it('preserves merged ARIA header row groups', () => {
  document.body.innerHTML = '<div id="t" role="grid"><div role="rowgroup"><div role="row"><div role="columnheader" aria-rowspan="2">SKU</div><div role="columnheader" aria-colspan="2">信息</div></div><div role="row"><div role="columnheader">仓库</div><div role="columnheader">数量</div></div></div><div role="rowgroup"><div role="row"><div role="cell">001</div><div role="cell">上海</div><div role="cell"><input></div></div></div></div>';
  expect(read().columns).toEqual(names);
});
it('unwraps one-child row wrappers and ignores hidden cloned headers and rows', () => {
  document.body.innerHTML = `<div id="t"><div hidden>${tableHead}<div>${row}</div></div><div><div>${head}</div></div><div><div><section>${row}</section></div></div></div>`;
  expect(read()).toMatchObject({ columns: names, rows: [expect.any(Array)] });
});
it('maps data-field identifiers when body cells are in a different order', async () => {
  document.body.innerHTML = '<div id="t"><div><span data-field="sku">SKU</span><span data-field="warehouse">仓库</span><span data-field="qty">数量</span></div><div><div><span data-field="qty"><input value="0"></span><span data-field="sku">001</span><span data-field="warehouse">上海</span></div></div></div>';
  expect((await fillTable('#t', data, ['SKU', '仓库'], false)).filledCells).toBe(1);
  expect(document.querySelector('input')!.value).toBe('12');
});
it('uses explicit relative header, row and cell selectors for nonstandard markup', async () => {
  document.body.innerHTML = '<section id="t"><header><b>SKU</b><b>仓库</b><b>数量</b></header><main><article><em>not a cell</em><section><div class="c">001</div><div class="c">上海</div><div class="c"><input value="0"></div></section></article></main></section>';
  const structure = { headerSelector: 'header > b', rowSelector: 'main > article', cellSelector: ':scope > section > .c' };
  expect((await fillTable('#t', data, ['SKU', '仓库'], false, structure)).filledCells).toBe(1);
});
it('fails before writes when two visible headers could refer to separate grids', async () => {
  document.body.innerHTML = `<div id="t"><div>${tableHead}<div>${row}</div></div><div>${tableHead}<div>${row}</div></div></div>`;
  await expect(fillTable('#t', data, ['SKU', '仓库'], false)).rejects.toThrow('多个可能的表头');
  expect([...document.querySelectorAll('input')].every(el => el.value === '0')).toBe(true);
});
it('rejects ambiguous body groups and permits explicitly selecting the intended group', async () => {
  document.body.innerHTML = `<div id="t"><div>${head}</div><div class="a"><div>${row}</div></div><div class="b"><div>${row}</div></div></div>`;
  await expect(fillTable('#t', data, ['SKU', '仓库'], false)).rejects.toThrow('多个可能的数据行');
  expect((await fillTable('#t', data, ['SKU', '仓库'], false, { rowSelector: '.b > div' })).filledCells).toBe(1);
  expect([...document.querySelectorAll('input')].map(el => el.value)).toEqual(['0', '12']);
});
it('refuses malformed sibling rows rather than silently ignoring column mismatch', async () => {
  document.body.innerHTML = `<div id="t"><div>${head}</div><div><div>${row}</div><div><span>002</span><span><input value="0"></span></div></div></div>`;
  await expect(fillTable('#t', data, ['SKU', '仓库'], false)).rejects.toThrow('列数不一致');
  expect(document.querySelector('input')!.value).toBe('0');
});
it('does not search outside a selected header-only table for the body', () => {
  document.body.innerHTML = `<div>${tableHead.replace('<table>', '<table id="t">')}<div>${row}</div></div>`;
  expect(read).toThrow('同时包含表头和行');
});
it('skips unmatched data in a uniquely identified DIV body for pagination', async () => {
  document.body.innerHTML = `<div id="t"><div>${head}</div><div><div>${row}</div></div></div>`;
  expect(await fillTable('#t', [{ SKU: '999', 仓库: '北京', 数量: 10 }], ['SKU', '仓库'], true)).toMatchObject({ filledCells: 0, unmatchedRows: 1 });
});
it('rejects invalid or overlapping custom selectors before touching controls', async () => {
  document.body.innerHTML = `<div id="t"><div>${head}</div><div class="body"><div class="row">${row}</div></div></div>`;
  await expect(fillTable('#t', data, ['SKU', '仓库'], false, { rowSelector: '[' })).rejects.toThrow('数据行 Selector 无效');
  await expect(fillTable('#t', data, ['SKU', '仓库'], false, { rowSelector: '.body,.row' })).rejects.toThrow('父子行');
  expect(document.querySelector('input')!.value).toBe('0');
});
it('keeps row matching stable through DIV rerenders between editable columns', async () => {
  document.body.innerHTML = '<div id="t"><div><span>SKU</span><span>名称</span><span>数量</span></div><div class="body"><div class="row"><span>001</span><span><input value="old"></span><span><input value="0"></span></div></div></div>';
  document.querySelector('input')!.addEventListener('change', () => {
    const row = document.querySelector('.row')!;
    row.querySelector('input')!.setAttribute('value', row.querySelector('input')!.value);
    row.replaceWith(row.cloneNode(true));
  });
  expect((await fillTable('#t', [{ SKU: '001', 名称: '新名称', 数量: 12 }], ['SKU'], false)).filledCells).toBe(2);
  expect([...document.querySelectorAll('input')].map(el => el.value)).toEqual(['新名称', '12']);
});
it('stops rather than switching to a different DIV group after a page changes row identities', async () => {
  document.body.innerHTML = `<div id="t"><div>${head}</div><div class="a"><div>${row}</div></div><div class="b"><div>${row.replace('001', '002')}</div></div></div>`;
  const a = document.querySelector('.a input')!;
  a.addEventListener('change', () => {
    document.querySelector('.a span')!.textContent = 'removed';
    document.querySelector('.b span')!.textContent = '001';
  });
  await expect(fillTable('#t', data, ['SKU', '仓库'], false)).rejects.toThrow('数据行区域改变');
  expect(document.querySelector<HTMLInputElement>('.b input')!.value).toBe('0');
});
