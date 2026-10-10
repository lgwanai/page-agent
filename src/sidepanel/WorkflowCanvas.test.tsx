// @vitest-environment jsdom
import 'reflect-metadata';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FreeLayoutProps } from '@flowgram.ai/free-layout-editor';
import { createStartNode } from '@/types/workflow';
import type { SelectableEntity } from './canvas-selection';
import { WorkflowCanvas } from './WorkflowCanvas';

const mocks = vi.hoisted(() => ({
  props: undefined as FreeLayoutProps | undefined,
  onSelectionChanged: vi.fn(),
  fromJSON: vi.fn(),
  onContentChange: vi.fn(),
  toJSON: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('@flowgram.ai/free-layout-editor', async () => {
  const { forwardRef } = await import('react');
  return {
    FreeLayoutEditorProvider: forwardRef<unknown, FreeLayoutProps & { children: ReactNode }>(({ children, ...props }, _ref) => {
      mocks.props = props;
      return <>{children}</>;
    }),
    EditorRenderer: ({ className }: { className: string }) => <div className={className} />,
    Field: () => null,
    WorkflowNodeRenderer: () => null,
    useNodeRender: vi.fn(),
    useClientContext: () => ({
      selection: { onSelectionChanged: mocks.onSelectionChanged },
      operation: { fromJSON: mocks.fromJSON },
      document: { onContentChange: mocks.onContentChange, toJSON: mocks.toJSON },
    }),
  };
});

let root: Root;
let container: HTMLDivElement;
const onChange = vi.fn();
const onSelect = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.props = undefined;
  mocks.onSelectionChanged.mockReturnValue({ dispose: mocks.dispose });
  mocks.onContentChange.mockReturnValue({ dispose: mocks.dispose });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(<WorkflowCanvas nodes={[createStartNode('start')]} edges={[]} onChange={onChange} onSelect={onSelect} onAddFromPort={vi.fn()} />));
}

describe('canvas mouse interaction configuration', () => {
  it('configures native mouse mode while retaining the existing scroll handling', async () => {
    await render();
    expect(mocks.props?.playground?.ineractiveType).toBe('MOUSE');
    expect(mocks.props?.scroll?.disableScroll).not.toBe(true);
    expect(container.textContent).toContain('拖动空白处平移 · 滚轮缩放');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('retains the node selection listener used by the property inspector', async () => {
    await render();
    const listener = mocks.onSelectionChanged.mock.calls[0][0] as (selection: SelectableEntity[]) => void;
    await act(async () => listener([{ id: 'start' }]));
    expect(onSelect).toHaveBeenCalledWith('start');
    await act(async () => listener([]));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(mocks.props?.twoWayConnection).toBe(false);
    expect(mocks.props?.materials?.renderDefaultNode).toBeTypeOf('function');
  });
});
