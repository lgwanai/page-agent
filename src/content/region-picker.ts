let cancelCurrent: (() => void) | undefined;
export function cancelRegionPicker() { cancelCurrent?.(); }
export function pickScreenshotRegion(): Promise<{ x: number; y: number; width: number; height: number }> {
  cancelRegionPicker();
  return new Promise((resolve, reject) => {
    const overlay=document.createElement('div');
    overlay.setAttribute('data-page-agent-overlay','true');
    overlay.style.cssText='position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,.15);touch-action:none';
    const box=document.createElement('div');box.style.cssText='position:absolute;border:2px solid #6655ee;box-sizing:border-box;background:rgba(102,85,238,.12);pointer-events:none';
    const hint=document.createElement('div');hint.textContent='拖动框选截图区域 · Esc 取消';hint.style.cssText='position:absolute;top:12px;left:12px;padding:10px;background:white;color:#333;border-radius:8px;pointer-events:none';
    overlay.append(box,hint);document.documentElement.append(overlay);
    let start:{x:number;y:number}|undefined;
    const cleanup=()=>{overlay.remove();window.removeEventListener('keydown',key,true);cancelCurrent=undefined;};
    const cancel=()=>{cleanup();reject(new Error('已取消框选截图'));};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();cancel();}};
    window.addEventListener('keydown',key,true);cancelCurrent=cancel;
    overlay.addEventListener('pointerdown',(event)=>{event.preventDefault();event.stopPropagation();if(event.button!==0)return;start={x:event.clientX,y:event.clientY};overlay.setPointerCapture(event.pointerId);});
    overlay.addEventListener('pointermove',(event)=>{event.preventDefault();event.stopPropagation();if(!start)return;Object.assign(box.style,{left:`${Math.min(start.x,event.clientX)}px`,top:`${Math.min(start.y,event.clientY)}px`,width:`${Math.abs(event.clientX-start.x)}px`,height:`${Math.abs(event.clientY-start.y)}px`});});
    overlay.addEventListener('pointerup',(event)=>{event.preventDefault();event.stopPropagation();if(!start)return;const region={x:Math.min(start.x,event.clientX)+window.scrollX,y:Math.min(start.y,event.clientY)+window.scrollY,width:Math.abs(event.clientX-start.x),height:Math.abs(event.clientY-start.y)};const block=(click:MouseEvent)=>{click.preventDefault();click.stopImmediatePropagation();window.removeEventListener('click',block,true);};window.addEventListener('click',block,true);setTimeout(()=>window.removeEventListener('click',block,true),250);cleanup();if(region.width<2||region.height<2)reject(new Error('框选区域过小'));else resolve(region);});
    overlay.onwheel=(event)=>{event.preventDefault();event.stopPropagation();};
    overlay.onclick=(event)=>{event.preventDefault();event.stopPropagation();};
  });
}
