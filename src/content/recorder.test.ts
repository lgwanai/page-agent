// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordedPageEvent } from '@/types/workflow';
import { recordingToGraph } from '@/shared/recording';
import { isRecording, startRecording, stopRecording } from './recorder';

beforeEach(() => {
  vi.stubGlobal('CSS', { escape: (value: string) => value });
});
afterEach(() => {
  stopRecording();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('search page recording', () => {
  it('records a drag path once and suppresses the trailing click', () => {
    document.body.innerHTML = '<div id="handle">drag</div>';
    const source = document.querySelector<HTMLElement>('#handle')!;
    const recorded = vi.fn(); startRecording(recorded, vi.fn(), false);
    source.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 20, clientY: 20 }));
    source.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 70, clientY: 60 }));
    source.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 100, clientY: 90 }));
    source.click();
    expect(recorded).toHaveBeenCalledOnce();
    expect(recorded.mock.calls[0][0].event.type).toBe('drag');
    expect(JSON.parse(recorded.mock.calls[0][0].event.value)).toMatchObject({ dx: 80, dy: 70 });
  });
  it('keeps native HTML drag recording through pointercancel and dragend', () => {
    document.body.innerHTML = '<div id="handle" draggable="true">drag</div>';
    const source = document.querySelector<HTMLElement>('#handle')!;
    const recorded = vi.fn(); startRecording(recorded, vi.fn(), false);
    source.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
    source.dispatchEvent(new MouseEvent('dragstart', { bubbles: true }));
    source.dispatchEvent(new Event('pointercancel', { bubbles: true }));
    source.dispatchEvent(new MouseEvent('dragover', { bubbles: true, clientX: 100, clientY: 100 }));
    source.dispatchEvent(new MouseEvent('dragend', { bubbles: true, clientX: 100, clientY: 100 }));
    expect(recorded).toHaveBeenCalledOnce();
    expect(recorded.mock.calls[0][0].event.type).toBe('drag');
  });
  it('restores the overlay after a SPA removes it and does not resurrect it after stop', async () => {
    startRecording(vi.fn(), vi.fn());
    document.querySelector('#__page_agent_recording__')!.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelectorAll('#__page_agent_recording__')).toHaveLength(1);
    document.documentElement.innerHTML = '<head></head><body><button id="next">下一页</button></body>';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelectorAll('#__page_agent_recording__')).toHaveLength(1);
    stopRecording();
    document.body.innerHTML = '<div>录制结束</div>';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('#__page_agent_recording__')).toBeNull();
  });

  it('does not show recording overlays inside child frames', async () => {
    startRecording(vi.fn(), vi.fn(), false);
    document.body.innerHTML = '<div>iframe 内容</div>';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(isRecording()).toBe(true);
    expect(document.querySelector('#__page_agent_recording__')).toBeNull();
  });
  it.each(['input', 'textarea'])('records click → WorkBuddy → Enter on a %s without blur/change', (tag) => {
    document.body.innerHTML = `<form id="sb_form"><${tag} id="sb_form_q" name="q"></${tag}></form>`;
    const events: RecordedPageEvent[] = [];
    startRecording((event) => events.push({ ...event, target: { ...event.target, frameId: 0 } }), vi.fn());
    const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('#sb_form_q')!;
    field.click();
    for (const value of ['W', 'Work', 'WorkBuddy']) {
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    stopRecording();
    const graph = recordingToGraph('https://cn.bing.com/', 1, 2, events);
    expect(graph.nodes[0]).toMatchObject({ kind: 'start', targetUrl: 'https://cn.bing.com/' });
    expect(graph.nodes.slice(1)).toMatchObject([
      { kind: 'dom', target: { selector: '#sb_form_q' }, event: { type: 'click' } },
      { kind: 'dom', event: { type: 'input', value: 'WorkBuddy' } },
      { kind: 'dom', event: { type: 'pressKey', value: 'Enter' } },
    ]);
  });

  it.each(['input', 'textarea'])('keeps only Enter when a %s key handler submits its form', (tag) => {
    document.body.innerHTML = `<form id="search"><${tag} id="query"></${tag}></form>`;
    const form = document.querySelector<HTMLFormElement>('#search')!;
    form.addEventListener('submit', (event) => event.preventDefault());
    const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('#query')!;
    field.addEventListener('keydown', () => form.requestSubmit());
    const events: RecordedPageEvent[] = [];
    startRecording((event) => events.push({ ...event, target: { ...event.target, frameId: 0 } }), vi.fn());
    field.click();
    field.value = 'WorkBuddy';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const graph = recordingToGraph('https://cn.bing.com/', 1, 2, events);
    expect(graph.nodes).toHaveLength(4);
    expect(events.map((event) => event.event.type)).toEqual(['click', 'input', 'pressKey']);
  });

  it('omits the implicit default-button click and submit caused by Enter', () => {
    document.body.innerHTML = '<form id="search"><input id="query"><button id="send">搜索</button></form>';
    const form = document.querySelector<HTMLFormElement>('#search')!;
    const button = document.querySelector<HTMLButtonElement>('#send')!;
    form.addEventListener('submit', (event) => event.preventDefault());
    const field = document.querySelector<HTMLInputElement>('#query')!;
    field.addEventListener('keydown', () => button.click());
    const events: RecordedPageEvent[] = [];
    startRecording((event) => events.push({ ...event, target: { ...event.target, frameId: 0 } }), vi.fn());
    field.value = 'WorkBuddy';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(events.map((event) => event.event.type)).toEqual(['input', 'pressKey']);
  });

  it('keeps a deliberate submit-button click without adding its resulting submit', () => {
    document.body.innerHTML = '<form id="search"><button id="send">搜索</button></form>';
    document.querySelector('form')!.addEventListener('submit', (event) => event.preventDefault());
    const events: RecordedPageEvent[] = [];
    startRecording((event) => events.push({ ...event, target: { ...event.target, frameId: 0 } }), vi.fn());
    document.querySelector<HTMLButtonElement>('#send')!.click();
    expect(events.map((event) => event.event.type)).toEqual(['click']);
  });

  it('preserves standalone submissions and submissions from a different form', () => {
    document.body.innerHTML = '<form id="search"><input id="query"></form><form id="other"></form>';
    const other = document.querySelector<HTMLFormElement>('#other')!;
    other.addEventListener('submit', (event) => event.preventDefault());
    const events: RecordedPageEvent[] = [];
    startRecording((event) => events.push({ ...event, target: { ...event.target, frameId: 0 } }), vi.fn());
    other.requestSubmit();
    document.querySelector<HTMLInputElement>('#query')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    other.requestSubmit();
    expect(events.filter((event) => event.event.type === 'submit')).toHaveLength(2);
  });

  it('does not suppress a later independent submission of the same form', () => {
    document.body.innerHTML = '<form id="search"><input id="query"></form>';
    const form = document.querySelector<HTMLFormElement>('#search')!;
    form.addEventListener('submit', (event) => event.preventDefault());
    const now = vi.spyOn(Date, 'now').mockReturnValue(100);
    const events: RecordedPageEvent[] = [];
    startRecording((event) => events.push({ ...event, target: { ...event.target, frameId: 0 } }), vi.fn());
    document.querySelector<HTMLInputElement>('#query')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    now.mockReturnValue(1200);
    form.requestSubmit();
    expect(events.at(-1)?.event.type).toBe('submit');
  });

  it('captures the final field value before a page keydown handler cancels propagation', () => {
    document.body.innerHTML = '<input id="query">';
    const events: RecordedPageEvent[] = [];
    const cancel = (event: Event) => event.stopImmediatePropagation();
    document.addEventListener('keydown', cancel, true);
    try {
      startRecording((event) => events.push({ ...event, target: { ...event.target, frameId: 0 } }), vi.fn());
      const field = document.querySelector<HTMLInputElement>('#query')!;
      field.value = 'WorkBuddy';
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(events.map((event) => event.event)).toEqual([{ type: 'input', value: 'WorkBuddy' }, { type: 'pressKey', value: 'Enter' }]);
    } finally {
      document.removeEventListener('keydown', cancel, true);
    }
  });

  it('records password parameters and removes listeners when stopped', () => {
    document.body.innerHTML = '<input id="password" name="password" type="password">';
    const events: RecordedPageEvent[] = [];
    startRecording((event) => events.push({ ...event, target: { ...event.target, frameId: 0 } }), vi.fn());
    const field = document.querySelector<HTMLInputElement>('#password')!;
    field.value = 'do-not-store-this-password';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    expect(JSON.stringify(events)).not.toContain(field.value);
    expect(events[0].event.value).toBe('{{password}}');
    stopRecording();
    field.click();
    expect(events).toHaveLength(1);
    expect(isRecording()).toBe(false);
  });
});

it('records file selection as a required path parameter without fake paths or file contents', () => {
  document.body.innerHTML = '<input type="file" id="document" name="document">';
  const input = document.querySelector<HTMLInputElement>('input')!;
  Object.defineProperty(input, 'files', { value: [new File(['PRIVATE-CONTENT'], 'private-report.pdf')] });
  Object.defineProperty(input, 'value', { value: 'C:\\fakepath\\private-report.pdf' });
  const recorded: RecordedPageEvent[] = [];
  startRecording(event => recorded.push({ ...event, target: { ...event.target, frameId: 0 } }), vi.fn(), false);
  input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  stopRecording();
  const upload = recorded.find(record => record.event.type === 'upload');
  expect(upload?.event.value).toBe('{{upload_document}}');
  expect(recorded.some(record => record.event.type === 'click')).toBe(false);
  const graph = recordingToGraph('https://example.com', 1, 2, recorded);
  expect(graph.nodes[0]).toMatchObject({ inputs: [expect.objectContaining({ name: 'upload_document', required: true })] });
  expect(JSON.stringify(graph)).not.toMatch(/fakepath|private-report|PRIVATE-CONTENT/);
});
