import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { createId } from './ids.js';
import { RotateCw, Trash2 } from 'lucide-react';
import WorkspaceShell from '../workspace/WorkspaceShell.jsx';
import { createDocument } from './document.js';
import { loadDocument, preserveUnreadableDocument, saveDocument } from './storage.js';
import { LIB } from './seed.js';
import CostEstimate from './CostEstimate.jsx';
import SnapGuides from './SnapGuides.jsx';
import WallProperties, { canDemolish } from './WallProperties.jsx';
import FurnitureAppearance from './FurnitureAppearance.jsx';
import FloorPatterns, { floorPatternFill } from './FloorPatterns.jsx';
import FurnitureSymbol from './FurnitureSymbol.jsx';
import OpeningSymbols from './OpeningSymbols.jsx';
import { snapFurniture } from './wallSnapping.js';
import { loadLayers, saveLayers } from './layers.js';
import Measurements, { snapMeasurement } from './Measurements.jsx';
import RoomProperties from './RoomProperties.jsx';
import { roomArea } from './roomGeometry.js';
import DimensionLines from './DimensionLines.jsx';
import { formatLength, unitFactor } from './units.js';
import useTouchNavigation from './useTouchNavigation.js';
import usePlanViewport from './usePlanViewport.js';
// The browser keeps a failed chunk import for the page's lifetime, so recovery needs a page reload.
const FloorPlan3D = lazy(() => import('./FloorPlan3D.jsx'));
const NO_FURNITURE_LABEL =new Set(['plant','floorlamp','sidetable','barstool','beanbag']);

