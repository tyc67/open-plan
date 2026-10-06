import { useEffect, useRef, useState } from 'react';
import { createViewer } from './three/viewer.js';

export default function FloorPlan3D({unit,wallSnap,layers,doc,selected,selectedRoom,selectedWall,onSelectWall,onSelectRoom,onSelect,onMove}) {
  const host=useRef(null), viewer=useRef(null);
  const latest=useRef({onSelect,onSelectRoom,onSelectWall,onMove}); latest.current={onSelect,onSelectRoom,onSelectWall,onMove};
  const [error,setError]=useState('');
  const [options,setOptions]=useState({cut:.9});
  useEffect(()=>{
    try {
      viewer.current=createViewer(host.current,{
        onSelect:id=>latest.current.onSelect(id),
        onSelectRoom:id=>latest.current.onSelectRoom(id),
        onSelectWall:id=>latest.current.onSelectWall(id),
        onMove:(id,position)=>latest.current.onMove(id,position),
        onError:setError,
      });
    } catch(e) { setError(`3D could not start: ${e.message}. You can continue editing in 2D.`); }
    return ()=>{viewer.current?.dispose();viewer.current=null;};
  },[]);
  useEffect(()=>{
    try { viewer.current?.sync(doc,{...options,unit,wallSnap,bearing:layers.bearing,furnitureLocked:layers.locked.furniture,furniture:layers.furniture,roomNames:layers.roomNames,areas:layers.areas}); viewer.current?.select(selected,selectedRoom,selectedWall); }
    catch(e) { setError(`Could not render the 3D plan: ${e.message}. You can continue editing in 2D.`); }
  },[doc,options,unit,wallSnap,layers,selected,selectedRoom,selectedWall]);
  return <section className="view3d" aria-label="3D floor-plan view">
    <div className="three-host" ref={host}/>
    {error?<div className="three-error" role="alert">{error}</div>:<>
      <div className="three-toolbar">
        <label>牆高<select value={options.cut} onChange={e=>setOptions(o=>({...o,cut:Number(e.target.value)}))}><option value="0.9">低 · 0.9 m</option><option value="1.5">中 · 1.5 m</option><option value="2.8">全高 · 2.8 m</option></select></label>
        <button onClick={()=>viewer.current?.resetCamera()}>重設視角</button>
      </div>
      <div className="three-hint">拖曳旋轉 · 滾輪縮放 · 右鍵拖曳平移 · 點選家具後拖曳移動</div>
    </>}
  </section>;
}
