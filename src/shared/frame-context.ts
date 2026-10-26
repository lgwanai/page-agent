/** Keep legacy exact URLs; new captures exclude known runtime keys but guard business parameters. */
export function captureFrameContext(frameUrl: string): { frameUrl: string; frameQueryKeys?: string[] } {
  try {
    const url = new URL(frameUrl);
    return { frameUrl, frameQueryKeys: [...new Set(url.searchParams.keys())].filter(key => !/^(processid|sessionid|jsessionid|timestamp|_t|_ts|_|cachebust|cachebuster)$/i.test(key)) };
  } catch { return { frameUrl }; }
}

export function matchesFrameUrl(actualUrl: string, expectedUrl: string, queryKeys?: string[]): boolean {
  try {
    const actual = new URL(actualUrl), expected = new URL(expectedUrl);
    actual.hash = ''; expected.hash = '';
    if (queryKeys === undefined) return actual.href === expected.href;
    if (!Array.isArray(queryKeys) || queryKeys.some(key => typeof key !== 'string')) return false;
    if (actual.origin !== expected.origin || actual.pathname !== expected.pathname) return false;
    return queryKeys.every(key => {
      const a = actual.searchParams.getAll(key).sort(), b = expected.searchParams.getAll(key).sort();
      return b.length > 0 && JSON.stringify(a) === JSON.stringify(b);
    });
  } catch { return queryKeys === undefined && actualUrl === expectedUrl; }
}
