// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { historyShortcutLabels, useHistoryShortcuts } from './useHistoryShortcuts';
let root: Root, container: HTMLDivElement;
const undo = vi.fn(), redo = vi.fn();
function Harness({ enabled = true, canUndo = true, canRedo = true }) { useHistoryShortcuts({ enabled, canUndo, canRedo, undo, redo }); return <><input /><textarea /><select /><div contentEditable suppressContentEditableWarning><span>编辑文本</span></div></>; }
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const key = (target: EventTarget, options: KeyboardEventInit) => { const event = new KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true, ...options }); target.dispatchEvent(event); return event; };
it.each(['Win32', 'MacIntel'])('uses platform-specific undo/redo and matching labels on %s', async platform => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  await act(async () => root.render(<Harness />));
  const modifier = platform === 'MacIntel' ? { metaKey: true } : { ctrlKey: true };
  expect(key(window, modifier).defaultPrevented).toBe(true); expect(undo).toHaveBeenCalledOnce();
  key(window, { ...modifier, shiftKey: true, key: 'Z' }); expect(redo).toHaveBeenCalledOnce();
  key(window, { ...modifier, altKey: true }); key(window, { ...modifier, isComposing: true });
  key(window, platform === 'MacIntel' ? { ctrlKey: true } : { metaKey: true });
  expect(undo).toHaveBeenCalledOnce(); expect(redo).toHaveBeenCalledOnce();
  expect(historyShortcutLabels()).toMatchObject({ undo: `${platform === 'MacIntel' ? 'Command' : 'Ctrl'}+Z`, redo: `${platform === 'MacIntel' ? 'Command' : 'Ctrl'}+Shift+Z` });
});
it('leaves native text editing and modal shortcuts alone', async () => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
  await act(async () => root.render(<Harness />));
  for (const element of container.querySelectorAll('input,textarea,select,[contenteditable] span')) expect(key(element, { ctrlKey: true }).defaultPrevented).toBe(false);
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog'); container.append(dialog);
  expect(key(window, { ctrlKey: true }).defaultPrevented).toBe(false); expect(undo).not.toHaveBeenCalled();
});
it('blocks the engine history at an empty undo stack and removes handlers when editing is disabled', async () => {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
  await act(async () => root.render(<Harness canUndo={false} canRedo={false} />));
  expect(key(window, { ctrlKey: true }).defaultPrevented).toBe(true); expect(undo).not.toHaveBeenCalled();
  await act(async () => root.render(<Harness enabled={false} />));
  expect(key(window, { ctrlKey: true }).defaultPrevented).toBe(false); expect(undo).not.toHaveBeenCalled();
});
