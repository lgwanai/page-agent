// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { replayDrag } from './drag';
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });
it('replays mouse movement and verifies that a floating overlay actually moved', async () => {
  document.body.innerHTML = '<div id="panel">drag</div>';
  const element = document.querySelector<HTMLElement>('#panel')!;
  let left = 20;
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => new DOMRect(left, 10, 100, 30));
  document.elementFromPoint = vi.fn(() => element);
  const move = (event: MouseEvent) => { left = event.clientX - 50; };
  document.addEventListener('mousemove', move);
  try { expect(await replayDrag(element, '{"dx":80,"dy":0,"durationMs":100}')).toMatchObject({ moved: true, dx: 80 }); }
  finally { document.removeEventListener('mousemove', move); }
});
it('does not count dispatching events without any page result as success', async () => {
  document.body.innerHTML = '<div id="panel">drag</div>';
  const element = document.querySelector<HTMLElement>('#panel')!;
  document.elementFromPoint = vi.fn(() => element);
  expect((await replayDrag(element, '{"dx":80,"dy":0,"durationMs":100}')).moved).toBe(false);
  await expect(replayDrag(element, '{"dx":"bad","dy":0}')).rejects.toThrow('有效');
});
