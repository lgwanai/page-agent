import type { WaitNode } from '@/types/workflow';

export function waitDuration(node: WaitNode, random = Math.random): number {
  const valid = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 60000;
  if (node.mode !== undefined && node.mode !== 'fixed' && node.mode !== 'random') throw new Error('等待模式无效');
  if (node.mode !== 'random') {
    if (!valid(node.durationMs)) throw new Error('等待时长需要为 0–60000 毫秒的整数');
    return node.durationMs;
  }
  const min = node.minDurationMs, max = node.maxDurationMs;
  if (!valid(min) || !valid(max) || min > max) throw new Error('随机等待区间无效：请输入 0–60000 毫秒的整数，最短时间不得大于最长时间');
  return min + Math.floor(random() * (max - min + 1));
}
