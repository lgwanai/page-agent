// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { fillTable } from './table-fill';

const guide = new DOMParser().parseFromString(readFileSync(resolve('docs/customer-portable-guide.html'), 'utf8'), 'text/html');
const data = JSON.parse(guide.querySelector('[data-example="layout-data"]')!.textContent!).data;
afterEach(() => { document.body.innerHTML = ''; });

for (const layout of ['ul', 'div', 'mixed']) {
  for (const advanced of [false, true]) {
    it(`executes the shipped ${layout} documentation example using ${advanced ? 'advanced selectors' : 'automatic detection'}`, async () => {
      document.body.innerHTML = guide.querySelector(`[data-example="fill-${layout}"]`)!.textContent!;
      const selectors = [...guide.querySelectorAll(`[data-layout="${layout}"] code`)].map(el => el.textContent!);
      expect(selectors).toHaveLength(4);
      const structure = advanced ? { headerSelector: selectors[1], rowSelector: selectors[2], cellSelector: selectors[3] } : undefined;
      const report = await fillTable(selectors[0], data, ['SKU', '仓库'], false, structure);
      expect(report).toMatchObject({ filledCells: 1, matchedRows: 1 });
      expect(document.querySelector('input')!.value).toBe('12');
    });
  }
}
it('keeps the MCP structure example identical to the mixed-layout UI selector example', () => {
  const example = JSON.parse(guide.querySelector('[data-example="table-fill-structure"]')!.textContent!);
  const selectors = [...guide.querySelectorAll('[data-layout="mixed"] code')].map(el => el.textContent!);
  expect(example.structure).toEqual({ headerSelector: selectors[1], rowSelector: selectors[2], cellSelector: selectors[3] });
});
