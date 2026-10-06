import { useLayoutEffect, useState } from 'react';
import { formatLength } from './units.js';

// Same nominal CSS-pixel scale convention as the reference (96 CSS px/inch).
const MM_PER_CSS_PIXEL=25.4/96;
const BOUNDS={x:-1850,y:-1750,width:15600,height:14100};
const center={cx:BOUNDS.x+BOUNDS.width/2,cy:BOUNDS.y+BOUNDS.height/2};
const clampScale=s=>Math.max(.012,Math.min(2,s));
export default function usePlanViewport(svg,view,unit='mm') {
  const [size,setSize]=useState({width:1000,height:800});
  const [camera,setCamera]=useState({...center,scale:null});
  useLayoutEffect(()=>{
    const element=svg.current;if(view!=='2d'||!element)return;
    const measure=()=>{const width=element.clientWidth,height=element.clientHeight;if(width&&height)setSize(old=>old.width===width&&old.height===height?old:{width,height});};
    measure();const observer=new ResizeObserver(measure);observer.observe(element);
    return ()=>observer.disconnect();
  },[svg,view]);
  const scale=camera.scale??Math.min(size.width/BOUNDS.width,size.height/BOUNDS.height);
  const width=size.width/scale,height=size.height/scale;
  const viewport={x:camera.cx-width/2,y:camera.cy-height/2,width,height};
  function setViewport(box){setCamera({cx:box.x+box.width/2,cy:box.y+box.height/2,scale:size.width/box.width});}
  function zoom(factor){setCamera(c=>({...c,scale:clampScale((c.scale??Math.min(size.width/BOUNDS.width,size.height/BOUNDS.height))*factor)}));}
  function zoomAt(factor,clientX,clientY) {
    const rect=svg.current?.getBoundingClientRect();if(!rect)return;
    const dx=clientX-rect.left-rect.width/2,dy=clientY-rect.top-rect.height/2;
    setCamera(c=>{const old=c.scale??Math.min(size.width/BOUNDS.width,size.height/BOUNDS.height),next=clampScale(old*factor);
      return {cx:c.cx+dx/old-dx/next,cy:c.cy+dy/old-dy/next,scale:next};});
  }
  function setRatio(ratio){setCamera(c=>({...c,scale:clampScale(1/(ratio*MM_PER_CSS_PIXEL))}));}
  function fit(){setCamera({...center,scale:null});}
  const ratio=1/(scale*MM_PER_CSS_PIXEL);
  const barLength=[10,20,50,100,200,500,1000,2000,5000].find(length=>length*scale>=60)||5000;
  const scaleBar={label:`${formatLength(barLength,unit)} ${unit}`,pixels:barLength*scale};
  return {viewport,setViewport,zoom,zoomAt,setRatio,fit,ratio,scaleBar};
}
