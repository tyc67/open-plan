import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { createEmptyPlan, createId, createSamplePlan, fitBounds, planGeometry, roomArea, validatePlan } from 'open-plan-core';
import { RotateCw, Trash2 } from 'lucide-react';
import WorkspaceShell from '../workspace/WorkspaceShell.jsx';
import { backupBeforeReplace, loadDocument, preserveUnreadableDocument, replacedDocument, saveDocument, sessionDocument } from './storage.js';
import { readImportFile } from './planFile.js';
import { createFileSync } from './fileSession.js';
import { issueMessage } from './issueMessages.js';
import { AGENT_PROMPT } from './agentPrompt.js';
import { LIB } from './furnitureLibrary.js';
import CostEstimate from './CostEstimate.jsx';
import SnapGuides from './SnapGuides.jsx';
import WallProperties, { AddWallPanel } from './WallProperties.jsx';
import EditNotice from './EditNotice.jsx';
import { newWallThickness, runEdit, snapWallPoint, wallEnd } from './planEdit.js';
import { editMessages, editNoteLines } from './issueMessages.js';
import FurnitureAppearance from './FurnitureAppearance.jsx';
import FloorPatterns, { RoomPatterns, roomFloorFill } from './FloorPatterns.jsx';
import FurnitureSymbol from './FurnitureSymbol.jsx';
import OpeningSymbols from './OpeningSymbols.jsx';
import { snapFurniture } from './wallSnapping.js';
import { loadLayers, saveLayers } from './layers.js';
import Measurements, { snapMeasurement } from './Measurements.jsx';
import RoomProperties from './RoomProperties.jsx';
import MeasurementProperties from './MeasurementProperties.jsx';
import { SCALE_LABEL, labelChange, scalePreview } from './planScale.js';
import DimensionLines from './DimensionLines.jsx';
import { formatLength, unitFactor } from './units.js';
import useTouchNavigation from './useTouchNavigation.js';
import usePlanViewport from './usePlanViewport.js';
// The browser keeps a failed chunk import for the page's lifetime, so recovery needs a page reload.
const FloorPlan3D = lazy(() => import('./FloorPlan3D.jsx'));
const NO_FURNITURE_LABEL =new Set(['plant','floorlamp','sidetable','barstool','beanbag']);

