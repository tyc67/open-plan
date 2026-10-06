import { useEffect, useRef } from 'react';

export default function useTouchNavigation(svg,view,setViewport,cancelSingle) {
  const latest=useRef({setViewport,cancelSingle});latest.current={setViewport,cancelSingle};
  useEffect(()=>{
    const element=svg.current;if(view!=='2d'||!element)return;
    const touches=new Map();let navigating=false,pinch=null;
    const consume=e=>{if(e.cancelable)e.preventDefault();e.stopImmediatePropagation();};
    function begin(){
      const [a,b]=[...touches.values()],rect=element.getBoundingClientRect(),matrix=element.getScreenCTM();
      if(!matrix||!rect.width||!rect.height)return;
      const x=(a.x+b.x)/2,y=(a.y+b.y)/2,p=new DOMPoint(x,y).matrixTransform(matrix.inverse());
      pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),scale:Math.hypot(matrix.a,matrix.b),anchor:p};
    }
    function down(e){
      if(e.pointerType!=='touch'||!element.contains(e.target))return;
      touches.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(touches.size>=2){
        consume(e);if(!navigating){latest.current.cancelSingle();navigating=true;}
        if(touches.size===2)begin();
        for(const id of touches.keys())try{element.setPointerCapture(id);}catch{/* Pointer may already have ended. */}
      }
    }
    function move(e){
      if(!touches.has(e.pointerId))return;
      touches.set(e.pointerId,{x:e.clientX,y:e.clientY});if(!navigating)return;consume(e);
      if(touches.size<2||!pinch)return;
      const [a,b]=[...touches.values()],rect=element.getBoundingClientRect();
      const scale=Math.max(.012,Math.min(2,pinch.scale*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance));
      const width=rect.width/scale,height=rect.height/scale;
      latest.current.setViewport({x:pinch.anchor.x-((a.x+b.x)/2-rect.left)/scale,y:pinch.anchor.y-((a.y+b.y)/2-rect.top)/scale,width,height});
    }
    function end(e){
      if(!touches.has(e.pointerId))return;
      touches.delete(e.pointerId);if(!navigating)return;consume(e);
      if(element.hasPointerCapture(e.pointerId))element.releasePointerCapture(e.pointerId);
      if(touches.size>=2)begin();else pinch=null;
      if(!touches.size)navigating=false;
    }
    function reset(){if(navigating)latest.current.cancelSingle();for(const id of touches.keys())if(element.hasPointerCapture(id))element.releasePointerCapture(id);touches.clear();navigating=false;pinch=null;}
    const visibility=()=>{if(document.hidden)reset();};
    document.addEventListener('pointerdown',down,true);document.addEventListener('pointermove',move,true);document.addEventListener('pointerup',end,true);document.addEventListener('pointercancel',end,true);window.addEventListener('blur',reset);document.addEventListener('visibilitychange',visibility);
    return ()=>{reset();document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointermove',move,true);document.removeEventListener('pointerup',end,true);document.removeEventListener('pointercancel',end,true);window.removeEventListener('blur',reset);document.removeEventListener('visibilitychange',visibility);};
  },[svg,view]);
}
