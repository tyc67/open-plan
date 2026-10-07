import { useEffect, useRef, useState } from 'react';
import { effectiveCeilingHeight } from 'open-plan-core';
import { createViewer } from './three/viewer.js';

// Metres. Both are below the lowest effective ceiling (2000 mm), so "full" is always the highest.
const CUT_HEIGHTS={low:.9,mid:1.5};

export default function FloorPlan3D({unit,wallSnap,layers,doc,selected,selectedRoom,selectedWall,onSelectWall,onSelectRoom,onSelect,onMove,dragToken,controlRef,frameKey}) {
  const host=useRef(null), viewer=useRef(null);
  const latest=useRef({onSelect,onSelectRoom,onSelectWall,onMove}); latest.current={onSelect,onSelectRoom,onSelectWall,onMove,dragToken};
  const [error,setError]=useState('');
  // The cut height is a view setting. "Full" is the plan's ceiling height, so it is stored as a level, not as metres.
  const [cutLevel,setCutLevel]=useState('low');
  const ceiling=effectiveCeilingHeight(doc)/1000, cut=cutLevel==='full'?ceiling:CUT_HEIGHTS[cutLevel];
  useEffect(()=>{
    try {
      viewer.current=createViewer(host.current,{
        onSelect:id=>latest.current.onSelect(id),
        onSelectRoom:id=>latest.current.onSelectRoom(id),
        onSelectWall:id=>latest.current.onSelectWall(id),
        onMove:(id,position,token)=>latest.current.onMove(id,position,token),
        dragToken:()=>latest.current.dragToken?.(),
        onError:setError,
      });
    } catch(e) { setError(`3D could not start: ${e.message}. You can continue editing in 2D.`); }
    // The editor ends a 3D drag directly, without waiting for a render, when the open plan is swapped.
    if(controlRef)controlRef.current={cancelDrag:()=>viewer.current?.cancelDrag()};
    return ()=>{if(controlRef)controlRef.current=null;viewer.current?.dispose();viewer.current=null;};
  },[]);
  useEffect(()=>{
    try { viewer.current?.sync(doc,{frameKey:frameKey??doc.id,cut,unit,wallSnap,bearing:layers.bearing,furnitureLocked:layers.locked.furniture,furniture:layers.furniture,roomNames:layers.roomNames,areas:layers.areas}); viewer.current?.select(selected,selectedRoom,selectedWall); }
    catch(e) { setError(`Could not render the 3D plan: ${e.message}. You can continue editing in 2D.`); }
  },[doc,frameKey,cut,unit,wallSnap,layers,selected,selectedRoom,selectedWall]);
  return <section className="view3d" aria-label="3D floor-plan view">
    <div className="three-host" ref={host}/>
    {error?<div className="three-error" role="alert">{error}</div>:<>
      <div className="three-toolbar">
        <label>牆高<select value={cutLevel} onChange={e=>setCutLevel(e.target.value)}><option value="low">低 · {CUT_HEIGHTS.low} m</option><option value="mid">中 · {CUT_HEIGHTS.mid} m</option><option value="full">全高 · {ceiling} m</option></select></label>
        <button onClick={()=>viewer.current?.resetCamera()}>重設視角</button>
      </div>
      <div className="three-hint">拖曳旋轉 · 滾輪縮放 · 右鍵拖曳平移 · 點選家具後拖曳移動</div>
    </>}
  </section>;
}
