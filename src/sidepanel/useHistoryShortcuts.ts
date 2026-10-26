import { useEffect } from 'react';

export function historyShortcutLabels(platform = navigator.platform) {
  const mac = /Mac|iPhone|iPad|iPod/i.test(platform);
  return { mac, undo: `${mac ? 'Command' : 'Ctrl'}+Z`, redo: `${mac ? 'Command' : 'Ctrl'}+Shift+Z` };
}
export function useHistoryShortcuts({ enabled, canUndo, canRedo, undo, redo }: { enabled: boolean; canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void }) {
  useEffect(() => {
    if (!enabled) return;
    const { mac } = historyShortcutLabels();
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.key.toLowerCase() !== 'z' || (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey)) return;
      const target = event.composedPath()[0];
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
      if (document.querySelector('[role="dialog"], .settings-overlay')) return;
      // Keep FlowGram's independent history from undoing display synchronization.
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.shiftKey ? canRedo : canUndo) (event.shiftKey ? redo : undo)();
    };
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, [enabled, canUndo, canRedo, undo, redo]);
}
