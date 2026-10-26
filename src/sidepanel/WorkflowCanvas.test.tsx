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
  getViewport: vi.fn(),
  autoLayout: vi.fn(),
  fitView: vi.fn().mockResolvedValue(undefined),
  onConfigChanged: vi.fn(),
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
      playground: { config: { getViewport: mocks.getViewport, onConfigChanged: mocks.onConfigChanged } },
      tools: { fitView: mocks.fitView, autoLayout: mocks.autoLayout },
      selection: { onSelectionChanged: mocks.onSelectionChanged },
      operation: { fromJSON: mocks.fromJSON },
      document: { getAllNodes: () => [], onContentChange: mocks.onContentChange, toJSON: mocks.toJSON },
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
  mocks.onConfigChanged.mockReturnValue({ dispose: mocks.dispose });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
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
  it('reads the live visible center for main and nested canvases', async () => {
    let center: (() => {x:number;y:number}) | undefined;
    const register=vi.fn((_ids:string[],getter:()=>{x:number;y:number})=>{center=getter;return vi.fn();});
    mocks.getViewport.mockReturnValue({x:1000,y:200,width:400,height:300});
    await act(async () => root.render(<WorkflowCanvas nodes={[createStartNode('start')]} edges={[]} onChange={onChange} onSelect={onSelect} onAddFromPort={vi.fn()} onRegisterViewport={register}/>));
    expect(register.mock.calls.at(-1)?.[0]).toContain('__main__');
    expect(center?.()).toEqual({x:1200,y:350});
    mocks.getViewport.mockReturnValue({x:500,y:100,width:200,height:150});
    expect(center?.()).toEqual({x:600,y:175});
    await act(async () => root.render(<WorkflowCanvas nodes={[]} edges={[]} containerId="loop" onChange={onChange} onSelect={onSelect} onAddFromPort={vi.fn()} onRegisterViewport={register}/>));
    expect(register.mock.calls.at(-1)?.[0]).toEqual(['loop::entry']);
  });
  it('does not echo intermediate fromJSON events that still contain a deleted node', async () => {
    const start=createStartNode('start');const child={id:'child',kind:'wait' as const,name:'等待',durationMs:0};
    await act(async () => root.render(<WorkflowCanvas nodes={[start,child]} edges={[]} onChange={onChange} onSelect={onSelect} onAddFromPort={vi.fn()} />));
    const listener=mocks.onContentChange.mock.calls.at(-1)![0];
    mocks.fromJSON.mockImplementation((json) => {
      mocks.toJSON.mockReturnValue({nodes:[...json.nodes,{id:'child',type:'wait',data:{config:child}}],edges:[]});
      listener();
      mocks.toJSON.mockReturnValue(json);
    });
    await act(async () => root.render(<WorkflowCanvas nodes={[start]} edges={[]} onChange={onChange} onSelect={onSelect} onAddFromPort={vi.fn()} />));
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => mocks.onContentChange.mock.calls.at(-1)![0]());
    expect(onChange).not.toHaveBeenCalled();
    mocks.fromJSON.mockReset();
  });
  it('serializes the virtual entry only as body.entryNodeId, in one atomic callback', async () => {
    const child = { id: 'child', kind: 'wait' as const, name: '内部等待', durationMs: 0 };
    await act(async () => root.render(<WorkflowCanvas nodes={[child]} edges={[]} containerId="loop" entryNodeId="child" onChange={onChange} onSelect={onSelect} onAddFromPort={vi.fn()} />));
    expect(mocks.props?.initialData?.nodes.map((n) => n.id)).toEqual(['loop::entry','child']);
    mocks.toJSON.mockReturnValue(mocks.props?.initialData);
    await act(async () => mocks.onContentChange.mock.calls.at(-1)?.[0]());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining(child)], [], 'child');
  });
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

it('collects measured layout positions without echoing intermediate changes into React', async () => {
  let controls: import('./canvas-layout').CanvasLayoutControls | undefined;
  const start = createStartNode('start');
  const register = vi.fn((_scope: string, value: import('./canvas-layout').CanvasLayoutControls) => { controls = value; return vi.fn(); });
  await act(async () => root.render(<WorkflowCanvas nodes={[start]} edges={[]} onChange={onChange} onSelect={onSelect} onAddFromPort={vi.fn()} onRegisterLayout={register} />));
  const initial = structuredClone(mocks.props!.initialData!);
  mocks.autoLayout.mockImplementation(async () => {
    mocks.toJSON.mockReturnValue({ ...initial, nodes: initial.nodes.map(node => ({ ...node, meta: { position: { x: 120, y: 180 } } })) });
    mocks.onContentChange.mock.calls.at(-1)![0]();
    return vi.fn();
  });
  expect(await controls!.arrange()).toEqual({ start: { x: 120, y: 180 } });
  expect(onChange).not.toHaveBeenCalled();
  expect(mocks.autoLayout).toHaveBeenCalledWith(expect.objectContaining({ enableAnimation: false, disableFitView: true }));
  controls!.restore(); expect(mocks.fromJSON).toHaveBeenLastCalledWith(initial);
});

it('does not save display clearance as a workflow edit when a connection changes', async () => {
  const nodes = [createStartNode('start'), { id: 'loop', kind: 'loop' as const, name: '循环', items: '[]', itemVariable: 'item', indexVariable: 'index', maxIterations: 1, position: { x: 60, y: 80 }, body: { nodes: [{ id: 'child', kind: 'wait' as const, name: '内部', durationMs: 0, position: { x: 1000, y: 400 } }], edges: [] } }];
  await act(async () => root.render(<WorkflowCanvas nodes={nodes} edges={[]} onChange={onChange} onSelect={onSelect} onAddFromPort={vi.fn()} />));
  const displayed = structuredClone(mocks.props!.initialData!);
  expect(displayed.nodes[1].meta?.position).not.toEqual(nodes[1].position);
  displayed.edges = [{ sourceNodeID: 'start', targetNodeID: 'loop', sourcePortID: 'success' }];
  mocks.toJSON.mockReturnValue(displayed);
  await act(async () => mocks.onContentChange.mock.calls.at(-1)![0]());
  expect(onChange.mock.calls.at(-1)![0]).toEqual(nodes);
});
