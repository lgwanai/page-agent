/** Read only, scoped DOM access. Never expose password/hidden input fields. */
export function readOutputDom(selector: string, read: 'text' | 'value' | 'attribute', attributeName = '', multiple = false): unknown {
  if (!selector.trim()) throw new Error('Output 尚未配置 DOM Selector');
  if (!['text', 'value', 'attribute'].includes(read)) throw new Error('Output DOM 读取类型无效');
  if (read === 'attribute' && !attributeName.trim()) throw new Error('Output 需要填写 DOM 属性名称');
  const elements = [...document.querySelectorAll(selector)];
  if (!elements.length) throw new Error(`Output DOM 不存在：${selector}`);
  if (!multiple && elements.length !== 1) throw new Error(`Output DOM 需要唯一匹配，实际 ${elements.length} 个；可开启读取列表`);
  if (elements.length > 1000) throw new Error('Output DOM 列表超过 1000 项，请缩小范围');
  const result = elements.map(element => {
    if (element.matches('input[type="password"],input[type="hidden"],script,style') || element.closest('script,style')) throw new Error('Output 不允许读取密码、隐藏输入或脚本节点');
    if (read === 'attribute') {
      if (!element.hasAttribute(attributeName)) throw new Error(`Output DOM 缺少属性：${attributeName}`);
      return element.getAttribute(attributeName);
    }
    if (read === 'value') {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) throw new Error('Output DOM 值需要选择 input、textarea 或 select；普通节点请读取文本');
      return element.value;
    }
    // Exclude secret descendants when a container is selected.
    const copy = element.cloneNode(true) as Element;
    copy.querySelectorAll('input[type="password"],input[type="hidden"],script,style').forEach(child => child.remove());
    return (copy.textContent ?? '').trim();
  });
  return multiple ? result : result[0];
}
