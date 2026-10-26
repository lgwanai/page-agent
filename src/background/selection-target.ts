import type { PageTarget } from '@/types/workflow';

/** sender.frameId is authoritative. sender.url can be the PRE-SPA-navigation URL. */
export function selectedPageTarget(target: Omit<PageTarget, 'frameId'>, sender: { frameId?: number; url?: string }): PageTarget {
  return { ...target, frameId: sender.frameId ?? 0, frameUrl: target.frameUrl || sender.url };
}
