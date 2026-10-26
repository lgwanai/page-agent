// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { NodeChoices, NODE_CHOICES } from './CanvasToolbar';
import { NODE_KIND_LABELS, NODE_KIND_ENGLISH } from '@/types/workflow';
it('shows every node choice with a Chinese primary title and English subtitle, including requests', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host), choose = vi.fn();
  try {
    await act(async () => root.render(<NodeChoices onChoose={choose} />));
    for (const [kind] of NODE_CHOICES) {
      const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${NODE_KIND_LABELS[kind]}"]`)!;
      expect(button.querySelector('strong')?.textContent).toBe(NODE_KIND_LABELS[kind]);
      expect(button.querySelector('small')?.textContent).toBe(NODE_KIND_ENGLISH[kind]);
    }
    expect(Object.values(NODE_KIND_LABELS).every(label => !/[a-z]/i.test(label))).toBe(true);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="请求"]')!.click()); expect(choose).toHaveBeenCalledWith('request');
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
