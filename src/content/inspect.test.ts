// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectPage } from './inspect';

beforeEach(() => { vi.stubGlobal('CSS', { escape: (value: string) => value }); document.body.innerHTML = ''; });
afterEach(() => { vi.unstubAllGlobals(); });
describe('read-only page inspection', () => {
  it('recognizes disabled Aurora cells and descendants', () => {
    document.body.innerHTML = '<table><tr><td class="aurora-picker-cell-disabled"><div id="date">1</div></td></tr></table>';
    expect(inspectPage('#date').nodes[0].disabled).toBe(true);
  });
  it('returns selectors and select options, not password or hidden inputs', () => {
    document.body.innerHTML = '<input id="name" value="abc"><input type="password" value="secret"><input type="hidden" value="token"><select id="city"><option value="sh">上海</option></select><script>PRIVATE_SCRIPT</script>';
    const snapshot = inspectPage('body');
    expect(snapshot.nodes.find((n) => n.selector === '#name')).toMatchObject({ value: 'abc', tagName: 'input' });
    expect(snapshot.nodes.find((n) => n.selector === '#city')).toMatchObject({ options: [{ value: 'sh', label: '上海' }] });
    expect(JSON.stringify(snapshot)).not.toContain('secret'); expect(JSON.stringify(snapshot)).not.toContain('token'); expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_SCRIPT');
  });
  it('caps node and text output and leaves DOM unchanged', () => {
    document.body.innerHTML = '<button>ABCDEF</button><button>GHIJKL</button><button>MNOP</button>';
    const before = document.body.innerHTML; const snapshot = inspectPage('button', 2, 4);
    expect(snapshot.nodes).toHaveLength(2); expect(snapshot.nodes.map((n) => n.text).join('').length).toBeLessThanOrEqual(4);
    expect(snapshot.truncated).toBe(true); expect(document.body.innerHTML).toBe(before);
  });
  it('reports invalid CSS selectors without executing anything', () => { expect(() => inspectPage('[')).toThrow(); });
});

it('exposes upload constraints without exposing fake file paths', () => {
  document.body.innerHTML = '<input id="file" type="file" hidden multiple accept=".pdf">';
  Object.defineProperty(document.querySelector('#file'), 'value', { value: 'C:\\fakepath\\private.pdf' });
  const result = inspectPage('#file');
  expect(result.nodes[0]).toMatchObject({ upload: { multiple: true, accept: '.pdf' } });
  expect(JSON.stringify(result)).not.toContain('private.pdf');
});