function initialState() {
  try { return { doc: loadDocument() || createDocument(), error: '' }; }
  catch (error) {
    const kept = preserveUnreadableDocument();
    return { doc: createDocument(), error: `無法載入已儲存的平面圖：${error.message}。${kept ? '原始資料已另存備份；' : '原始資料未能備份；'}自動儲存已暫停，按「儲存到此裝置」會覆寫並恢復自動儲存。` };
  }
}
export default function FloorPlanEditor() {
  const [initial] = useState(initialState);
  const [doc,setDoc] = useState(initial.doc);
  const latestDoc=useRef(doc);latestDoc.current=doc;
  const [selected,setSelected] = useState(null);
  const [selectedMeasurement,setSelectedMeasurement]=useState(null);
  const [selectedWall,setSelectedWall]=useState(null);
  const [selectedRoom,setSelectedRoom]=useState(null);
  const [selectionRequest,setSelectionRequest]=useState(0);
  function selectFurniture(id){if(id&&layers.locked.furniture)return;setSelectedRoom(null);setSelectedWall(null);setSelectedMeasurement(null);setSelected(id);if(id)setLayers(value=>({...value,furniture:true}));if(id)setSelectionRequest(value=>value+1);}
  const [view,setView] = useState('2d');
  const [tool,setTool] = useState('select');
  const [wallSnap,setWallSnap]=useState(()=>{try{return localStorage.getItem('open-plan:wall-snap:v1')!=='false';}catch{return true;}});
  useEffect(()=>{try{localStorage.setItem('open-plan:wall-snap:v1',String(wallSnap));}catch{/* Preferences are optional. */}},[wallSnap]);
  const [snapGuides,setSnapGuides]=useState([]);
  const [layers,setLayers]=useState(loadLayers);
  useEffect(()=>saveLayers(layers),[layers]);
  const labelsLocked=(layers.roomNames&&layers.locked.roomNames)||(layers.areas&&layers.locked.areas);
  function toggleLayerLock(key){
    const g=drag.current;
    if(g&&(key==='furniture'&&g.kind!=='room-label'||['roomNames','areas'].includes(key)&&g.kind==='room-label')){drag.current=null;setDoc(g.before);setSnapGuides([]);if(svg.current?.hasPointerCapture(g.pointerId))svg.current.releasePointerCapture(g.pointerId);}
    if(key==='dimensions')cancelMeasure();
    setLayers(value=>({...value,locked:{...value.locked,[key]:!value.locked[key]}}));
  }
  function toggleLayer(key){setLayers(value=>({...value,[key]:!value[key]}));}
  useEffect(()=>{if(selected&&(!layers.furniture||layers.locked.furniture))setSelected(null);},[layers,selected]);
  const [unit,setUnit] = useState(()=>{try{return localStorage.getItem('open-plan:display-unit:v1')==='cm'?'cm':'mm';}catch{return 'mm';}});
  useEffect(()=>{try{localStorage.setItem('open-plan:display-unit:v1',unit);}catch{/* Display preferences are optional. */}},[unit]);
  const measure=useRef(null),measureGesture=useRef(null);
  const [measurePreview,setMeasurePreview]=useState(null);
  const [measurementSnap,setMeasurementSnap]=useState(null);
  function cancelMeasure(){
    const gesture=measureGesture.current;
    measure.current=null;measureGesture.current=null;setMeasurePreview(null);setMeasurementSnap(null);
    if(gesture&&svg.current?.hasPointerCapture(gesture.pointerId))svg.current.releasePointerCapture(gesture.pointerId);
  }
  useEffect(()=>{cancelMeasure();},[tool,view]);
  function measurementPoint(e){const snapped=snapMeasurement(point(e),doc,ratio*25.4/96,measure.current?.a,e.shiftKey);setMeasurementSnap(snapped);return snapped;}
  function saveMeasurement(a,b){
    cancelMeasure();
    if(Math.hypot(b.x-a.x,b.y-a.y)<=20)return;
    commit({...doc,measurements:[...(doc.measurements||[]),{id:createId(),a:{x:a.x,y:a.y},b:{x:b.x,y:b.y}}]});
  }
  function startMeasure(e){
    if(layers.locked.dimensions||view!=='2d'||tool!=='measure'||spaceHeld.current||e.button!==0||!e.isPrimary)return;
    e.preventDefault();e.stopPropagation();
    const p=measurementPoint(e);
    if(measure.current){saveMeasurement(measure.current.a,p);return;}
    measure.current={a:p,b:p};setMeasurePreview(measure.current);
    measureGesture.current={pointerId:e.pointerId,x:e.clientX,y:e.clientY,moved:false};svg.current.setPointerCapture(e.pointerId);
  }
  function clearMeasurements(){if(layers.locked.dimensions)return;cancelMeasure();setSelectedMeasurement(null);if(doc.measurements?.length)commit({...doc,measurements:[]});}
  function deleteMeasurement(id){if(layers.locked.dimensions)return;if(id===selectedMeasurement)setSelectedMeasurement(null);commit({...doc,measurements:doc.measurements.filter(m=>m.id!==id)});}
  const pan = useRef(null);
  const spaceHeld=useRef(false);
  const [spacePan,setSpacePan]=useState(false);
  const [status,setStatus] = useState(initial.error || '準備就緒');
  const [history,setHistory] = useState({past:[],future:[]});
  const svg = useRef(null);
  const {viewport,setViewport,zoom,zoomAt,setRatio,fit,ratio,scaleBar}=usePlanViewport(svg,view,unit);
  const drag = useRef(null);
  const touchRoom=useRef(null);
  useTouchNavigation(svg,view,setViewport,()=>{
    touchRoom.current=null;cancelMeasure();
    const gesture=drag.current;
    if(gesture){drag.current=null;setDoc(gesture.before);setSnapGuides([]);}
    pan.current=null;
  });
  const wall=doc.walls.find(w=>w.id===selectedWall);
  function selectWall(id){setSelected(null);setSelectedRoom(null);setSelectedMeasurement(null);setSelectedWall(id);if(id)setSelectionRequest(value=>value+1);}
  function toggleDemolition(){if(wall&&canDemolish(wall))commit({...doc,walls:doc.walls.map(w=>w.id===wall.id?{...w,demolished:!w.demolished}:w)});}
  const room=doc.rooms.find(r=>r.id===selectedRoom);
  function selectRoom(id){setSelectedWall(null);setSelectedMeasurement(null);setSelected(null);setSelectedRoom(id);if(id)setSelectionRequest(value=>value+1);}
  function patchRoom(values){if(values.name&&layers.locked.roomNames)return;if(room)commit({...doc,rooms:doc.rooms.map(r=>r.id===room.id?{...r,...values}:r)});}
  function selectMeasurement(id){if(layers.locked.dimensions)return;setSelected(null);setSelectedRoom(null);setSelectedWall(null);setSelectedMeasurement(id);}
  useEffect(()=>{if(selectedMeasurement&&(!layers.dimensions||layers.locked.dimensions||view!=='2d'||!(doc.measurements||[]).some(m=>m.id===selectedMeasurement)))setSelectedMeasurement(null);},[selectedMeasurement,doc.measurements,layers.dimensions,layers.locked.dimensions,view]);
  const item = doc.furniture.find(f => f.id === selected);
  // Paused after a load error so the unreadable plan is not overwritten; a manual save resumes it.
  const autosave = useRef(!initial.error);
  useEffect(() => {
    if (!autosave.current) return;
    const timer = setTimeout(() => {
      try { saveDocument(doc); setStatus('已儲存到此裝置'); }
      catch (error) { setStatus(`Save failed: ${error.message}`); }
    },400);
    return () => clearTimeout(timer);
  },[doc]);
  function commit(next,before=doc) {
    setHistory(h => ({past:[...h.past.slice(-49),before],future:[]}));
    setDoc(next);latestDoc.current=next;
  }
  // A focused field commits on blur, which the browser fires after pointerdown. Blur it first so a drag starts from the edited document.
  function commitPendingEdit(){
    const field=document.activeElement;
    if(field instanceof HTMLElement&&field.matches('input,textarea,select')&&!svg.current?.contains(field))field.blur();
    return latestDoc.current;
  }
  function patch(values) { if(values.name&&layers.locked.furnitureLabels)return;if(item&&!layers.locked.furniture) commit({...doc,furniture:doc.furniture.map(f => f.id===item.id?{...f,...values}:f)}); }
  function moveFurniture(id,position) {
    if(layers.locked.furniture)return;
    const furniture=doc.furniture.find(f=>f.id===id);
    if(furniture && (furniture.cx!==position.cx || furniture.cy!==position.cy))
      commit({...doc,furniture:doc.furniture.map(f=>f.id===id?{...f,...position}:f)});
  }
  function undo() {
    cancelMeasure();
    if(!history.past.length)return;
    setDoc(history.past.at(-1)); setHistory({past:history.past.slice(0,-1),future:[doc,...history.future]});
  }
  function redo() {
    cancelMeasure();
    if(!history.future.length)return;
    setDoc(history.future[0]); setHistory({past:[...history.past,doc],future:history.future.slice(1)});
  }
  function point(e) {
    const p=new DOMPoint(e.clientX,e.clientY); return p.matrixTransform(svg.current.getScreenCTM().inverse());
  }
  function startDrag(e,f) {
    if(layers.locked.furniture||e.button!==0 || tool!=='select' || spaceHeld.current)return;
    e.stopPropagation();
    const before=commitPendingEdit(),current=before.furniture.find(x=>x.id===f.id)||f;
    if(e.pointerType!=='touch')selectFurniture(f.id);
    const p=point(e); drag.current={touch:e.pointerType==='touch',matrix:svg.current.getScreenCTM().inverse(),pointerId:e.pointerId,before,id:f.id,x:p.x,y:p.y,cx:current.cx,cy:current.cy};
    svg.current.setPointerCapture(e.pointerId);
  }
  function startLabelDrag(e,r){
    if(labelsLocked||e.button!==0||tool!=='select'||spaceHeld.current)return;
    e.stopPropagation();
    const before=commitPendingEdit(),current=before.rooms.find(x=>x.id===r.id)||r;
    if(e.pointerType!=='touch')selectRoom(r.id);
    const p=point(e);
    drag.current={kind:'room-label',touch:e.pointerType==='touch',matrix:svg.current.getScreenCTM().inverse(),pointerId:e.pointerId,before,id:r.id,x:p.x,y:p.y,cx:current.at[0],cy:current.at[1],sx:e.clientX,sy:e.clientY};
    svg.current.setPointerCapture(e.pointerId);
  }
  function move(e) {
    if(pan.current) {
      const g=pan.current,p=new DOMPoint(e.clientX,e.clientY).matrixTransform(g.matrix);
      setViewport({...g.before,x:g.before.x-(p.x-g.x),y:g.before.y-(p.y-g.y)}); return;
    }
    if(measure.current&&tool==='measure'){
      const gesture=measureGesture.current;
      if(gesture&&gesture.pointerId!==e.pointerId)return;
      if(gesture&&Math.hypot(e.clientX-gesture.x,e.clientY-gesture.y)>4)gesture.moved=true;
      measure.current={...measure.current,b:measurementPoint(e)};setMeasurePreview(measure.current);return;
    }
    if(tool==='measure'&&!spaceHeld.current){measurementPoint(e);return;}
    const g=drag.current; if(!g)return;
    const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(g.matrix);
    if(g.kind==='room-label'){
      if(!g.moved&&Math.hypot(e.clientX-g.sx,e.clientY-g.sy)<4)return;
      g.moved=true;
      const at=[Math.round((g.cx+p.x-g.x)/10)*10,Math.round((g.cy+p.y-g.y)/10)*10];
      setDoc({...g.before,rooms:g.before.rooms.map(r=>r.id===g.id?{...r,at}:r)});return;
    }
    const furniture=g.before.furniture.find(f=>f.id===g.id);
    const snapped=snapFurniture(furniture,g.cx+p.x-g.x,g.cy+p.y-g.y,g.before,10*Math.hypot(g.matrix.a,g.matrix.b),wallSnap&&!e.altKey,!e.altKey);
    setSnapGuides(snapped.guides);
    setDoc({...g.before,furniture:g.before.furniture.map(f=>f.id===g.id?{...f,cx:snapped.cx,cy:snapped.cy}:f)});
  }
  function finishDrag(e,cancel=false) {
    const measurement=measureGesture.current;
    if(measurement&&measurement.pointerId===e.pointerId){
      if(cancel){cancelMeasure();return;}
      const pending=measure.current;
      measureGesture.current=null;
      if(svg.current.hasPointerCapture(e.pointerId))svg.current.releasePointerCapture(e.pointerId);
      if(measurement.moved&&pending)saveMeasurement(pending.a,measurementPoint(e));
      return;
    }
    if(pan.current) {
      if(cancel)setViewport(pan.current.before);
      pan.current=null;
      if(svg.current.hasPointerCapture(e.pointerId))svg.current.releasePointerCapture(e.pointerId);
      return;
    }
    const g=drag.current;
    if(!g){const pending=touchRoom.current;touchRoom.current=null;if(pending?.pointerId===e.pointerId&&!cancel&&Math.hypot(e.clientX-pending.x,e.clientY-pending.y)<6){if(pending.kind==='wall')selectWall(pending.id);else selectRoom(pending.id);}return;}
    drag.current=null;setSnapGuides([]);
    if(svg.current.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId);
    if(cancel) setDoc(g.before);
    else {if(JSON.stringify(doc)!==JSON.stringify(g.before))commit(doc,g.before);if(g.touch){if(g.kind==='room-label')selectRoom(g.id);else selectFurniture(g.id);}}
  }
  function add(entry) {
    if(layers.locked.furniture)return;
    const [type,name,w,d,color]=entry;
    const f={id:createId(),type,name,w,d,color,cx:7600,cy:8500,rot:0};
    commit({...doc,furniture:[...doc.furniture,f]}); selectFurniture(f.id);
  }
  function startPan(e) {
    if(e.button===1 || (e.button===0 && (tool==='pan'||spaceHeld.current))) {
      e.preventDefault();const matrix=svg.current.getScreenCTM().inverse();
      const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix);
      pan.current={pointerId:e.pointerId,before:viewport,matrix,x:p.x,y:p.y};svg.current.setPointerCapture(e.pointerId);
    } else if(e.button===0){setSelected(null);setSelectedRoom(null);setSelectedWall(null);setSelectedMeasurement(null);}
  }
  useEffect(()=>{
    const element=svg.current;if(view!=='2d'||!element)return;
    const wheel=e=>{
      e.preventDefault();if(drag.current||pan.current||measureGesture.current)return;
      const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?element.clientHeight:1);
      zoomAt(Math.exp(-Math.max(-200,Math.min(200,delta))*.002),e.clientX,e.clientY);
    };
    element.addEventListener('wheel',wheel,{passive:false});
    return ()=>element.removeEventListener('wheel',wheel);
  },[view,zoomAt]);
  useEffect(()=>{
    const typing=target=>target instanceof Element&&!!target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]');
    // Space operates a focused control, so it pans only when focus is elsewhere (body or canvas).
    const spaceControl=target=>target instanceof Element&&!!target.closest('button,a[href],summary,[role="button"],[role="tab"],[role="checkbox"],[role="switch"],[role="radio"],[role="menuitem"],[role="option"],[role="separator"][tabindex]');
    const releaseSpace=()=>{spaceHeld.current=false;setSpacePan(false);};
    const cancelGesture=()=>{cancelMeasure();const gesture=drag.current||pan.current;if(gesture&&svg.current)finishDrag({pointerId:gesture.pointerId},true);};
    const down=e=>{
      if(e.defaultPrevented||e.isComposing||typing(e.target))return;
      if(e.code==='Space'&&view==='2d'&&!spaceControl(e.target)&&!e.metaKey&&!e.ctrlKey&&!e.altKey){e.preventDefault();spaceHeld.current=true;setSpacePan(true);return;}
      if(e.key==='Escape'){cancelGesture();releaseSpace();setSelected(null);setSelectedRoom(null);setSelectedWall(null);setSelectedMeasurement(null);return;}
      if(drag.current||pan.current||measureGesture.current)return;
      if(!e.metaKey&&!e.ctrlKey&&!e.altKey&&view==='2d'&&e.key.toLowerCase()==='m'){e.preventDefault();setTool('measure');return;}
      if((e.metaKey||e.ctrlKey)&&!e.altKey&&e.key.toLowerCase()==='z'){e.preventDefault();if(e.shiftKey)redo();else undo();return;}
      if(!e.metaKey&&!e.ctrlKey&&!e.altKey&&(e.key==='Delete'||e.key==='Backspace')&&(item||selectedMeasurement)){e.preventDefault();if(!e.repeat){if(selectedMeasurement)deleteMeasurement(selectedMeasurement);else removeSelected();}}
    };
    const up=e=>{if(e.code==='Space')releaseSpace();};
    const blur=()=>{releaseSpace();cancelGesture();};
    const visibility=()=>{if(document.hidden)blur();};
    window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);document.addEventListener('visibilitychange',visibility);
    return ()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility);};
  });
  useEffect(()=>{spaceHeld.current=false;setSpacePan(false);},[view]);
  function saveNow() {
    try {saveDocument(doc);setStatus(autosave.current?'已儲存到此裝置':'已儲存到此裝置，自動儲存已恢復');autosave.current=true;}catch(error){setStatus(`儲存失敗：${error.message}`);}
  }
  function rename(name) {if(name!==doc.name)commit({...doc,name});}
  function removeSelected() {if(item&&!layers.locked.furniture){commit({...doc,furniture:doc.furniture.filter(f=>f.id!==item.id)});setSelected(null);}}
  function duplicateSelected() {
    if(!item||layers.locked.furniture)return;
    const next={...item,id:createId(),cx:item.cx+200,cy:item.cy+200};
    commit({...doc,furniture:[...doc.furniture,next]});selectFurniture(next.id);
  }
  function exportPlan() {
    const url=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}));
    const a=document.createElement('a'); a.href=url; a.download='open-plan.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <WorkspaceShell unit={unit} onUnit={setUnit} doc={doc} status={tool==='measure'&&view==='2d'?'點選兩點或拖曳測量 · Shift 鎖定水平／垂直 · Esc 取消':status} view={view} onView={setView} tool={spacePan?'pan':tool} onTool={setTool}
    selected={selected} selectedRoom={room?.id} selectedWall={wall?.id} selectionRequest={selectionRequest} history={history} onSelect={selectFurniture} onRestore={snapshot=>commit(snapshot)}
    onRename={rename} onSave={saveNow} onExport={exportPlan} onUndo={undo} onRedo={redo}
    onRotate={()=>patch({rot:(item.rot+90)%360})} onDuplicate={duplicateSelected} onDelete={removeSelected}
    onZoom={zoom} onFit={fit} ratio={ratio} onRatio={setRatio} scaleBar={scaleBar}
    wallSnap={wallSnap} onToggleWallSnap={()=>setWallSnap(value=>!value)} layers={layers} onToggleLayer={toggleLayer} onToggleLayerLock={toggleLayerLock} onClearMeasurements={clearMeasurements} onDeleteMeasurement={deleteMeasurement} showDimensions={layers.dimensions} onToggleDimensions={()=>toggleLayer('dimensions')}
    library={<div className="library"><p>選擇家具加入圖面，再拖曳至所需位置。</p>{LIB.map(category=><details key={category.cat} open><summary>{category.cat}</summary><div className="catalog">{category.items.map((entry,i)=><button key={i} disabled={layers.locked.furniture} onClick={()=>add(entry)}><span>{entry[1]}</span><small>{formatLength(entry[2],unit)} × {formatLength(entry[3],unit)} {unit}</small></button>)}</div></details>)}</div>}
    costEstimate={<CostEstimate doc={doc} onChange={costEstimate=>commit({...doc,costEstimate})}/>} properties={wall?<WallProperties wall={wall} unit={unit} onToggle={toggleDemolition}/>:room?<RoomProperties nameLocked={layers.locked.roomNames} room={room} doc={doc} unit={unit} onPatch={patchRoom} onSelectFurniture={selectFurniture}/>:<div className="inspector">{item?<><h3>{item.name}</h3><FurnitureAppearance nameLocked={layers.locked.furnitureLabels} key={item.id} item={item} onPatch={patch}/>{[['cx','X'],['cy','Y'],['w','寬度'],['d','深度'],['rot','旋轉角度']].map(([key,label])=><label key={key}>{label}<div><input key={`${item.id}-${key}-${item[key]}-${unit}`} type="number" defaultValue={key==='rot'?item[key]:formatLength(item[key],unit)} min={key==='w'||key==='d'?10/unitFactor(unit):undefined} step={key==='rot'?1:10/unitFactor(unit)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)e.currentTarget.blur();}} onBlur={e=>{const shown=key==='rot'?String(item[key]):formatLength(item[key],unit),value=Number(e.target.value)*(key==='rot'?1:unitFactor(unit));if(e.target.value!==''&&Number(e.target.value)!==Number(shown)&&Number.isFinite(value)&&(!['w','d'].includes(key)||value>0)&&value!==item[key])patch({[key]:value});else e.target.value=shown;}}/><span>{key==='rot'?'°':unit}</span></div></label>)}<button onClick={()=>patch({rot:(item.rot+90)%360})}><RotateCw size={16}/>旋轉 90°</button><button onClick={()=>{commit({...doc,furniture:doc.furniture.filter(f=>f.id!==item.id)});setSelected(null);}}><Trash2 size={16}/>刪除家具</button></>:<p>選取家具或空間以查看及編輯屬性。</p>}<div className="note"><strong>編輯提示</strong><p>2D 與 3D 共用同一份平面圖。家具編輯會同步顯示。拖曳家具靠近牆面會吸附，按住 Alt / Option 暫停吸附。滾輪縮放、按住空白鍵拖曳平移；觸控以雙指縮放與平移；Esc 取消選取，Delete 刪除家具，⌘ / Ctrl + Z 復原，Shift + ⌘ / Ctrl + Z 重做。</p></div></div>}>
      {view==='3d'?<ErrorBoundary fallback={()=><div className="view-loading" role="alert"><div className="space-y-3 text-center"><p>無法載入 3D 檢視。平面圖資料未受影響；網路恢復後，請先儲存再重新整理頁面。</p><button type="button" className="rounded-lg border border-slate-300 px-3 py-1.5" onClick={()=>setView('2d')}>返回 2D</button></div></div>}><Suspense fallback={<div className="view-loading" role="status">載入 3D 檢視…</div>}><FloorPlan3D unit={unit} wallSnap={wallSnap} layers={layers} doc={doc} selected={selected} selectedRoom={room?.id} selectedWall={wall?.id} onSelectWall={selectWall} onSelectRoom={selectRoom} onSelect={selectFurniture} onMove={moveFurniture}/></Suspense></ErrorBoundary>:(
      <svg ref={svg} className={tool==='pan'||spacePan?'plan-svg pan-tool':tool==='measure'?'plan-svg measure-tool':'plan-svg'} viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`} aria-label="Apartment floor plan" onPointerDownCapture={startMeasure} onContextMenu={e=>{if(tool==='measure'){e.preventDefault();cancelMeasure();}}} onPointerDown={startPan} onPointerMove={move} onPointerLeave={()=>{if(!measureGesture.current)setMeasurementSnap(null);}} onPointerUp={e=>finishDrag(e)} onPointerCancel={e=>finishDrag(e,true)}>
        <defs><FloorPatterns/><pattern id="grid" width="500" height="500" patternUnits="userSpaceOnUse"><path d="M 500 0 L 0 0 0 500" fill="none" stroke="#dddcd5" strokeWidth="12"/></pattern></defs>
        <rect x="-20000" y="-20000" width="55000" height="55000" fill="url(#grid)"/>
        {doc.rooms.map(r=><polygon key={r.id} data-room-id={r.id} points={r.poly.map(p=>p.join(',')).join(' ')} fill={floorPatternFill(r.mat,doc.materials[r.mat]?.sw||'#eee')} onPointerDown={e=>{if(e.button===0&&tool==='select'&&!spaceHeld.current){e.stopPropagation();if(e.pointerType==='touch'){touchRoom.current={id:r.id,pointerId:e.pointerId,x:e.clientX,y:e.clientY};svg.current.setPointerCapture(e.pointerId);}else selectRoom(r.id);}}}/>)}
        {room&&<polygon className="selected-room-outline" points={room.poly.map(p=>p.join(',')).join(' ')} fill="#0d9488" fillOpacity=".08" stroke="#0d9488" strokeWidth="2" strokeDasharray="8 5" vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
        {(layers.furniture?[...doc.furniture]:[]).sort((a,b)=>(a.type==='rug'?0:1)-(b.type==='rug'?0:1)).map(f=><g key={f.id} transform={`translate(${f.cx} ${f.cy}) rotate(${f.rot})`} onPointerDown={e=>startDrag(e,f)} className="furniture">
          <title>{f.name} · {formatLength(f.w,unit)} × {formatLength(f.d,unit)} {unit}</title>
          <rect x={-f.w/2} y={-f.d/2} width={f.w} height={f.d} fill="transparent" stroke="none" pointerEvents="all"/>
          <FurnitureSymbol type={f.type} width={f.w} depth={f.d} color={f.color}/>

          {selected===f.id && <rect className="selected-furniture-outline" x={-f.w/2-24} y={-f.d/2-24} width={f.w+48} height={f.d+48} rx="40" fill="none" stroke="#2563eb" strokeWidth="2" vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
        </g>)}
        {layers.furnitureLabels&&<g className="furniture-labels" pointerEvents="none">{doc.furniture.filter(f=>Math.min(f.w,f.d)>=380&&!NO_FURNITURE_LABEL.has(f.type)).map(f=><text key={f.id} x={f.cx} y={f.cy} fontSize={Math.max(80,Math.min(170,Math.min(f.w,f.d)*.2))} textAnchor="middle" dominantBaseline="central" fill="#4a443c" opacity=".8">{f.name}</text>)}</g>}
        {doc.walls.map(w=><rect key={w.id} data-wall-id={w.id} className={wall?.id===w.id?'selected-wall-outline':undefined} x={w.rect[0]} y={w.rect[1]} width={w.rect[2]-w.rect[0]} height={w.rect[3]-w.rect[1]} fill={w.demolished?'#ef4444':w.type==='b'?'#000000':w.type==='low'?'#e9e3d8':w.type==='e'?'#8f897d':'#a7a195'} fillOpacity={w.demolished?0.12:1} stroke={wall?.id===w.id?'#f59e0b':w.demolished?'#ef4444':w.type==='low'?'#8f897d':'none'} strokeWidth={wall?.id===w.id?3:1.2} strokeDasharray={w.demolished?'5 3':undefined} vectorEffect="non-scaling-stroke" onPointerDown={e=>{if(e.button===0&&tool==='select'&&!spaceHeld.current){e.stopPropagation();if(e.pointerType==='touch'){touchRoom.current={kind:'wall',id:w.id,pointerId:e.pointerId,x:e.clientX,y:e.clientY};svg.current.setPointerCapture(e.pointerId);}else selectWall(w.id);}}}/>)}

        <OpeningSymbols openings={doc.openings}/>
        <SnapGuides guides={snapGuides} unit={unit} ratio={ratio}/>
        <Measurements selectedId={selectedMeasurement} onSelect={selectMeasurement} selectable={tool==='select'&&!spacePan&&!layers.locked.dimensions} measurements={layers.dimensions?doc.measurements:[]} preview={measurePreview} snapPoint={measurementSnap} unit={unit} ratio={ratio}/>
        {layers.dimensions&&<DimensionLines chains={doc.dimensions} unit={unit}/>}
        {doc.rooms.filter(r=>r.at).map(r=>{
          const area=roomArea(r.poly);
          const halo={stroke:'#fbf9f4',strokeWidth:45,paintOrder:'stroke',strokeLinejoin:'round'};
          const interactive=tool==='select'&&!spacePan&&!labelsLocked;
          const labelWidth=Math.max(layers.roomNames?r.name.length*250:0,layers.areas?750:0)+100;
          return <g key={r.id} className="room-label-2d" data-room-label-id={r.id} pointerEvents={interactive?'all':'none'} style={{cursor:interactive?'move':undefined}} onPointerDown={e=>startLabelDrag(e,r)}>
            {(layers.roomNames||layers.areas)&&<rect x={r.at[0]-labelWidth/2} y={r.at[1]-(layers.roomNames?260:180)} width={labelWidth} height={layers.roomNames&&layers.areas?560:300} rx="45" fill="transparent" stroke={room?.id===r.id?'#0d9488':'none'} strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"/>}
            {layers.roomNames&&<text x={r.at[0]} y={r.at[1]} textAnchor="middle" fontSize="250" fontWeight="600" fill="#2b2824" {...halo}>{r.name}</text>}
            {layers.areas&&<text x={r.at[0]} y={r.at[1]+(layers.roomNames?260:0)} textAnchor="middle" fontSize="175" fill="#7d7366" {...halo}>{area.toFixed(1)} m²</text>}
          </g>;
        })}
      </svg>)}
  </WorkspaceShell>;
}
