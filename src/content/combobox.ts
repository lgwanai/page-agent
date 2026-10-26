import type { EventDefinition } from '@/types/workflow';
import type { EventExecutionResult } from './executor';

const normalize = (value: string | null) => (value ?? '').replace(/\s+/g, ' ').trim();
function visible(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  const style = getComputedStyle(element);
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'
    && style.opacity !== '0' && !element.closest('[hidden], [aria-hidden="true"]');
}
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** DOM-only custom combobox selection. Never writes component internals or guesses an option. */
export async function selectCombobox(element: HTMLElement, event: EventDefinition, click: (element: HTMLElement) => void): Promise<EventExecutionResult> {
  const expected = normalize(event.value ?? '');
  if (!expected) throw new Error('自定义下拉框需要填写选项名称；可选参数请开启空值跳过');
  if (element.getAttribute('role') !== 'combobox' && !element.matches('.next-select, .ant-select, [aria-haspopup="listbox"]')) throw new Error('该节点不是原生 select 或受支持的 combobox，请选择下拉输入控件');
  const minimum = event.minWaitMs ?? 1000, maximum = event.maxWaitMs ?? 2000;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 0 || maximum < minimum || maximum > 10000) throw new Error('下拉加载等待区间必须在 0～10000 毫秒内，最大值不得小于最小值');
  const control = element.closest('.next-select, .ant-select') ?? element;
  const listboxes = () => [...document.querySelectorAll('[role="listbox"]')].filter(visible);
  const ownedIds = (element.getAttribute('aria-controls') ?? element.getAttribute('aria-owns') ?? '').split(/\s+/).filter(Boolean);
  const before = new Set(listboxes());
  if (element.getAttribute('aria-expanded') !== 'true' && !(before.size === 1 && control.contains(document.activeElement))) click(element);
  const delay = Math.floor(minimum + Math.random() * (maximum - minimum + 1));
  await wait(delay);
  const deadline = Date.now() + 10000;
  let selected: HTMLElement | undefined;
  while (Date.now() < deadline) {
    const boxes = listboxes();
    const owned = boxes.filter(box => ownedIds.some(id => box.id === id || box.contains(document.getElementById(id))));
    const opened = boxes.filter(box => !before.has(box));
    const scopes = owned.length ? owned : opened.length ? opened : boxes;
    if (scopes.length > 1) throw new Error('同时出现多个下拉列表，无法安全确定目标，请关闭其他弹层或选择带 aria-controls 的输入框');
    const options = scopes.flatMap(box => [...box.querySelectorAll('[role="option"]')]).filter(visible)
      .filter(option => option.getAttribute('aria-disabled') !== 'true' && !option.matches('.next-disabled, .ant-select-item-option-disabled'))
      .filter(option => normalize(option.getAttribute('title') || option.textContent) === expected);
    if (options.length > 1) throw new Error(`下拉框存在多个同名选项「${expected}」，不能安全选择`);
    if (options.length === 1) { selected = options[0]; break; }
    await wait(100);
  }
  if (!selected) throw new Error(`下拉框未出现完全匹配的可用选项「${expected}」（已等待异步加载）`);
  selected.scrollIntoView({ block: 'nearest' });
  click(selected);
  const verifyDeadline = Date.now() + 3000;
  let actual = '';
  while (Date.now() < verifyDeadline) {
    const current = element.id ? document.getElementById(element.id) ?? element : element;
    const wrapper = current.closest('.next-select, .ant-select') ?? control;
    // Next/Ant show the committed label separately from their empty search input.
    const labels = [...wrapper.querySelectorAll('.next-select-values > em, .next-select-values-item, .ant-select-selection-item')]
      .filter(label => !label.closest('[aria-hidden="true"]')).map(label => normalize(label.textContent));
    const declaredValue = normalize(current.getAttribute('aria-valuetext'));
    actual = current instanceof HTMLInputElement ? normalize(current.value) : '';
    if (labels.includes(expected) || declaredValue === expected || actual === expected && current.getAttribute('aria-expanded') === 'false') return { output: expected, verification: {
      ok: true, summary: `异步下拉选项已验证：${expected}`, expected, actual: expected,
      evidence: [`打开下拉后等待 ${delay} 毫秒`, '选项名称完全匹配；已核验控件当前选中标签'],
    } };
    await wait(80);
  }
  throw new Error(`下拉点击后无法验证选中值：期望「${expected}」，实际输入「${actual}」；不以点击事件代替选中成功`);
}
