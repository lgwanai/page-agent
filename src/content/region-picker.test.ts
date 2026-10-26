// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelRegionPicker, pickScreenshotRegion } from './region-picker';
afterEach(()=>{cancelRegionPicker();document.body.innerHTML='';vi.unstubAllGlobals();});
describe('screenshot region picker',()=>{
  it('captures a dragged rectangle in document coordinates and removes overlay',async()=>{
    vi.stubGlobal('scrollX',10);vi.stubGlobal('scrollY',100);
    const result=pickScreenshotRegion();
    const overlay=document.querySelector<HTMLElement>('[data-page-agent-overlay]')!;
    overlay.setPointerCapture=vi.fn();
    overlay.dispatchEvent(new MouseEvent('pointerdown',{clientX:80,clientY:60,button:0,bubbles:true}));
    overlay.dispatchEvent(new MouseEvent('pointerup',{clientX:20,clientY:10,button:0,bubbles:true}));
    expect(await result).toEqual({x:30,y:110,width:60,height:50});
    expect(document.querySelector('[data-page-agent-overlay]')).toBeNull();
    const pageClick=vi.fn();document.body.addEventListener('click',pageClick,{once:true});
    document.body.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    expect(pageClick).not.toHaveBeenCalled();document.body.removeEventListener('click',pageClick);
  });
  it('allows escape cancellation without leaving an overlay',async()=>{
    const rejected=expect(pickScreenshotRegion()).rejects.toThrow('已取消');
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));await rejected;
    expect(document.querySelector('[data-page-agent-overlay]')).toBeNull();
  });
});
