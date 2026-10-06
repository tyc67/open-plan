import { formatLength } from './units.js';
export default function SnapGuides({guides,unit,ratio}) {
  const k=ratio*25.4/96;
  return <g className="wall-snap-guides" pointerEvents="none">{guides.map((guide,i)=>{
    const color=guide.kind==='spacing'?'#0891b2':guide.kind==='center'?'#c026d3':'#e11d48';
    const horizontal=guide.a.y===guide.b.y;
    return <g key={i} data-guide-kind={guide.kind}>
      <line x1={guide.a.x} y1={guide.a.y} x2={guide.b.x} y2={guide.b.y} stroke={color} strokeWidth="2" strokeDasharray={guide.kind==='spacing'?undefined:guide.kind==='center'?'3 3':'6 4'} vectorEffect="non-scaling-stroke"/>
      {guide.kind==='spacing'&&<>
        {[guide.a,guide.b].map((p,j)=><line key={j} x1={p.x-(horizontal?0:4*k)} y1={p.y-(horizontal?4*k:0)} x2={p.x+(horizontal?0:4*k)} y2={p.y+(horizontal?4*k:0)} stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>)}
        <text x={(guide.a.x+guide.b.x)/2+(horizontal?0:8*k)} y={(guide.a.y+guide.b.y)/2-(horizontal?7*k:0)} textAnchor={horizontal?'middle':'start'} dominantBaseline="central" fontSize={11*k} fontWeight="600" fill={color} stroke="white" strokeWidth={3*k} paintOrder="stroke">{formatLength(guide.distance,unit)} {unit}</text>
      </>}
    </g>;
  })}</g>;
}
