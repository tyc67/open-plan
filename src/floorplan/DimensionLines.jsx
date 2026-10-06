import { memo } from 'react';
import { formatLength } from './units.js';

// Apartment dimension chains from the reference, in millimetres.
import { REFERENCE_DIMENSIONS } from './dimensions.js';
const stroke={stroke:'#7d7160',strokeWidth:1,vectorEffect:'non-scaling-stroke'};
function Chain({horizontal,at,start,segments,unit}) {
  const points=[start];
  for(const value of segments)points.push(points.at(-1)+value);
  return <g className="dimension-chain">
    {horizontal?<line x1={points[0]} y1={at} x2={points.at(-1)} y2={at} {...stroke}/>:<line x1={at} y1={points[0]} x2={at} y2={points.at(-1)} {...stroke}/>}
    {points.map((p,i)=><g key={i}>{horizontal?<>
      <line x1={p} y1={at-170} x2={p} y2={at+170} {...stroke}/>
      <line x1={p-80} y1={at+80} x2={p+80} y2={at-80} {...stroke} strokeWidth={2}/>
    </>:<>
      <line x1={at-170} y1={p} x2={at+170} y2={p} {...stroke}/>
      <line x1={at-80} y1={p+80} x2={at+80} y2={p-80} {...stroke} strokeWidth={2}/>
    </>}</g>)}
    {segments.map((value,i)=>{const mid=(points[i]+points[i+1])/2,x=horizontal?mid:at-70,y=horizontal?at-70:mid;return <text key={i} x={x} y={y} fontSize={value<400?140:200} textAnchor="middle" fill="#7d7160" transform={horizontal?undefined:`rotate(-90 ${x} ${y})`}>{formatLength(value,unit)}</text>;})}
  </g>;
}
const DimensionLines=memo(function DimensionLines({chains=REFERENCE_DIMENSIONS,unit='mm'}) {
  return <g className="dimension-lines" pointerEvents="none" aria-label={`平面圖尺寸（${unit==='cm'?'公分':'毫米'}）`}>{chains.map((chain,i)=><Chain key={i} {...chain} unit={unit}/>)}</g>;
});
export default DimensionLines;
