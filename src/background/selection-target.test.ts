import { expect, it } from 'vitest';
import { selectedPageTarget } from './selection-target';
import { captureFrameContext } from '@/shared/frame-context';

it('does not replace the live SPA URL with the sender initial document URL', () => {
  const live = 'https://seller.example/apply?activityId=123&puCode=baseInfoSetting&processId=fresh';
  const captured = { name: '去选择', selector: 'button.next-small', tagName: 'button', label: '去选择', ...captureFrameContext(live) };
  const result = selectedPageTarget(captured, { frameId: 47, url: 'https://seller.example/apply?activityId=123&bizData=old' });
  expect(result).toMatchObject({ frameId: 47, frameUrl: live, frameQueryKeys: ['activityId', 'puCode'] });
  expect(result.selector).toBe(captured.selector);
});
it('falls back to sender metadata only when the content capture did not supply a URL', () => {
  expect(selectedPageTarget({ name: '', selector: '#a', tagName: 'input', label: '' }, { frameId: 9, url: 'https://example.com/frame' }))
    .toMatchObject({ frameId: 9, frameUrl: 'https://example.com/frame' });
});
