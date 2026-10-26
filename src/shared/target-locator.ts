/** Validate persisted/externally authored plans before rendering or executing them. */
export function validateTargetLocator(target: unknown): void {
  if (!target || typeof target !== 'object') return;
  const value = target as Record<string, unknown>;
  if (value.frameName !== undefined && (typeof value.frameName !== 'string' || value.frameName.length > 1000)) throw new Error('Frame 名称无效');
  if (value.locator === undefined) return;
  const plan = value.locator as Record<string, unknown>;
  const string = (v: unknown, limit = 10000) => typeof v === 'string' && v.length > 0 && v.length <= limit;
  if (!plan || typeof plan !== 'object' || plan.version !== 1 || !string(plan.selector) || !string(plan.tagName,100) || !['high','medium','low'].includes(String(plan.confidence))
    || (plan.inputType !== undefined && !string(plan.inputType,100)) || !Array.isArray(plan.candidates) || !plan.candidates.length || plan.candidates.length > 100) throw new Error('节点定位规则无效');
  for (const raw of plan.candidates) {
    const candidate = raw as Record<string, unknown>;
    if (!candidate || typeof candidate !== 'object' || !['id','name','ancestor-exact','ancestor','attribute','text','class','tag','position'].includes(String(candidate.kind))
      || !string(candidate.selector) || (candidate.anchor !== undefined && !string(candidate.anchor))
      || (candidate.parentFingerprint !== undefined && !string(candidate.parentFingerprint,1000000))) throw new Error('节点定位候选规则无效');
    if (candidate.match !== undefined) {
      const match = candidate.match as Record<string, unknown>;
      if (!match || typeof match !== 'object' || !['text','value'].includes(String(match.kind)) || !string(match.value)) throw new Error('节点精确匹配规则无效');
    }
  }
}
