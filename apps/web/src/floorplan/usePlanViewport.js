import { useLayoutEffect, useRef, useState } from 'react';
import { formatLength } from './units.js';

// Same nominal CSS-pixel scale convention as the reference (96 CSS px/inch).
const MM_PER_CSS_PIXEL=25.4/96;
const boxOf=([x0,y0,x1,y1])=>({x:x0,y:y0,width:x1-x0,height:y1-y0});
// "Fit" shows `fitRect` (core fitBounds). The area is stored in the camera when Fit is used or a new plan is shown,
// so editing (for example dragging furniture past the old area) does not change the zoom.
const fitCamera=rect=>{const box=boxOf(rect);return {cx:box.x+box.width/2,cy:box.y+box.height/2,scale:null,box};};
const fitScaleOf=(c,size)=>Math.min(size.width/c.box.width,size.height/c.box.height);
// Zoom out goes to at least half the fit scale, so a large plan (fit scale below the fixed 0.012) never zooms in.
const clampScale=(s,fitScale)=>Math.max(Math.min(.012,fitScale/2),Math.min(2,s));
export default function usePlanViewport(svg,view,unit='mm',fitRect,planId) {
  const [size,setSize]=useState({width:1000,height:800});
  const [camera,setCamera]=useState(()=>fitCamera(fitRect));
  const fitRef=useRef(fitRect);fitRef.current=fitRect;
  const shownPlan=useRef(planId);
  useLayoutEffect(()=>{if(shownPlan.current!==planId){shownPlan.current=planId;setCamera(fitCamera(fitRef.current));}},[planId]);
  useLayoutEffect(()=>{
    const element=svg.current;if(view!=='2d'||!element)return;
    const measure=()=>{const width=element.clientWidth,height=element.clientHeight;if(width&&height)setSize(old=>old.width===width&&old.height===height?old:{width,height});};
    measure();const observer=new ResizeObserver(measure);observer.observe(element);
    return ()=>observer.disconnect();
  },[svg,view]);
  const scale=camera.scale??fitScaleOf(camera,size);
  const width=size.width/scale,height=size.height/scale;
  const viewport={x:camera.cx-width/2,y:camera.cy-height/2,width,height};
  function setViewport(box){setCamera(c=>({...c,cx:box.x+box.width/2,cy:box.y+box.height/2,scale:size.width/box.width}));}
  function zoom(factor){setCamera(c=>({...c,scale:clampScale((c.scale??fitScaleOf(c,size))*factor,fitScaleOf(c,size))}));}
  function zoomAt(factor,clientX,clientY) {
    const rect=svg.current?.getBoundingClientRect();if(!rect)return;
    const dx=clientX-rect.left-rect.width/2,dy=clientY-rect.top-rect.height/2;
    setCamera(c=>{const old=c.scale??fitScaleOf(c,size),next=clampScale(old*factor,fitScaleOf(c,size));
      return {...c,cx:c.cx+dx/old-dx/next,cy:c.cy+dy/old-dy/next,scale:next};});
  }
  function setRatio(ratio){setCamera(c=>({...c,scale:clampScale(1/(ratio*MM_PER_CSS_PIXEL),fitScaleOf(c,size))}));}
  function fit(){setCamera(fitCamera(fitRef.current));}
  const ratio=1/(scale*MM_PER_CSS_PIXEL);
  const barLength=[10,20,50,100,200,500,1000,2000,5000].find(length=>length*scale>=60)||5000;
  const scaleBar={label:`${formatLength(barLength,unit)} ${unit}`,pixels:barLength*scale};
  return {viewport,setViewport,zoom,zoomAt,setRatio,fit,ratio,scaleBar};
}
