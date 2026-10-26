import { expect, it } from 'vitest';
import { validateTargetLocator } from './target-locator';
it('accepts legacy targets and validates semantic plans from external workflows', () => {
  expect(() => validateTargetLocator({ selector:'#save' })).not.toThrow();
  const plan = {version:1,selector:'#tools button',tagName:'button',confidence:'high',candidates:[{kind:'ancestor-exact',anchor:'#tools',selector:'button',match:{kind:'text',value:'保存'}}]};
  expect(() => validateTargetLocator({locator:plan})).not.toThrow();
  for (const locator of [null,{}, {...plan,candidates:[]},{...plan,candidates:[{kind:'unknown',selector:'button'}]}, {...plan,candidates:[{kind:'text',selector:'button',match:{kind:'regex',value:'.*'}}]}]) {
    expect(() => validateTargetLocator({locator})).toThrow('规则无效');
  }
});
