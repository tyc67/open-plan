import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';

export default function CostDock({open,narrow,onClose,children}) {
  const panel=useRef(null),resize=useRef(null);
  const [height,setHeight]=useState(()=>{try{const value=Number(localStorage.getItem('open-plan:cost-height:v1'));return value>=180?value:340;}catch{return 340;}});
  const limit=value=>Math.max(180,Math.min(window.innerHeight-240,value));
  useEffect(()=>{try{localStorage.setItem('open-plan:cost-height:v1',String(height));}catch{/* Preferences are optional. */}},[height]);
  useEffect(()=>{if(open&&narrow&&!panel.current.open)panel.current.showModal();},[open,narrow]);
  if(!open)return null;
  const Container=narrow?'dialog':'section';
  return <Container ref={panel} id="cost-content" aria-label="費用估算" className={narrow?'cost-sheet':'cost-dock'} style={narrow?undefined:{height:limit(height)}} onClose={narrow?onClose:undefined} onKeyDown={e=>{if(narrow)e.stopPropagation();}}>
    {!narrow&&<div role="separator" aria-label="調整估算面板高度" aria-orientation="horizontal" aria-valuemin={180} aria-valuemax={Math.max(180,window.innerHeight-240)} aria-valuenow={limit(height)} tabIndex={0} className="cost-dock-resizer" onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();resize.current={y:e.clientY,height:limit(height)};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(resize.current)setHeight(limit(resize.current.height+resize.current.y-e.clientY));}} onPointerUp={e=>{resize.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{resize.current=null;}} onKeyDown={e=>{if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){e.preventDefault();setHeight(limit(e.key==='Home'?180:e.key==='End'?window.innerHeight-240:height+(e.key==='ArrowUp'?40:-40)));}}}><span/></div>}
    <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 dark:border-slate-700"><h2 className="text-sm font-bold">費用估算</h2><button type="button" aria-label={narrow?'關閉費用估算':'收合費用估算'} className="grid size-9 place-items-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700" onClick={onClose}>{narrow?<X className="size-4"/>:<ChevronDown className="size-4"/>}</button></header>
    <div className="cost-panel-content min-h-0 flex-1 overflow-auto p-4">{children}</div>
  </Container>;
}
