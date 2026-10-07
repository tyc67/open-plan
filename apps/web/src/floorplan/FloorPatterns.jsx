import { memo } from 'react';

export const FLOOR_PATTERN_IDS=new Set(['wood','walnut','tile800','tile600','antislip','marble','terrazzo','carpet']);
// Each room gets its own copy of its material pattern, anchored at the room's top-left corner. Patterns
// anchored at the plan origin would shift inside a room when the whole plan moves.
const roomPatternId=i=>`floor-room-${i}`;
export const roomFloorFill=(room,i,fallback='#eee')=>FLOOR_PATTERN_IDS.has(room.mat)?`url(#${roomPatternId(i)})`:fallback;
export const RoomPatterns=memo(function RoomPatterns({rooms}){
  return rooms.map((r,i)=>{
    if(!FLOOR_PATTERN_IDS.has(r.mat))return null;
    const x=Math.min(...r.poly.map(p=>p[0])),y=Math.min(...r.poly.map(p=>p[1]));
    return <pattern key={i} id={roomPatternId(i)} href={`#floor-${r.mat}`} patternTransform={`translate(${x} ${y})`}/>;
  });
});
function Plank({id,base,line}) {
  return <pattern id={`floor-${id}`} patternUnits="userSpaceOnUse" width="1800" height="360">
    <rect width="1800" height="360" fill={base}/>
    <path d="M0 0H1800M0 180H1800M1200 0V180M600 180V360" stroke={line} strokeWidth="10"/>
    <path d="M100 70Q500 60 900 85T1700 75M200 260Q700 250 1100 275T1750 262" stroke={line} strokeWidth="5" fill="none" opacity=".45"/>
  </pattern>;
}
function Tile({id,size,base,line}) {
  return <pattern id={`floor-${id}`} patternUnits="userSpaceOnUse" width={size} height={size}>
    <rect width={size} height={size} fill={base}/><path d={`M0 0H${size}M0 0V${size}`} stroke={line} strokeWidth="10"/>
  </pattern>;
}
export default memo(function FloorPatterns(){
  return <>
    <Plank id="wood" base="#dcc09a" line="#bf9d70"/>
    <Plank id="walnut" base="#a57c56" line="#80593a"/>
    <Tile id="tile800" size={800} base="#ece7de" line="#d3cabb"/>
    <Tile id="tile600" size={600} base="#e2e6e3" line="#c4cbc6"/>
    <Tile id="antislip" size={300} base="#d6dbd7" line="#b3bab4"/>
    <pattern id="floor-marble" patternUnits="userSpaceOnUse" width="1200" height="1200">
      <rect width="1200" height="1200" fill="#f3f0ea"/><path d="M0 0H1200M0 0V1200" stroke="#dcd5c8" strokeWidth="10"/>
      <path d="M-50 300C250 260 380 520 700 470S1100 640 1260 600M200 1200C300 950 520 980 640 820" stroke="#d6cfc2" strokeWidth="12" fill="none"/>
    </pattern>
    <pattern id="floor-terrazzo" patternUnits="userSpaceOnUse" width="500" height="500">
      <rect width="500" height="500" fill="#e8e1d5"/>
      {[[60,80,22,'#b9a58c'],[310,140,16,'#8fa3a0'],[190,330,26,'#c9b7a2'],[420,400,18,'#a88f76'],[90,440,12,'#8fa3a0'],[440,40,10,'#b9a58c']].map(([cx,cy,r,fill],i)=><circle key={i} cx={cx} cy={cy} r={r} fill={fill}/>)}
    </pattern>
    <pattern id="floor-carpet" patternUnits="userSpaceOnUse" width="120" height="120">
      <rect width="120" height="120" fill="#c9c3d3"/><circle cx="30" cy="30" r="8" fill="#bab3c6"/><circle cx="90" cy="90" r="8" fill="#bab3c6"/>
    </pattern>
  </>;
});
