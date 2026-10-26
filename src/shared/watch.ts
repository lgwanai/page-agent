import type { WatchNode } from '@/types/workflow';

export function watchMatches(value: unknown, match: WatchNode['match'], expected: string): boolean {
  if (match === 'exists') return value !== undefined && value !== null;
  if (value === undefined || value === null) return false;
  const actual = String(value);
  if (match === 'regex') return new RegExp(expected).test(actual);
  if (match === 'contains') return actual.includes(expected);
  return actual === expected;
}
