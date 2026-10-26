import { expect, it } from 'vitest';
import { captureFrameContext, matchesFrameUrl } from './frame-context';

it('excludes only the runtime processId while preserving business query guards', () => {
  const before = 'https://seller.example/apply?activityId=123&puCode=baseInfoSetting&processId=old';
  const context = captureFrameContext(before);
  expect(context).toEqual({ frameUrl: before, frameQueryKeys: ['activityId', 'puCode'] });
  expect(matchesFrameUrl(before.replace('processId=old', 'processId=new'), before, context.frameQueryKeys)).toBe(true);
  for (const url of [before.replace('activityId=123', 'activityId=456'), before.replace('baseInfoSetting', 'submit'), before.replace('seller.example', 'other.example'), before.replace('/apply?', '/detail?')]) {
    expect(matchesFrameUrl(url, before, context.frameQueryKeys)).toBe(false);
  }
});
it('keeps legacy exact URL scoping and does not silently ignore old business parameters', () => {
  expect(captureFrameContext('https://example.com/app?id=1')).toEqual({ frameUrl: 'https://example.com/app?id=1', frameQueryKeys: ['id'] });
  expect(matchesFrameUrl('https://example.com/app?id=1#section', 'https://example.com/app?id=1')).toBe(true);
  expect(matchesFrameUrl('https://example.com/app?id=2', 'https://example.com/app?id=1')).toBe(false);
});
it('compares repeated guarded parameters without allowing missing guards or other paths', () => {
  expect(matchesFrameUrl('https://example.com/app?tag=b&tag=a', 'https://example.com/app?tag=a&tag=b', ['tag'])).toBe(true);
  expect(matchesFrameUrl('https://example.com/app?tag=a', 'https://example.com/app?tag=a&tag=b', ['tag'])).toBe(false);
  expect(matchesFrameUrl('https://example.com/app', 'https://example.com/app', ['missing'])).toBe(false);
  expect(matchesFrameUrl('https://example.com/other', 'https://example.com/app', [])).toBe(false);
});
