import { planGeometry } from 'open-plan-core';
import { formatLength } from './units.js';

export function snapMeasurement(point,doc,mmPerPixel,anchor,lockAxis) {
  const tolerance=8*mmPerPixel;
  const segments=[];
  const geometry=planGeometry(doc);
  for(const wall of geometry.solids.filter(s=>!s.demolished)){const [x0,y0,x1,y1]=wall.rect;segments.push([{x:x0,y:y0},{x:x1,y:y0}],[{x:x1,y:y0},{x:x1,y:y1}],[{x:x1,y:y1},{x:x0,y:y1}],[{x:x0,y:y1},{x:x0,y:y0}]);}
  for(const opening of geometry.openings){const [x0,y0,x1,y1]=opening.rect;segments.push([{x:x0,y:y0},{x:x1,y:y0}],[{x:x1,y:y0},{x:x1,y:y1}],[{x:x1,y:y1},{x:x0,y:y1}],[{x:x0,y:y1},{x:x0,y:y0}]);}
  let result={x:Math.round(point.x/10)*10,y:Math.round(point.y/10)*10},best=tolerance;
  const horizontal=anchor&&lockAxis&&Math.abs(point.x-anchor.x)>=Math.abs(point.y-anchor.y);
  const constrained=anchor&&lockAxis?{x:horizontal?point.x:anchor.x,y:horizontal?anchor.y:point.y}:point;
  const targets=[
    ...geometry.openings.filter(o=>o.type==='door').map(o=>({x:o.h[0],y:o.h[1],snap:'hinge'})),
    ...segments.flatMap(([a,b])=>[{...a,snap:'corner'},{...b,snap:'corner'}]),
    ...doc.rooms.flatMap(r=>r.poly.map(([x,y])=>({x,y,snap:'corner'}))),
  ];
  let target=null,targetDistance=tolerance;
  for(const candidate of targets){
    if(anchor&&lockAxis&&(horizontal?Math.abs(candidate.y-anchor.y):Math.abs(candidate.x-anchor.x))>1e-6)continue;
    const distance=Math.hypot(candidate.x-constrained.x,candidate.y-constrained.y);
    if(distance<targetDistance){target=candidate;targetDistance=distance;}
  }
  if(target)return target;
  for(const [a,b] of segments){
    const dx=b.x-a.x,dy=b.y-a.y;
    let candidate;
    if(anchor&&lockAxis){
      if(horizontal&&dy&&anchor.y>=Math.min(a.y,b.y)&&anchor.y<=Math.max(a.y,b.y))candidate={x:a.x+(anchor.y-a.y)*dx/dy,y:anchor.y};
      else if(!horizontal&&dx&&anchor.x>=Math.min(a.x,b.x)&&anchor.x<=Math.max(a.x,b.x))candidate={x:anchor.x,y:a.y+(anchor.x-a.x)*dy/dx};
      else continue;
    }else{const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(dx*dx+dy*dy||1)));candidate={x:a.x+t*dx,y:a.y+t*dy};}
    const distance=Math.hypot(candidate.x-constrained.x,candidate.y-constrained.y);
    if(distance<best){best=distance;result={...candidate,snap:'edge'};}
  }
  if(anchor&&lockAxis){if(horizontal)result.y=anchor.y;else result.x=anchor.x;}
  return result;
}
function Measurement({a,b,unit,k,preview,selected,onSelect,selectable,id}) {
  const length=Math.hypot(b.x-a.x,b.y-a.y),color=preview?'#0d9488':selected?'#7c3aed':'#b5653a';
  if(length<1)return null;
  const nx=-(b.y-a.y)/length*5*k,ny=(b.x-a.x)/length*5*k,mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
  let angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;if(angle>90||angle<-90)angle+=180;
  const stroke={stroke:color,strokeWidth:selected?2.5:1.5,vectorEffect:'non-scaling-stroke'};
  return <g className={preview?'measurement-preview':'measurement-line'+(selected?' selected-measurement':'')} data-measurement-id={id} onPointerDown={e=>{if(selectable&&e.button===0){e.stopPropagation();onSelect(id);}}}>
    {!preview&&<line className="measurement-hit-area" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth="14" vectorEffect="non-scaling-stroke" pointerEvents={selectable?'stroke':'none'} style={{cursor:selectable?'pointer':undefined}}/>}
    {selected&&[a,b].map((p,i)=><circle key={i} cx={p.x} cy={p.y} r={4*k} fill="white" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke"/>)}
    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...stroke} strokeDasharray={preview?'5 3':undefined}/>
    {[a,b].map((p,i)=><line key={i} x1={p.x-nx} y1={p.y-ny} x2={p.x+nx} y2={p.y+ny} {...stroke}/>)}
    <g transform={`translate(${mx} ${my}) rotate(${angle})`}><text pointerEvents={selectable?'all':'none'} style={{cursor:selectable?'pointer':undefined}} y={-6*k} textAnchor="middle" fontSize={12*k} fontWeight="600" fill={color} stroke="#fff" strokeWidth={3.5*k} paintOrder="stroke">{formatLength(length,unit)} {unit}</text></g>
  </g>;
}
export default function Measurements({measurements=[],preview,snapPoint,unit,ratio,selectedId,onSelect,selectable}) {
  const k=ratio*25.4/96;
  return <g className="measurements" pointerEvents="none">{measurements.map((m,i)=><Measurement key={m.id??i} {...m} unit={unit} k={k} selected={m.id===selectedId} onSelect={onSelect} selectable={selectable}/>)}{preview&&<><Measurement {...preview} unit={unit} k={k} preview/><circle cx={preview.a.x} cy={preview.a.y} r={3*k} fill="#0d9488"/><circle cx={preview.b.x} cy={preview.b.y} r={3*k} fill="#0d9488"/></>}{snapPoint?.snap&&<g className="measurement-snap-marker" data-snap-kind={snapPoint.snap} transform={`translate(${snapPoint.x} ${snapPoint.y})`}>
    {snapPoint.snap==='hinge'?<circle r={6*k} fill="white" stroke="#d97706" strokeWidth="2" vectorEffect="non-scaling-stroke"/>:snapPoint.snap==='corner'?<rect x={-5*k} y={-5*k} width={10*k} height={10*k} fill="white" stroke="#0d9488" strokeWidth="2" vectorEffect="non-scaling-stroke"/>:<path d={`M 0 ${-6*k} L ${6*k} 0 L 0 ${6*k} L ${-6*k} 0 Z`} fill="white" stroke="#0d9488" strokeWidth="2" vectorEffect="non-scaling-stroke"/>}
    <text x={9*k} y={-9*k} fontSize={11*k} fill={snapPoint.snap==='hinge'?'#b45309':'#0f766e'} stroke="white" strokeWidth={3*k} paintOrder="stroke">{snapPoint.snap==='hinge'?'門鉸鏈':snapPoint.snap==='corner'?'角點':'邊緣'}</text>
  </g>}</g>;
}
