import { memo } from 'react';

// Geometry and stroke styles ported from the reference's renderOpenings().
const doorStroke={stroke:'#3d3a34',strokeWidth:1,vectorEffect:'non-scaling-stroke'};
const windowStroke={stroke:'#4f7394',strokeWidth:1,vectorEffect:'non-scaling-stroke'};

function Opening({opening}) {
  const [x0,y0,x1,y1]=opening.rect;
  if(opening.type==='window') {
    const w=x1-x0,h=y1-y0;
    return <g data-opening-id={opening.id} pointerEvents="none"><title>窗戶</title>
      <rect x={x0} y={y0} width={w} height={h} fill="#f7fbfd" {...windowStroke}/>
      {[1/3,2/3].map(t=>w>=h
        ?<line key={t} x1={x0} y1={y0+h*t} x2={x1} y2={y0+h*t} {...windowStroke}/>
        :<line key={t} x1={x0+(x1-x0)*t} y1={y0} x2={x0+(x1-x0)*t} y2={y1} {...windowStroke}/>)}
    </g>;
  }
  if(opening.type==='door') {
    const [hx,hy]=opening.h,L=opening.len,T=40;
    const ox=hx+opening.o[0]*L,oy=hy+opening.o[1]*L;
    const cx=hx+opening.c[0]*L,cy=hy+opening.c[1]*L;
    const sweep=opening.o[0]*opening.c[1]-opening.o[1]*opening.c[0]>0?1:0;
    const points=[[hx,hy],[ox,oy],[ox+opening.c[0]*T,oy+opening.c[1]*T],[hx+opening.c[0]*T,hy+opening.c[1]*T]];
    return <g data-opening-id={opening.id} pointerEvents="none"><title>{opening.name}</title>
      <polygon className="door-leaf" points={points.map(p=>p.join(',')).join(' ')} fill="#fff" {...doorStroke} stroke={opening.entry?'#b5653a':doorStroke.stroke} strokeWidth={opening.entry?1.8:1}/>
      <path className="door-swing-arc" d={`M${ox} ${oy}A${L} ${L} 0 0 ${sweep} ${cx} ${cy}`} fill="none" {...doorStroke} strokeDasharray="5 3" opacity=".7"/>
    </g>;
  }
  if(opening.type==='sliding-door') {
    const L=opening.v?y1-y0:x1-x0,m=opening.v?(x0+x1)/2:(y0+y1)/2;
    return <g data-opening-id={opening.id} pointerEvents="none"><title>推拉門</title>{opening.v?<>
      <rect x={m-45} y={y0} width={40} height={L*.55} fill="#fff" {...doorStroke}/>
      <rect x={m+5} y={y1-L*.55} width={40} height={L*.55} fill="#fff" {...doorStroke}/>
    </>:<>
      <rect x={x0} y={m-45} width={L*.55} height={40} fill="#fff" {...doorStroke}/>
      <rect x={x1-L*.55} y={m+5} width={L*.55} height={40} fill="#fff" {...doorStroke}/>
    </>}</g>;
  }
  return null;
}
const OpeningSymbols=memo(function OpeningSymbols({openings}) {
  const entry=openings.find(o=>o.type==='door'&&o.entry);
  return <g className="opening-symbols">
    {openings.map(opening=><Opening key={opening.id} opening={opening}/>)}
    {entry&&<g transform={`translate(${entry.h[0]-4820} ${entry.h[1]-9200})`} pointerEvents="none">
      <polygon className="entrance-marker" points="4260,8675 4400,8755 4260,8835" fill="#dc2626"/>
      <text x="4180" y="8755" fontSize="160" textAnchor="end" dominantBaseline="central" fill="#b5653a">入口</text>
    </g>}
  </g>;
});
export default OpeningSymbols;