// A saved plan with tolerable issues opens with a notice; the issues are listed in the plan panel.
const warningNotice=(count,prefix)=>({tone:'warning',text:`${prefix}這個平面圖有 ${count} 個需要注意的地方，可以照常編輯；清單在「平面圖設定」。`,actions:[]});
function initialState(fileSession) {
  // File mode (roadmap C3): the plan comes from the file. A file that cannot be read yet opens an empty plan, and writes
  // wait until the file is valid again.
  if (fileSession) {
    const { state } = fileSession;
    return { doc: state.valid ? state.plan : createEmptyPlan(), error: '', loadErrors: [], notice: state.valid && state.warnings.length ? warningNotice(state.warnings.length, '') : null };
  }
  try {
    const loaded = loadDocument();
    // A new user starts with an empty plan; the canvas then offers Import and Load sample apartment (roadmap B3).
    if (!loaded) return { doc: createEmptyPlan(), error: '', loadErrors: [], notice: null };
    return { doc: loaded.plan, error: '', loadErrors: [], notice: loaded.warnings.length ? warningNotice(loaded.warnings.length, '') : null };
  }
  catch (error) {
    const kept = preserveUnreadableDocument();
    return { doc: createEmptyPlan(), loadErrors: error.issues || [], notice: null,
      error: `無法載入已儲存的平面圖：${error.message}。${kept ? '原始資料已另存備份；' : '原始資料未能備份；'}自動儲存已暫停，按「儲存到此裝置」會覆寫並恢復自動儲存。` };
  }
}
export default function FloorPlanEditor({ fileSession = null }) {
  const [initial] = useState(() => initialState(fileSession));
  const [doc,setDoc] = useState(initial.doc);
  const latestDoc=useRef(doc);latestDoc.current=doc;
  const [selected,setSelected] = useState(null);
  const [selectedMeasurement,setSelectedMeasurement]=useState(null);
  // An open scaling (roadmap D3): it counts as busy for the file, and each swap of the open plan closes it.
  const scalingOpen=useRef(false);
  const [scaleSession,setScaleSession]=useState(0);
  const [propertiesShown,setPropertiesShown]=useState(false);
  // The result of the last edit through the core commands (roadmap D4): the reasons of a refusal, or what the edit also
  // did. It stays until the next edit, until the user closes it, or until the open plan is swapped.
  const [editNotice,setEditNotice]=useState(null);
  // The add-wall tool: the first point, and the pointer position as the second one.
  const wallDraft=useRef(null),wallGesture=useRef(null);
  const [wallPreview,setWallPreview]=useState(null);
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
    cancelWall();
  }
  // Drops the first point of the add-wall tool and a tap in progress.
  function cancelWall(){
    const tap=wallGesture.current;
    wallDraft.current=null;wallGesture.current=null;setWallPreview(null);
    if(tap&&svg.current?.hasPointerCapture(tap.pointerId))svg.current.releasePointerCapture(tap.pointerId);
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
  const fitArea=fitBounds(doc);
  // Each replacement or restore counts as a new load, so the view fits the plan and the 3D frame is set again, also
  // when the new plan has the same id (an exported plan imported again, or a second restore).
  const [planLoads,setPlanLoads]=useState(0);
  const planKey=`${doc.id}:${planLoads}`;
  const {viewport,setViewport,zoom,zoomAt,setRatio,fit,ratio,scaleBar}=usePlanViewport(svg,view,unit,fitArea,planKey);
  // The grid covers the fit area plus 3 times its larger side (at least 20 m) on each side, for zooming out and panning.
  const gridPad=Math.max(20000,3*Math.max(fitArea[2]-fitArea[0],fitArea[3]-fitArea[1]));
  const gridArea=[Math.floor((fitArea[0]-gridPad)/500)*500,Math.floor((fitArea[1]-gridPad)/500)*500,Math.ceil((fitArea[2]+gridPad)/500)*500,Math.ceil((fitArea[3]+gridPad)/500)*500];
  const drag = useRef(null);
  const touchRoom=useRef(null);
  useTouchNavigation(svg,view,setViewport,()=>{
    touchRoom.current=null;cancelMeasure();
    const gesture=drag.current;
    if(gesture){drag.current=null;setDoc(gesture.before);setSnapGuides([]);}
    pan.current=null;
  });
  const wall=doc.walls.find(w=>w.id===selectedWall);
  function wallDown(e,id){if(e.button===0&&tool==='select'&&!spaceHeld.current){e.stopPropagation();if(e.pointerType==='touch'){touchRoom.current={kind:'wall',id,pointerId:e.pointerId,x:e.clientX,y:e.clientY};svg.current.setPointerCapture(e.pointerId);}else selectWall(id);}}
  function selectWall(id){setSelected(null);setSelectedRoom(null);setSelectedMeasurement(null);setSelectedWall(id);if(id)setSelectionRequest(value=>value+1);}
  const room=doc.rooms.find(r=>r.id===selectedRoom);
  function selectRoom(id){setSelectedWall(null);setSelectedMeasurement(null);setSelected(null);setSelectedRoom(id);if(id)setSelectionRequest(value=>value+1);}
  function patchRoom(values){if(values.name&&layers.locked.roomNames)return;if(room)commit({...doc,rooms:doc.rooms.map(r=>r.id===room.id?{...r,...values}:r)});}
  function selectMeasurement(id){if(layers.locked.dimensions)return;setSelected(null);setSelectedRoom(null);setSelectedWall(null);setSelectedMeasurement(id);if(id)setSelectionRequest(value=>value+1);}
  useEffect(()=>{if(selectedMeasurement&&(!layers.dimensions||layers.locked.dimensions||view!=='2d'||!(doc.measurements||[]).some(m=>m.id===selectedMeasurement)))setSelectedMeasurement(null);},[selectedMeasurement,doc.measurements,layers.dimensions,layers.locked.dimensions,view]);
  const item = doc.furniture.find(f => f.id === selected);
  // Paused after a load error so the unreadable plan is not overwritten; a manual save resumes it.
  const autosave = useRef(!initial.error);
  useEffect(() => {
    if (!autosave.current) return;
    const timer = setTimeout(() => {
      // File mode writes through the file session, which writes only when the plan differs from the file.
      if (fileSync.current) { fileSync.current.save(); return; }
      try { saveDocument(doc); setStatus('已儲存到此裝置'); setCanRestoreSession(!!sessionDocument()); }
      catch (error) { setStatus(`儲存失敗：${error.message}`); }
    },400);
    return () => clearTimeout(timer);
  },[doc]);
  // ---- File mode (roadmap C3b) ----
  const fileSync=useRef(null);
  const [fileView,setFileView]=useState(()=>fileSession&&!fileSession.state.valid?{status:'invalid',state:fileSession.state}:{status:'ok'});
  const editorForFile=useRef(null);
  editorForFile.current={
    latest:()=>latestDoc.current,
    // A gesture, a 3D drag, a focused field or an open scaling: an external version would interrupt it, so it is a
    // conflict instead.
    busy:()=>!!(scalingOpen.current||wallDraft.current||wallGesture.current||drag.current||pan.current||measureGesture.current||view3d.current?.isDragging?.()||(document.activeElement instanceof HTMLElement&&document.activeElement.matches('input,textarea,select'))),
    settle:()=>settleEditor(),
    // A file version replaces the open plan without an undo step, and the undo history starts again.
    load:plan=>{swapPlanGeneration();cancelMeasure();setSnapGuides([]);setDoc(plan);latestDoc.current=plan;setHistory({past:[],future:[]});},
  };
  useEffect(()=>{
    if(!fileSession)return;
    const sync=createFileSync(fileSession,{latest:()=>editorForFile.current.latest(),busy:()=>editorForFile.current.busy(),settle:()=>editorForFile.current.settle(),load:plan=>editorForFile.current.load(plan)},next=>{
      setFileView(next);
      if(next.status==='ok'&&next.loaded)setStatus(next.backup?'已載入檔案版本；你的版本已備份到檔案旁的備份資料夾':'已載入檔案的新版本');
      else if(next.status==='ok'&&next.saved)setStatus(next.kept?'已保留你的版本；檔案原本的版本已備份':'已儲存到檔案');
      else if(next.status==='saving')setStatus('正在儲存到檔案…');
    });
    fileSync.current=sync;
    // Unsaved edits that are not in the file yet: the browser asks before the page is closed.
    const beforeUnload=e=>{if(sync.unsaved()){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',beforeUnload);
    return ()=>{window.removeEventListener('beforeunload',beforeUnload);sync.stop();fileSync.current=null;};
  },[]);
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
  // A 3D drag gets the plan generation when it starts. If the open plan was swapped during the drag (replace, restore,
  // undo, redo), the move is dropped: the 3D view can release the pointer before it renders the new plan, and the plan
  // can have the same ID (a second restore) and the same item IDs (the sample).
  const planGeneration=useRef(0),view3d=useRef(null);
  function swapPlanGeneration(){planGeneration.current++;view3d.current?.cancelDrag();setScaleSession(n=>n+1);setEditNotice(null);cancelWall();}
  function moveFurniture(id,position,token) {
    if(layers.locked.furniture||token!==undefined&&token!==planGeneration.current)return;
    const furniture=doc.furniture.find(f=>f.id===id);
    if(furniture && (furniture.cx!==position.cx || furniture.cy!==position.cy))
      commit({...doc,furniture:doc.furniture.map(f=>f.id===id?{...f,...position}:f)});
  }
  function undo() {
    cancelMeasure();swapPlanGeneration();
    if(!history.past.length)return;
    setDoc(history.past.at(-1)); setHistory({past:history.past.slice(0,-1),future:[doc,...history.future]});
  }
  function redo() {
    cancelMeasure();swapPlanGeneration();
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
    if(tool==='wall'){if(wallDraft.current){wallDraft.current={...wallDraft.current,b:wallPoint(e)};setWallPreview(wallDraft.current);}return;}
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
    const tap=wallGesture.current;
    if(tap&&tap.pointerId===e.pointerId){
      if(cancel){cancelWall();return;}
      wallGesture.current=null;
      if(svg.current.hasPointerCapture(e.pointerId))svg.current.releasePointerCapture(e.pointerId);
      if(Math.hypot(e.clientX-tap.x,e.clientY-tap.y)<6)placeWallPoint(e);
      return;
    }
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
    if(fileSync.current){fileSync.current.save();return;}
    try {saveDocument(doc);setStatus(autosave.current?'已儲存到此裝置':'已儲存到此裝置，自動儲存已恢復');autosave.current=true;setCanRestoreSession(!!sessionDocument());}catch(error){setStatus(`儲存失敗：${error.message}`);}
  }
  function rename(name) {if(name!==doc.name)commit({...doc,name});}
  // An edit through the core commands (roadmap D4), on the newest plan: one undo step with its label, or no change
  // and the reasons in the panel. The notes and warnings of the commands stay visible after the edit.
  function applyEdit(commands,label) {
    const current=commitPendingEdit(),result=runEdit(current,commands);
    if(result.status==='refused'){setEditNotice({tone:'error',lines:editMessages(result.errors)});setStatus('沒有變更：這個操作不符合平面圖規則');return result;}
    if(result.status==='same'){setEditNotice(null);return result;}
    commit(labelChange(result.plan,label,current),current);
    const also=editNoteLines(result);
    setEditNotice(also.lines.length?{tone:'info',...also}:null);setStatus(`已${label}`);
    return result;
  }
  function addWall(a,b,type='n') {
    const result=applyEdit([{op:'add_wall',type,a,b,thickness:newWallThickness(latestDoc.current,a)}],'新增牆');
    // A wall from the panel also ends a first point from the drawing: the next point starts a new wall.
    if(result.status==='ok')cancelWall();
    return result;
  }
  const wallPoint=e=>{const p=point(e);return snapWallPoint([p.x,p.y],latestDoc.current,8*ratio*25.4/96,wallDraft.current?.a);};
  // A point of the add-wall tool is a tap: it is placed at pointer up, so a second finger (pinch) or a cancelled
  // pointer drops it, and nothing is added during a two-finger gesture.
  function startWall(e) {
    if(view!=='2d'||tool!=='wall'||spaceHeld.current||e.button!==0||!e.isPrimary)return;
    e.preventDefault();e.stopPropagation();
    wallGesture.current={pointerId:e.pointerId,x:e.clientX,y:e.clientY};
    // The capture keeps the pointer up on the drawing. A pointer that is already gone cannot be captured; the tap still works.
    try{svg.current.setPointerCapture(e.pointerId);}catch{/* no active pointer */}
  }
  function placeWallPoint(e) {
    const draft=wallDraft.current,p=wallPoint(e);
    if(!draft){commitPendingEdit();wallDraft.current={a:p,b:p,generation:planGeneration.current};setWallPreview(wallDraft.current);return;}
    // The open plan was swapped after the first point: the wall is dropped.
    if(draft.generation===planGeneration.current&&(p[0]!==draft.a[0]||p[1]!==draft.a[1]))addWall(draft.a,p);
    cancelWall();
  }
  // Scales the newest plan from a measurement and the typed real distance, through the core command. The preview that
  // the panel showed is not used: the plan can be newer. One undo step; in file mode the file is backed up first.
  function applyScale(id,distance) {
    if(layers.locked.dimensions)return {status:'missing'};
    const current=latestDoc.current,result=scalePreview(current,id,distance);
    if(result.status!=='ok')return result;
    cancelMeasure();setSnapGuides([]);
    fileSync.current?.checkpoint();
    commit(labelChange(result.plan,SCALE_LABEL,current),current);setPlanLoads(n=>n+1);
    setStatus(`已調整平面圖比例（×${result.factor.toFixed(4)}）`);
    return result;
  }
  function removeSelected() {if(item&&!layers.locked.furniture){commit({...doc,furniture:doc.furniture.filter(f=>f.id!==item.id)});setSelected(null);}}
  function duplicateSelected() {
    if(!item||layers.locked.furniture)return;
    const next={...item,id:createId(),cx:item.cx+200,cy:item.cy+200};
    commit({...doc,furniture:[...doc.furniture,next]});selectFurniture(next.id);
  }
  function downloadPlan(plan) {
    const url=URL.createObjectURL(new Blob([JSON.stringify(plan,null,2)],{type:'application/json'}));
    const a=document.createElement('a'); a.href=url; a.download='open-plan.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function exportPlan() {downloadPlan(latestDoc.current);}
  // Commits a focused field and ends every gesture, then returns the latest plan. A furniture or label drag is
  // cancelled, so the plan is the one from before the drag: the drag was not committed yet.
  function settleEditor() {
    swapPlanGeneration();
    let current=commitPendingEdit();
    cancelMeasure();setSnapGuides([]);touchRoom.current=null;
    for(const gesture of [drag.current,pan.current])if(gesture&&svg.current?.hasPointerCapture(gesture.pointerId))svg.current.releasePointerCapture(gesture.pointerId);
    if(drag.current){current=drag.current.before;setDoc(current);latestDoc.current=current;}
    drag.current=null;pan.current=null;
    return current;
  }
  function clearSelection(){setSelected(null);setSelectedRoom(null);setSelectedWall(null);setSelectedMeasurement(null);}
  // Replaces the open plan (new empty plan, sample, later import). The current plan is backed up first; if that fails,
  // nothing changes. The replacement is one undo step, and "restore" brings the backup back until the next replacement.
  async function replacePlan(next,message) {
    const current=settleEditor();
    // File mode keeps the browser plan on the server (`-replaced`); website mode keeps it in this browser.
    try {if(fileSync.current)await fileSync.current.backupBeforeReplace(current);else backupBeforeReplace(current);}
    catch(error) {
      setReplaceNotice({tone:'error',text:`無法備份目前的平面圖（${error.message}），所以沒有取代。可先下載目前的平面圖。`,actions:[['下載目前平面圖',()=>downloadPlan(current)]]});
      return;
    }
    // The backup holds the plan from before the wait; a later edit would be replaced without a backup.
    if(latestDoc.current!==current){setReplaceNotice({tone:'error',text:'等待備份時又有新的修改，所以沒有取代。請再試一次。',actions:[]});return;}
    clearSelection();commit(next,current);setCanRestore(true);setPlanLoads(n=>n+1);
    setReplaceNotice({tone:'info',text:message,actions:[['復原上一個平面圖',restorePrevious]]});
  }
  async function restorePrevious() {
    const current=settleEditor(),previous=fileSync.current?await fileSync.current.replacedPlan():replacedDocument();
    if(latestDoc.current!==current){setReplaceNotice({tone:'error',text:'讀取備份時又有新的修改，所以沒有復原。請再試一次。',actions:[]});return;}
    if(!previous){setCanRestore(false);setReplaceNotice({tone:'error',text:'找不到上一個平面圖的備份，或備份已損壞。',actions:[]});return;}
    clearSelection();commit(previous.plan,current);setPlanLoads(n=>n+1);
    const count=previous.warnings.length;
    setReplaceNotice({tone:count?'warning':'info',text:`已復原上一個平面圖。這一步也可以用「復原」取消。${count?`這個平面圖有 ${count} 個需要注意的地方，清單在「平面圖設定」。`:''}`,actions:[['復原上一個平面圖',restorePrevious]]});
  }
  const [canRestore,setCanRestore]=useState(()=>fileSession?fileSession.hasReplaced:!!replacedDocument());
  const [replaceNotice,setReplaceNotice]=useState(initial.notice);
  // Website mode: the session snapshot (the saved plan from before the first change of a page load). It is a
  // replacement like any other, so the open plan is backed up first and 復原上一個平面圖 brings it back.
  const [canRestoreSession,setCanRestoreSession]=useState(()=>!fileSession&&!!sessionDocument());
  function restoreSession() {
    const snapshot=sessionDocument();
    if(!snapshot){setCanRestoreSession(false);setReplaceNotice({tone:'error',text:'找不到開始編輯前的平面圖，或它已損壞。',actions:[]});return;}
    replacePlan(snapshot.plan,'已復原開始編輯前的平面圖。目前的平面圖已備份。');
  }
  // Tolerable issues of the open plan, checked again after each change, so the list is never out of date.
  const planWarnings=useMemo(()=>validatePlan(doc,'saved').warnings,[doc]);
  // Import (roadmap B3): read and check the file, show the summary or the errors, and replace only after confirmation.
  const IMPORT_MAX_BYTES=20*1024*1024;
  const [importState,setImportState]=useState(null);
  // Each import request gets a number. A file read finishes later, so only the newest request may show its result;
  // cancel and confirm also end every pending read. Without this, a slow first file replaces the preview of a second.
  const importRequest=useRef(0);
  async function importFile(file) {
    if(!file)return;
    const request=++importRequest.current;
    const show=result=>{if(request===importRequest.current)setImportState({fileName:file.name,result});};
    const failed=code=>show({ok:false,errors:[{path:'$',code,params:{}}],report:[]});
    if(file.size>IMPORT_MAX_BYTES){failed('file-too-large');return;}
    let text;
    try {text=await file.text();} catch {failed('file-unreadable');return;}
    show(readImportFile(text));
  }
  function closeImport() {importRequest.current++;setImportState(null);}
  function confirmImport() {
    const pending=importState;closeImport();
    if(pending?.result.ok)replacePlan(pending.result.plan,`已匯入「${pending.fileName}」。上一個平面圖已備份。`);
  }
  // The file-mode state that needs the user: a conflict, an unreadable file, a lost connection or a failed write. It
  // cannot be dismissed, and it takes the place of the replacement notice while it lasts.
  const download=()=>downloadPlan(latestDoc.current);
  const fileNotice=!fileSession?null
    :fileView.status==='conflict'?{tone:'warning',kind:'conflict',text:`檔案已在外部變更。${fileView.refreshed?'檔案又變更了一次，以下動作會用最新的版本。':''}${fileView.failed?`剛才的動作沒有完成（${fileView.failed}）。`:''}「載入檔案版本」會先把你的版本備份到檔案旁的備份資料夾；「保留我的版本」會先備份檔案的版本。`,actions:[['載入檔案版本',()=>fileSync.current?.loadFile()],['保留我的版本',()=>fileSync.current?.keepMine()]]}
    :fileView.status==='invalid'?{tone:'error',kind:'invalid',text:`檔案目前無法讀取（${issueMessage(fileView.state.errors[0])}${fileView.state.errors.length>1?`，共 ${fileView.state.errors.length} 個問題`:''}）。瀏覽器保留最後一個有效的平面圖，暫停寫入檔案；檔案修正後會再讀取。`,actions:[['下載目前平面圖',download]]}
    :fileView.status==='disconnected'?{tone:'error',kind:'disconnected',text:'與本機檔案的連線中斷。瀏覽器保留目前的平面圖，暫停寫入檔案，正在重新連線。',actions:[['下載目前平面圖',download]]}
    :fileView.status==='error'?{tone:'error',kind:'error',text:`無法寫入檔案（${fileView.message??fileView.code}）。瀏覽器保留目前的平面圖。`,actions:[['重試',()=>fileSync.current?.retry()],['下載目前平面圖',download]]}
    :null;
  const planActions={
    onImportFile:importFile,importState,onConfirmImport:confirmImport,onCancelImport:closeImport,
    agentPrompt:AGENT_PROMPT,isEmpty:!doc.walls.length&&!doc.rooms.length&&!doc.furniture.length,
    onNewPlan:()=>replacePlan(createEmptyPlan(),'已建立新的空白平面圖。上一個平面圖已備份。'),
    onLoadSample:()=>replacePlan(createSamplePlan(),'已載入範例公寓。上一個平面圖已備份。'),
    onRestorePrevious:restorePrevious,canRestore,
    notice:fileNotice??replaceNotice,onDismissNotice:()=>setReplaceNotice(null),
    warnings:planWarnings,loadErrors:initial.loadErrors,
    storage:fileSession
      ?{kind:'file',label:`本機檔案模式 · ${fileSession.path}`,saveLabel:'儲存到檔案',help:`專案保存在你電腦上的檔案（${fileSession.path}）。每個瀏覽器工作階段第一次寫入前，以及每次取代或載入檔案版本前，舊的版本會存到檔案旁的備份資料夾。要換到網站版時，先匯出 JSON，再匯入。`}
      :{kind:'website',label:'網站模式 · 儲存在此瀏覽器',saveLabel:'儲存到此裝置',help:'專案保存在這個瀏覽器內。要換電腦時，先匯出 JSON，再在另一台電腦匯入。多專案管理尚未加入。'},
    onRestoreSession:fileSession?null:restoreSession,canRestoreSession,
  };
  return <WorkspaceShell planActions={planActions} unit={unit} onUnit={setUnit} doc={doc} status={tool==='measure'&&view==='2d'?'點選兩點或拖曳測量 · Shift 鎖定水平／垂直 · Esc 取消':tool==='wall'&&view==='2d'?(editNotice?.tone==='error'?status:wallPreview?'點選終點 · Esc 取消':'點選起點和終點來新增牆，或在「物件屬性」輸入數值 · Esc 取消'):status} view={view} onView={setView} tool={spacePan?'pan':tool} onTool={setTool}
    selected={selected} selectedRoom={room?.id} selectedWall={wall?.id} selectedMeasurement={selectedMeasurement} onPropertiesShown={setPropertiesShown} selectionRequest={selectionRequest} history={history} onSelect={selectFurniture} onRestore={snapshot=>{swapPlanGeneration();commit(snapshot);}}
    onRename={rename} onSave={saveNow} onExport={exportPlan} onUndo={undo} onRedo={redo}
    onRotate={()=>patch({rot:(item.rot+90)%360})} onDuplicate={duplicateSelected} onDelete={removeSelected}
    onZoom={zoom} onFit={fit} ratio={ratio} onRatio={setRatio} scaleBar={scaleBar}
    wallSnap={wallSnap} onToggleWallSnap={()=>setWallSnap(value=>!value)} layers={layers} onToggleLayer={toggleLayer} onToggleLayerLock={toggleLayerLock} onClearMeasurements={clearMeasurements} onDeleteMeasurement={deleteMeasurement} showDimensions={layers.dimensions} onToggleDimensions={()=>toggleLayer('dimensions')}
    library={<div className="library"><p>選擇家具加入圖面，再拖曳至所需位置。</p>{LIB.map(category=><details key={category.cat} open><summary>{category.cat}</summary><div className="catalog">{category.items.map((entry,i)=><button key={i} disabled={layers.locked.furniture} onClick={()=>add(entry)}><span>{entry[1]}</span><small>{formatLength(entry[2],unit)} × {formatLength(entry[3],unit)} {unit}</small></button>)}</div></details>)}</div>}
    costEstimate={<CostEstimate doc={doc} onChange={costEstimate=>commit({...doc,costEstimate})}/>} properties={<><EditNotice notice={editNotice} rooms={doc.rooms} onSelectRoom={selectRoom} onClose={()=>setEditNotice(null)}/>{tool==='wall'&&view==='2d'?<AddWallPanel key={unit} unit={unit} start={wallPreview?.a} onAdd={(from,direction,length,type)=>addWall(from,wallEnd(from,direction,length),type)}/>:wall?<WallProperties wall={wall} doc={doc} unit={unit} onEdit={applyEdit} onDeleted={()=>setSelectedWall(null)}/>:room?<RoomProperties nameLocked={layers.locked.roomNames} room={room} doc={doc} unit={unit} onPatch={patchRoom} onSelectFurniture={selectFurniture}/>:selectedMeasurement&&!item?<MeasurementProperties key={`${selectedMeasurement}-${scaleSession}`} doc={doc} measurementId={selectedMeasurement} unit={unit} shown={propertiesShown} onApply={distance=>applyScale(selectedMeasurement,distance)} onDelete={()=>deleteMeasurement(selectedMeasurement)} onSession={open=>{scalingOpen.current=open;}}/>:<div className="inspector">{item?<><h3>{item.name}</h3><FurnitureAppearance nameLocked={layers.locked.furnitureLabels} key={item.id} item={item} onPatch={patch}/>{[['cx','X'],['cy','Y'],['w','寬度'],['d','深度'],['rot','旋轉角度']].map(([key,label])=><label key={key}>{label}<div><input key={`${item.id}-${key}-${item[key]}-${unit}`} type="number" defaultValue={key==='rot'?item[key]:formatLength(item[key],unit)} min={key==='w'||key==='d'?10/unitFactor(unit):undefined} step={key==='rot'?1:10/unitFactor(unit)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)e.currentTarget.blur();}} onBlur={e=>{const shown=key==='rot'?String(item[key]):formatLength(item[key],unit),value=Number(e.target.value)*(key==='rot'?1:unitFactor(unit));if(e.target.value!==''&&Number(e.target.value)!==Number(shown)&&Number.isFinite(value)&&(!['w','d'].includes(key)||value>0)&&value!==item[key])patch({[key]:value});else e.target.value=shown;}}/><span>{key==='rot'?'°':unit}</span></div></label>)}<button onClick={()=>patch({rot:(item.rot+90)%360})}><RotateCw size={16}/>旋轉 90°</button><button onClick={()=>{commit({...doc,furniture:doc.furniture.filter(f=>f.id!==item.id)});setSelected(null);}}><Trash2 size={16}/>刪除家具</button></>:<p>選取家具或空間以查看及編輯屬性。</p>}<div className="note"><strong>編輯提示</strong><p>2D 與 3D 共用同一份平面圖。家具編輯會同步顯示。拖曳家具靠近牆面會吸附，按住 Alt / Option 暫停吸附。滾輪縮放、按住空白鍵拖曳平移；觸控以雙指縮放與平移；Esc 取消選取，Delete 刪除家具，⌘ / Ctrl + Z 復原，Shift + ⌘ / Ctrl + Z 重做。</p></div></div>}</>}>
      {view==='3d'?<ErrorBoundary fallback={()=><div className="view-loading" role="alert"><div className="space-y-3 text-center"><p>無法載入 3D 檢視。平面圖資料未受影響；網路恢復後，請先儲存再重新整理頁面。</p><button type="button" className="rounded-lg border border-slate-300 px-3 py-1.5" onClick={()=>setView('2d')}>返回 2D</button></div></div>}><Suspense fallback={<div className="view-loading" role="status">載入 3D 檢視…</div>}><FloorPlan3D unit={unit} wallSnap={wallSnap} layers={layers} doc={doc} selected={selected} selectedRoom={room?.id} selectedWall={wall?.id} onSelectWall={selectWall} onSelectRoom={selectRoom} onSelect={selectFurniture} onMove={moveFurniture} dragToken={()=>planGeneration.current} controlRef={view3d} frameKey={planKey}/></Suspense></ErrorBoundary>:(
      <svg ref={svg} className={tool==='pan'||spacePan?'plan-svg pan-tool':tool==='measure'?'plan-svg measure-tool':'plan-svg'} viewBox={`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`} aria-label="Apartment floor plan" onPointerDownCapture={e=>{startMeasure(e);startWall(e);}} onContextMenu={e=>{if(tool==='measure'){e.preventDefault();cancelMeasure();}}} onPointerDown={startPan} onPointerMove={move} onPointerLeave={()=>{if(!measureGesture.current)setMeasurementSnap(null);}} onPointerUp={e=>finishDrag(e)} onPointerCancel={e=>finishDrag(e,true)}>
        <defs><FloorPatterns/><RoomPatterns rooms={doc.rooms}/><pattern id="grid" width="500" height="500" patternUnits="userSpaceOnUse"><path d="M 500 0 L 0 0 0 500" fill="none" stroke="#dddcd5" strokeWidth="12"/></pattern></defs>
        <rect x={gridArea[0]} y={gridArea[1]} width={gridArea[2]-gridArea[0]} height={gridArea[3]-gridArea[1]} fill="url(#grid)"/>
        {doc.rooms.map((r,ri)=><polygon key={r.id} data-room-id={r.id} points={r.poly.map(p=>p.join(',')).join(' ')} fill={roomFloorFill(r,ri,doc.materials[r.mat]?.sw||'#eee')} onPointerDown={e=>{if(e.button===0&&tool==='select'&&!spaceHeld.current){e.stopPropagation();if(e.pointerType==='touch'){touchRoom.current={id:r.id,pointerId:e.pointerId,x:e.clientX,y:e.clientY};svg.current.setPointerCapture(e.pointerId);}else selectRoom(r.id);}}}/>)}
        {room&&<polygon className="selected-room-outline" points={room.poly.map(p=>p.join(',')).join(' ')} fill="#0d9488" fillOpacity=".08" stroke="#0d9488" strokeWidth="2" strokeDasharray="8 5" vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
        {(layers.furniture?[...doc.furniture]:[]).sort((a,b)=>(a.type==='rug'?0:1)-(b.type==='rug'?0:1)).map(f=><g key={f.id} transform={`translate(${f.cx} ${f.cy}) rotate(${f.rot})`} onPointerDown={e=>startDrag(e,f)} data-furniture-id={f.id} className="furniture">
          <title>{f.name} · {formatLength(f.w,unit)} × {formatLength(f.d,unit)} {unit}</title>
          <rect x={-f.w/2} y={-f.d/2} width={f.w} height={f.d} fill="transparent" stroke="none" pointerEvents="all"/>
          <FurnitureSymbol type={f.type} width={f.w} depth={f.d} color={f.color}/>

          {selected===f.id && <rect className="selected-furniture-outline" x={-f.w/2-24} y={-f.d/2-24} width={f.w+48} height={f.d+48} rx="40" fill="none" stroke="#2563eb" strokeWidth="2" vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
        </g>)}
        {layers.furnitureLabels&&<g className="furniture-labels" pointerEvents="none">{doc.furniture.filter(f=>Math.min(f.w,f.d)>=380&&!NO_FURNITURE_LABEL.has(f.type)).map(f=><text key={f.id} x={f.cx} y={f.cy} fontSize={Math.max(80,Math.min(170,Math.min(f.w,f.d)*.2))} textAnchor="middle" dominantBaseline="central" fill="#4a443c" opacity=".8">{f.name}</text>)}</g>}
        {/* Each wall has a hit area on its centre line, so a wall that openings fill completely can be selected. */}
        {doc.walls.map(w=><line key={w.id} data-wall-line={w.id} x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} stroke={wall?.id===w.id?'#f59e0b':'transparent'} strokeOpacity=".35" strokeWidth={w.thickness} pointerEvents="stroke" onPointerDown={e=>wallDown(e,w.id)}/>)}
        {planGeometry(doc).solids.map((w,i)=><rect key={`${w.wallId}:${i}`} data-wall-id={w.wallId} className={wall?.id===w.wallId?'selected-wall-outline':undefined} x={w.rect[0]} y={w.rect[1]} width={w.rect[2]-w.rect[0]} height={w.rect[3]-w.rect[1]} fill={w.demolished?'#ef4444':w.type==='b'?'#000000':w.type==='low'?'#e9e3d8':w.type==='e'?'#8f897d':'#a7a195'} fillOpacity={w.demolished?0.12:1} stroke={wall?.id===w.wallId?'#f59e0b':w.demolished?'#ef4444':w.type==='low'?'#8f897d':'none'} strokeWidth={wall?.id===w.wallId?3:1.2} strokeDasharray={w.demolished?'5 3':undefined} vectorEffect="non-scaling-stroke" onPointerDown={e=>wallDown(e,w.wallId)}/>)}

        <OpeningSymbols openings={planGeometry(doc).openings}/>
        {wall&&view==='2d'&&<g className="selected-wall-ends" pointerEvents="none">{[['a',wall.a],['b',wall.b]].map(([key,p])=><g key={key} data-wall-end-mark={key}><circle cx={p[0]} cy={p[1]} r={9*ratio*25.4/96} fill="#f59e0b" stroke="#fff" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/><text x={p[0]} y={p[1]} fontSize={12*ratio*25.4/96} fontWeight="700" textAnchor="middle" dominantBaseline="central" fill="#fff">{key}</text></g>)}</g>}
        {wallPreview&&<line data-wall-preview x1={wallPreview.a[0]} y1={wallPreview.a[1]} x2={wallPreview.b[0]} y2={wallPreview.b[1]} stroke="#2563eb" strokeOpacity=".45" strokeWidth={newWallThickness(doc,wallPreview.a)} pointerEvents="none"/>}
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
