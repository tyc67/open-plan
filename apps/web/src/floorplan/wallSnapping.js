import { planGeometry } from 'open-plan-core';
import { containsPoint } from 'open-plan-core';

// Trig at 90° leaves float noise (1789.9999999999998). 0.1 mm keeps odd sizes (half mm) flush.
const tenthMm = v => Math.round(v*10)/10;

// Rotated furniture bounds stay parallel to the plan axes, as in the reference.
export function snapFurniture(f,cx,cy,doc,tolerance,enabled=true,align=true) {
  const angle=f.rot*Math.PI/180,c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
  const hw=(f.w*c+f.d*s)/2,hh=(f.w*s+f.d*c)/2;
  let nx=Math.round(cx/10)*10,ny=Math.round(cy/10)*10,bx=tolerance,by=tolerance;
  let vertical=null,horizontal=null;
  if(!enabled&&!align)return {cx:nx,cy:ny,guides:[]};
  const geometry=planGeometry(doc);
  const rects=enabled?[...geometry.solids.filter(s=>!s.demolished).map(s=>s.rect),...geometry.openings.filter(o=>o.type==='window').map(o=>o.rect)]:[];
  for(const [x0,y0,x1,y1] of rects){
    if(cy+hh>y0&&cy-hh<y1){
      for(const [face,target,side] of [[x0,x0-hw,-1],[x1,x1+hw,1]]){
        const distance=Math.abs(target-cx);
        if(distance<bx&&(side<0?cx<=x0:cx>=x1)){bx=distance;nx=target;vertical={face,y0,y1};}
      }
    }
    if(cx+hw>x0&&cx-hw<x1){
      for(const [face,target,side] of [[y0,y0-hh,-1],[y1,y1+hh,1]]){
        const distance=Math.abs(target-cy);
        if(distance<by&&(side<0?cy<=y0:cy>=y1)){by=distance;ny=target;horizontal={face,x0,x1};}
      }
    }
  }
  let centerX=null,centerY=null;
  if(align){
    const room=doc.rooms.find(r=>containsPoint(r.poly,cx,cy));
    const targets=doc.furniture.filter(other=>other.id!==f.id&&(!room||containsPoint(room.poly,other.cx,other.cy))&&Math.hypot(other.cx-cx,other.cy-cy)<tolerance*24).map(other=>({x:other.cx,y:other.cy,kind:'furniture'}));
    if(room){
      let twiceArea=0,x=0,y=0;
      for(let i=0;i<room.poly.length;i++){const [ax,ay]=room.poly[i],[bx,by]=room.poly[(i+1)%room.poly.length],cross=ax*by-bx*ay;twiceArea+=cross;x+=(ax+bx)*cross;y+=(ay+by)*cross;}
      if(Math.abs(twiceArea)>1e-6)targets.push({x:x/(3*twiceArea),y:y/(3*twiceArea),kind:'room'});
    }
    let dx=tolerance*.7,dy=tolerance*.7;
    for(const target of targets){
      if(!vertical&&Math.abs(target.x-cx)<dx){dx=Math.abs(target.x-cx);nx=target.x;centerX=target;}
      if(!horizontal&&Math.abs(target.y-cy)<dy){dy=Math.abs(target.y-cy);ny=target.y;centerY=target;}
    }
  }
  let spacingX=null,spacingY=null;
  if(align){
    const room=doc.rooms.find(r=>containsPoint(r.poly,cx,cy));
    const neighbors=doc.furniture.filter(other=>other.id!==f.id&&!['rug','pendant'].includes(other.type)&&(!room||containsPoint(room.poly,other.cx,other.cy))&&Math.hypot(other.cx-cx,other.cy-cy)<tolerance*32).map(other=>{
      const a=other.rot*Math.PI/180,c=Math.abs(Math.cos(a)),s=Math.abs(Math.sin(a)),w=(other.w*c+other.d*s)/2,h=(other.w*s+other.d*c)/2;
      return {x0:other.cx-w,x1:other.cx+w,y0:other.cy-h,y1:other.cy+h};
    });
    if(!vertical&&!centerX){
      const row=neighbors.filter(o=>o.y1>ny-hh&&o.y0<ny+hh);
      const left=row.filter(o=>o.x1<=cx-hw).sort((a,b)=>b.x1-a.x1)[0],right=row.filter(o=>o.x0>=cx+hw).sort((a,b)=>a.x0-b.x0)[0];
      if(left&&right){const target=(left.x1+right.x0)/2,gap=(right.x0-left.x1-2*hw)/2;
        if(gap>0&&Math.abs(target-cx)<tolerance*.7){nx=target;spacingX={left,right,gap};}}
    }
    if(!horizontal&&!centerY){
      const column=neighbors.filter(o=>o.x1>nx-hw&&o.x0<nx+hw);
      const top=column.filter(o=>o.y1<=cy-hh).sort((a,b)=>b.y1-a.y1)[0],bottom=column.filter(o=>o.y0>=cy+hh).sort((a,b)=>a.y0-b.y0)[0];
      if(top&&bottom){const target=(top.y1+bottom.y0)/2,gap=(bottom.y0-top.y1-2*hh)/2;
        if(gap>0&&Math.abs(target-cy)<tolerance*.7){ny=target;spacingY={top,bottom,gap};}}
    }
  }
  nx=tenthMm(nx);ny=tenthMm(ny);
  const guides=[];
  if(vertical)guides.push({kind:'wall',a:{x:vertical.face,y:Math.min(vertical.y0,ny-hh)},b:{x:vertical.face,y:Math.max(vertical.y1,ny+hh)}});
  if(horizontal)guides.push({kind:'wall',a:{x:Math.min(horizontal.x0,nx-hw),y:horizontal.face},b:{x:Math.max(horizontal.x1,nx+hw),y:horizontal.face}});
  if(centerX)guides.push({kind:'center',target:centerX,a:{x:nx,y:Math.min(ny-hh,centerX.y)-tolerance},b:{x:nx,y:Math.max(ny+hh,centerX.y)+tolerance}});
  if(centerY)guides.push({kind:'center',target:centerY,a:{x:Math.min(nx-hw,centerY.x)-tolerance,y:ny},b:{x:Math.max(nx+hw,centerY.x)+tolerance,y:ny}});
  if(spacingX){const {left,right,gap}=spacingX;guides.push({kind:'spacing',distance:gap,a:{x:left.x1,y:ny},b:{x:nx-hw,y:ny}},{kind:'spacing',distance:gap,a:{x:nx+hw,y:ny},b:{x:right.x0,y:ny}});}
  if(spacingY){const {top,bottom,gap}=spacingY;guides.push({kind:'spacing',distance:gap,a:{x:nx,y:top.y1},b:{x:nx,y:ny-hh}},{kind:'spacing',distance:gap,a:{x:nx,y:ny+hh},b:{x:nx,y:bottom.y0}});}
  return {cx:nx,cy:ny,guides};
}
