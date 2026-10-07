import { describe, expect, it } from 'vitest';
import { loopItems, mapStartInputs, matchesTargetUrl } from './runner';
import { createStartNode, type LoopNode } from '@/types/workflow';

describe('graph runtime expressions', () => {
  it('resolves loop arrays from variables and JSON literals', () => {
    const node: LoopNode = { id: 'loop', kind: 'loop', name: '循环', items: '{{items}}', itemVariable: 'item', indexVariable: 'index', maxIterations: 10 };
    expect(loopItems(node, { items: ['a', 'b'] }, {})).toEqual(['a', 'b']);
    expect(loopItems({ ...node, items: '[1,2,3]' }, {}, {})).toEqual([1, 2, 3]);
  });
});

describe('Start URL validation', () => {
  it('uses origin and path for normal validation', () => {
    expect(matchesTargetUrl('https://example.com/app?ticket=done', 'https://example.com/app?from=login', false)).toBe(true);
    expect(matchesTargetUrl('https://example.com/login', 'https://example.com/app', false)).toBe(false);
  });

  it('includes query parameters in strict validation', () => {
    expect(matchesTargetUrl('https://example.com/app?mode=1#section', 'https://example.com/app?mode=1', true)).toBe(true);
    expect(matchesTargetUrl('https://example.com/app?mode=2', 'https://example.com/app?mode=1', true)).toBe(false);
  });
});

describe('Start MCP JSON inputs', () => {
  it('maps same-named JSON values without flattening their types', () => {
    const node = createStartNode('start');
    node.inputs = [
      { id: 'name', name: '客户名', type: 'string', required: true },
      { id: 'orders', name: '订单列表', type: 'objectArray', required: false },
      { id: 'quantity', name: '数量', type: 'number', required: false },
    ];

    expect(mapStartInputs(node, {
      客户名: '华贸',
      orders: [{ id: 1 }, { id: 2 }],
      订单列表: [{ id: 1 }, { id: 2 }],
      数量: 2,
    })).toEqual({ 客户名: '华贸', 订单列表: [{ id: 1 }, { id: 2 }], 数量: 2 });
  });

  it('ignores missing optional parameters and rejects missing required parameters', () => {
    const node = createStartNode('start');
    node.inputs = [{ id: 'city', name: '城市', type: 'string', required: false }];
    expect(mapStartInputs(node, {})).toEqual({});

    node.inputs = [{ id: 'phone', name: '手机号', type: 'string', required: true }];
    expect(() => mapStartInputs(node, {})).toThrow('MCP JSON 缺少必填参数：手机号');
  });

  it('validates numbers, objects, arrays and object arrays', () => {
    const node = createStartNode('start');
    node.inputs = [
      { id: 'profile', name: '客户资料', type: 'object', required: true },
      { id: 'tags', name: '标签', type: 'array', required: true },
      { id: 'orders', name: '订单', type: 'objectArray', required: true },
    ];
    expect(mapStartInputs(node, { 客户资料: {}, 标签: ['重点'], 订单: [{ id: 1 }] })).toEqual({
      客户资料: {}, 标签: ['重点'], 订单: [{ id: 1 }],
    });
    expect(() => mapStartInputs(node, { 客户资料: [], 标签: ['重点'], 订单: [{ id: 1 }] }))
      .toThrow('MCP 参数「客户资料」类型不正确，需要对象');
    expect(() => mapStartInputs(node, { 客户资料: {}, 标签: [{ name: '重点' }], 订单: [{ id: 1 }] }))
      .toThrow('MCP 参数「标签」类型不正确，需要列表');
    expect(() => mapStartInputs(node, { 客户资料: {}, 标签: [], 订单: ['错误'] }))
      .toThrow('MCP 参数「订单」类型不正确，需要对象列表');
  });
});
