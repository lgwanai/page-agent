import { describe, expect, it } from 'vitest';
import { watchMatches } from './watch';

describe('Watch 条件', () => {
  it('匹配状态、进度和正则', () => {
    expect(watchMatches('完成', 'equals', '完成')).toBe(true);
    expect(watchMatches('导出完成', 'contains', '完成')).toBe(true);
    expect(watchMatches('100%', 'regex', '^100%$')).toBe(true);
    expect(watchMatches('99', 'equals', '100')).toBe(false);
  });
  it('区分缺失属性和空属性', () => {
    expect(watchMatches(undefined, 'exists', '')).toBe(false);
    expect(watchMatches('', 'exists', '')).toBe(true);
    expect(watchMatches(undefined, 'equals', '')).toBe(false);
  });
  it('拒绝非法正则', () => expect(() => watchMatches('x', 'regex', '[')).toThrow());
});
