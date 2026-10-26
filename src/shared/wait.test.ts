import { describe, expect, it } from 'vitest';
import { waitDuration } from './wait';
import type { WaitNode } from '@/types/workflow';
const node: WaitNode = {id:'wait',kind:'wait',name:'等待',durationMs:100};
describe('wait duration', () => {
  it('keeps legacy fixed waits', () => expect(waitDuration(node)).toBe(100));
  it('samples inclusive integer bounds', () => {
    const random:WaitNode={...node,mode:'random',minDurationMs:500,maxDurationMs:1500};
    expect(waitDuration(random,()=>0)).toBe(500);
    expect(waitDuration(random,()=>0.999999)).toBe(1500);
    expect(waitDuration({...random,minDurationMs:500,maxDurationMs:500})).toBe(500);
  });
  it.each([[100,50],[-1,50],[0,60001],[0.5,2],[NaN,2]])('rejects invalid range %s–%s', (minDurationMs,maxDurationMs) => {
    expect(()=>waitDuration({...node,mode:'random',minDurationMs,maxDurationMs})).toThrow('区间无效');
  });
});
