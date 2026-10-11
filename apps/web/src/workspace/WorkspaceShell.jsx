import { useEffect, useRef, useState } from 'react';
import { Box, Calculator, PenLine, ChevronDown, Copy, Download, FilePlus2, FileUp, Undo, X, Building2, Eye, EyeOff, FolderOpen, Grid2X2, Hand, History, Home, Layers3, LockKeyhole, UnlockKeyhole, Maximize2, Minimize2, Moon, MoreHorizontal, MousePointer2, PanelLeftClose, PanelRightClose, Pencil, Redo2, RotateCw, Ruler, ScanLine, Save, Settings, SlidersHorizontal, Sofa, Sun, SwatchBook, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import CostDock from './CostDock.jsx';
import PanelRail from './PanelRail.jsx';
import WorkspacePanel from './WorkspacePanel.jsx';
import ScrollToolbar from './ScrollToolbar.jsx';
import ToolbarHints from './ToolbarHints.jsx';
import { formatLength } from '../floorplan/units.js';
import { issueMessages } from '../floorplan/issueMessages.js';
import FurnitureSymbol from '../floorplan/FurnitureSymbol.jsx';
import { AgentPromptCard, DropOverlay, EmptyPlanActions, ImportDialog, useFileDrop } from './PlanImport.jsx';
import { changeLabel } from '../floorplan/planScale.js';

const LEFT_TABS = [['furniture',Sofa,'家具庫'],['plan',Grid2X2,'平面圖設定'],['materials',SwatchBook,'地板材質'],['system',Settings,'工作區設定']];
const RIGHT_TABS = [['objects',Layers3,'圖層與物件'],['properties',SlidersHorizontal,'物件屬性'],['history',History,'歷史紀錄']];
const UI_KEY='open-plan:workspace:v1';
const iconButton='grid size-9 shrink-0 place-items-center rounded-lg text-[#536b92] hover:bg-[#eef3ff] disabled:opacity-30 dark:text-[#b4c3d8] dark:hover:bg-[#263b6a]';
const panelButton='inline-flex items-center justify-center gap-2 rounded-lg border border-[#dce4ef] bg-white px-3 py-2 text-xs font-bold text-[#536b92] hover:bg-slate-50 disabled:opacity-40 dark:border-[#3a4c67] dark:bg-[#17253b] dark:text-slate-200 dark:hover:bg-[#263b6a]';
// Header controls match Mamezu's 36 px actions; square controls have no text padding.
const headerButton='inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#dce4ef] bg-white px-3 text-xs font-bold text-[#5c6d86] hover:bg-[#eef3ff] dark:border-[#3a4c67] dark:bg-[#17253b] dark:text-[#e9eff9] dark:hover:bg-[#263b6a] [&>svg]:shrink-0';
const headerIconButton='grid size-9 shrink-0 place-items-center rounded-lg border border-[#dce4ef] bg-white p-0 text-[#5c6d86] hover:bg-[#eef3ff] dark:border-[#3a4c67] dark:bg-[#17253b] dark:text-[#e9eff9] dark:hover:bg-[#263b6a]';
const canvasButton=iconButton.replace('size-9','size-9 max-sm:size-7');
// Both panels and rails take 748 px, so below this width only one side panel is open at a time.
const BOTH_PANELS_MIN_WIDTH=1280;
const singlePanel=()=>window.innerWidth<BOTH_PANELS_MIN_WIDTH;
function initialWorkspace() {
  const defaults={leftOpen:window.innerWidth>=768,rightOpen:!singlePanel(),leftTab:'furniture',rightTab:'properties',theme:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'};
  try {
    const saved=JSON.parse(localStorage.getItem(UI_KEY));
    if(!saved)return defaults;
    const leftOpen=window.innerWidth>=768 && typeof saved.leftOpen==='boolean'?saved.leftOpen:defaults.leftOpen;
    const rightOpen=window.innerWidth>=768 && typeof saved.rightOpen==='boolean'?saved.rightOpen:defaults.rightOpen;
    return {...defaults,leftOpen,rightOpen:rightOpen&&!(leftOpen&&singlePanel()),leftTab:LEFT_TABS.some(t=>t[0]===saved.leftTab)?saved.leftTab:defaults.leftTab,rightTab:RIGHT_TABS.some(t=>t[0]===saved.rightTab)?saved.rightTab:defaults.rightTab,theme:['dark','light'].includes(saved.theme)?saved.theme:defaults.theme};
  } catch {return defaults;}
}
function area(poly) {return Math.abs(poly.reduce((sum,[x,y],i)=>{const [nx,ny]=poly[(i+1)%poly.length];return sum+x*ny-nx*y;},0))/2e6;}
function describeChange(before,after) {
  const label=changeLabel(before,after);if(label)return label;
  if(before.id!==after.id)return '取代平面圖';
  if(JSON.stringify(before.costEstimate)!==JSON.stringify(after.costEstimate))return '更新費用估算';
  for(const wall of after.walls){const old=before.walls.find(w=>w.id===wall.id);if(old&&!!old.demolished!==!!wall.demolished)return wall.demolished?'標記拆除牆體':'恢復牆體';}
  if((before.measurements?.length||0)!==(after.measurements?.length||0))return (after.measurements?.length||0)>(before.measurements?.length||0)?'新增測量':'刪除測量';
  for(const room of after.rooms){const old=before.rooms.find(r=>r.id===room.id);if(old&&old.name!==room.name)return '重新命名空間';if(old&&JSON.stringify(old.at)!==JSON.stringify(room.at))return `移動 ${room.name} 標籤`;if(old&&old.mat!==room.mat)return `變更 ${room.name} 地板材質`;}
  if(before.name!==after.name)return '重新命名專案';
  if(before.furniture.length<after.furniture.length)return '新增家具';
  if(before.furniture.length>after.furniture.length)return '刪除家具';
  const oldById=new Map(before.furniture.map(f=>[f.id,f]));
  for(const f of after.furniture) {
    const old=oldById.get(f.id);if(!old)continue;
    if(old.cx!==f.cx || old.cy!==f.cy)return `移動 ${f.name}`;
    if(old.name!==f.name)return `重新命名 ${f.name}`;
    if(old.color!==f.color)return `變更 ${f.name} 顏色`;
    if(old.rot!==f.rot)return `旋轉 ${f.name}`;
    if(old.w!==f.w || old.d!==f.d)return `調整 ${f.name} 尺寸`;
  }
  return '編輯平面圖';
}
export default function WorkspaceShell({planActions,unit='mm',onUnit,doc,status,view,onView,tool,onTool,library,properties,costEstimate,selected,selectedRoom,selectedWall,selectedMeasurement,onPropertiesShown,selectionRequest,history,onSelect,onRestore,onRename,onSave,onExport,onUndo,onRedo,onRotate,onDuplicate,onDelete,onZoom,onFit,ratio,onRatio,scaleBar,wallSnap,onToggleWallSnap,layers,onToggleLayer,onToggleLayerLock,onClearMeasurements,onDeleteMeasurement,showDimensions,onToggleDimensions,children}) {
  const root=useRef(null);
  // Import (roadmap B3): the header, the plan panel and the empty plan open the same file input; a file dropped
  // anywhere on the workspace is imported the same way.
  const fileInput=useRef(null);
  const openImport=()=>fileInput.current?.click();
  const dropping=useFileDrop(root,planActions.onImportFile);
  // While the import dialog is open, everything behind it is inert: no focus, no clicks, no keyboard actions.
  const modal=!!planActions.importState;
  const [workspace,setWorkspace]=useState(initialWorkspace);
  const [costOpen,setCostOpen]=useState(false);
  const [name,setName]=useState(doc.name);
  const [fullscreen,setFullscreen]=useState(false);
  const [notice,setNotice]=useState('');
  // A notice is temporary: it must not hide later status such as save failures.
  useEffect(()=>setNotice(''),[status]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),4000);return ()=>clearTimeout(timer);},[notice]);
  const [narrow,setNarrow]=useState(window.innerWidth<768);
  const [single,setSingle]=useState(singlePanel);
  useEffect(()=>setName(doc.name),[doc.name]);
  useEffect(()=>{try{localStorage.setItem(UI_KEY,JSON.stringify(workspace));}catch{/* Preferences are optional. */}},[workspace]);
  useEffect(()=>{
    const media=matchMedia('(max-width: 767px)');
    const change=()=>{setNarrow(media.matches);if(media.matches)setWorkspace(w=>({...w,leftOpen:false,rightOpen:false}));};
    media.addEventListener('change',change);
    const pairMedia=matchMedia(`(max-width: ${BOTH_PANELS_MIN_WIDTH-1}px)`);
    const changePair=()=>{setSingle(pairMedia.matches);if(pairMedia.matches)setWorkspace(w=>w.leftOpen&&w.rightOpen?{...w,leftOpen:false}:w);};
    pairMedia.addEventListener('change',changePair);
    const onFullscreen=()=>setFullscreen(document.fullscreenElement===root.current);
    const escape=e=>{if(e.key==='Escape' && media.matches)setWorkspace(w=>({...w,leftOpen:false,rightOpen:false}));};
    document.addEventListener('fullscreenchange',onFullscreen);window.addEventListener('keydown',escape);
    return ()=>{media.removeEventListener('change',change);pairMedia.removeEventListener('change',changePair);document.removeEventListener('fullscreenchange',onFullscreen);window.removeEventListener('keydown',escape);};
  },[]);
  function openLeft(tab){setWorkspace(w=>({...w,leftOpen:true,leftTab:tab,...(single?{rightOpen:false}:{})}));}
  function openRight(tab){setWorkspace(w=>({...w,rightOpen:true,rightTab:tab,...(single?{leftOpen:false}:{})}));}
  const closeLeft=()=>setWorkspace(w=>({...w,leftOpen:false}));
  const closeRight=()=>setWorkspace(w=>({...w,rightOpen:false}));
  const toggleTheme=()=>setWorkspace(w=>({...w,theme:w.theme==='dark'?'light':'dark'}));
  async function toggleFullscreen(){
    try {if(document.fullscreenElement===root.current)await document.exitFullscreen();else await root.current.requestFullscreen();}
    catch {setNotice('瀏覽器目前無法開啟全螢幕。');}
  }
  function finishName(){const next=name.trim()||'未命名平面圖';setName(next);onRename(next);}
  const current=doc.furniture.find(f=>f.id===selected);
  // The add-wall tool has its form in the properties panel. Only this tool opens the panel: Space (pan) and M (measure)
  // also change the tool, and must not open a panel that the user closed.
  const openForTool=tool==='wall';
  useEffect(()=>{
    if(!(selected||selectedRoom||selectedWall||selectedMeasurement))return;
    // On a phone the panel is an overlay over the canvas; in 3D it would block the drag that follows a tap-to-select.
    if(window.innerWidth<768&&view==='3d')return;
    // At tablet width, keep the furniture library open: adding an item selects it, and closing the library would interrupt adding more.
    setWorkspace(w=>window.innerWidth>=768&&singlePanel()&&w.leftOpen&&w.leftTab==='furniture'?w:{...w,rightOpen:true,rightTab:'properties',...(singlePanel()?{leftOpen:false}:{})});
  },[selected,selectedRoom,selectedWall,selectedMeasurement,selectionRequest]);
  useEffect(()=>{if(openForTool)setWorkspace(w=>({...w,rightOpen:true,rightTab:'properties',...(singlePanel()?{leftOpen:false}:{})}));},[openForTool]);
  // The properties panel stays mounted when it is hidden; the editor must know when the user can see it.
  const propertiesShown=workspace.rightOpen&&workspace.rightTab==='properties';
  useEffect(()=>{onPropertiesShown?.(propertiesShown);},[propertiesShown]);
  const toolbarActions=[['復原',Undo2,onUndo,!history.past.length],['重做',Redo2,onRedo,!history.future.length]];
  const counts=`${doc.rooms.length} 個空間 · ${doc.furniture.length} 件家具`;
  return <div ref={root} className={'workspace-root relative flex h-dvh min-h-0 w-full flex-col overflow-clip bg-[#f4f7fb] font-sans text-[#1b2840] antialiased dark:bg-[#101827] dark:text-[#e9eff9] '+(workspace.theme==='dark'?'dark':'')}>
    <header inert={modal} className="z-30 flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-[#e5ebf3] bg-white px-4 py-2 dark:border-[#2e3d56] dark:bg-[#18243a] max-md:flex-nowrap max-md:gap-1 max-md:px-2">
      <button type="button" className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg px-1.5 text-sm font-extrabold" onClick={()=>openLeft('plan')} aria-label="Open Plan 專案設定"><span className="grid size-8 place-items-center rounded-lg bg-[#4d72e1] text-white"><Home className="size-5"/></span><span className="whitespace-nowrap tracking-tight max-lg:hidden">Open Plan</span></button>
      <span className="text-xs text-slate-500 max-lg:hidden dark:text-slate-400">繁體中文</span>
      <div className="flex h-9 min-w-0 flex-1 items-center rounded-lg border border-[#dce4ef] bg-white md:max-w-sm dark:border-[#3a4c67] dark:bg-[#17253b]" role="group" aria-label="專案">
        <label className="relative h-full min-w-0 flex-1"><input className="h-full w-full min-w-0 rounded-l-lg bg-transparent pl-3 pr-7 text-sm font-bold outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500" value={name} maxLength={80} onChange={e=>setName(e.target.value)} onBlur={finishName} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)e.currentTarget.blur();}} aria-label="平面圖名稱"/><Pencil className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400"/></label>
        <button type="button" className="flex h-full shrink-0 items-center gap-1 rounded-r-lg border-l border-[#dce4ef] px-2 text-slate-500 hover:bg-slate-100 dark:border-[#3a4c67] dark:text-slate-300 dark:hover:bg-slate-700" onClick={()=>openLeft('plan')} aria-label="專案資訊"><FolderOpen className="size-4"/><ChevronDown className="size-3"/></button>
      </div>
      <nav className="ml-auto flex shrink-0 items-center gap-2 max-md:gap-1" aria-label="主要工具">
        <button type="button" className={headerButton+' max-md:w-9 max-md:border-0 max-md:p-0'} onClick={onSave} aria-label={planActions.storage.saveLabel}><Save className="size-4"/><span className="max-md:hidden">{planActions.storage.kind==='file'?'儲存':'本機儲存'}</span></button>
        <button type="button" className={headerIconButton+' max-md:hidden'} onClick={toggleFullscreen} aria-label={fullscreen?'退出全螢幕':'全螢幕'}>{fullscreen?<Minimize2 className="size-4"/>:<Maximize2 className="size-4"/>}</button>
        <button type="button" className={headerIconButton+' max-md:hidden'} onClick={toggleTheme} aria-label={workspace.theme==='dark'?'切換為淺色模式':'切換為深色模式'}>{workspace.theme==='dark'?<Sun className="size-4"/>:<Moon className="size-4"/>}</button>
        <button type="button" className={headerButton+' max-md:w-9 max-md:border-0 max-md:p-0'} onClick={openImport} aria-label="匯入平面圖"><FileUp className="size-4"/><span className="max-md:hidden">匯入</span></button>
        <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" data-import-input onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)planActions.onImportFile(file);}}/>
        <button type="button" className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[#4d72e1] px-3 text-xs font-bold text-white hover:bg-[#355dce] max-md:w-9 max-md:px-0 [&>svg]:shrink-0" onClick={onExport} aria-label="匯出 JSON"><Download className="size-4"/><span className="max-md:hidden">匯出 JSON</span></button>
      </nav>
    </header>
    <main inert={modal} className="relative flex min-h-0 flex-1" aria-label="平面圖設計工作區">
      <PanelRail side="left" tabs={LEFT_TABS} open={workspace.leftOpen} tab={workspace.leftTab} onSelect={openLeft} onClose={closeLeft}/>
      {narrow&&(workspace.leftOpen||workspace.rightOpen)&&<button type="button" className="absolute inset-y-0 inset-x-11 z-30 bg-slate-900/20" aria-label="關閉側邊面板" onClick={()=>{closeLeft();closeRight();}}/>}
      <div inert={!workspace.leftOpen} aria-hidden={!workspace.leftOpen} className={'z-40 min-h-0 shrink-0 overflow-hidden transition-[width,transform] duration-200 ease-out motion-reduce:transition-none max-md:absolute max-md:inset-y-0 max-md:left-11 max-md:w-[calc(100%_-_88px)] '+(workspace.leftOpen?'w-[340px] translate-x-0':'w-0 max-md:-translate-x-full')}>
        <aside id="settings-sidebar" className="flex h-full min-h-0 w-[340px] flex-col overflow-hidden border-r border-[#e5ebf3] bg-white dark:border-[#2e3d56] dark:bg-[#18243a] max-md:w-full max-md:border-r-0" aria-label="設計設定">
          <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700"><h2 className="flex-1 text-sm font-bold">{LEFT_TABS.find(t=>t[0]===workspace.leftTab)?.[2]}</h2><button type="button" className={iconButton+' size-8'} onClick={closeLeft} aria-label="收合設定面板"><PanelLeftClose className="size-4"/></button></div>
          <WorkspacePanel id="furniture" active={workspace.leftTab==='furniture'}>{library}</WorkspacePanel>
          <WorkspacePanel id="plan" active={workspace.leftTab==='plan'}><div className="space-y-4"><div className="workspace-card"><h3>目前專案</h3><p className="mt-2 font-bold">{doc.name}</p><p className="mt-1 text-xs text-slate-500">{counts}</p></div><div className="workspace-card"><h3>圖面資訊</h3><label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={wallSnap} onChange={onToggleWallSnap}/>家具貼牆吸附</label><dl className="mt-3 grid grid-cols-2 gap-y-2 text-xs"><dt>座標單位</dt><dd>{unit==='cm'?'公分（cm）':'毫米（mm）'}</dd><dt>牆體</dt><dd>{doc.walls.length} 段</dd><dt>門窗</dt><dd>{doc.openings.length} 個</dd><dt>空間總面積</dt><dd>{doc.rooms.filter(r=>r.counted!==false).reduce((sum,r)=>sum+area(r.poly),0).toFixed(1)} m²</dd></dl></div><div className="workspace-card"><div className="flex items-center justify-between gap-2"><h3>測量線 · {doc.measurements?.length||0}</h3><button type="button" className={panelButton} disabled={!doc.measurements?.length||layers.locked.dimensions} onClick={onClearMeasurements}>清除全部</button></div><div className="mt-2 space-y-1">{(doc.measurements||[]).map((m,i)=><div key={m.id??i} className="flex items-center justify-between gap-2 text-xs"><span>{i+1}. {formatLength(Math.hypot(m.b.x-m.a.x,m.b.y-m.a.y),unit)} {unit}</span><button type="button" className={iconButton} disabled={layers.locked.dimensions} aria-label={`刪除測量 ${i+1}`} onClick={()=>onDeleteMeasurement(m.id)}><Trash2 className="size-4"/></button></div>)}</div></div>{planActions.loadErrors.length>0&&<div className="workspace-card" data-load-errors><h3>無法載入的資料 · {planActions.loadErrors.length}</h3><p className="workspace-help mt-1">原本儲存的平面圖有以下問題，所以沒有開啟。可把這些訊息貼給 AI 助理修正。</p><ul className="mt-2 space-y-1 text-xs text-red-700 dark:text-red-300">{issueMessages(planActions.loadErrors).map((line,i)=><li key={i}>{line}</li>)}</ul></div>}{planActions.warnings.length>0&&<div className="workspace-card" data-plan-warnings><h3>需要注意 · {planActions.warnings.length}</h3><p className="workspace-help mt-1">平面圖可以照常顯示與編輯；匯入時這些會被視為錯誤。</p><ul className="mt-2 space-y-1 text-xs text-amber-800 dark:text-amber-200">{issueMessages(planActions.warnings).map((line,i)=><li key={i}>{line}</li>)}</ul></div>}<div className="workspace-card"><h3>平面圖</h3><p className="workspace-help mt-1">取代前，目前的平面圖會先備份；可用「復原上一個平面圖」或「復原」取回。</p><div className="mt-3 grid gap-2"><button type="button" className={panelButton+' w-full'} onClick={openImport}><FileUp className="size-4"/>匯入平面圖（JSON）</button><button type="button" className={panelButton+' w-full'} onClick={planActions.onNewPlan}><FilePlus2 className="size-4"/>新增空白平面圖</button><button type="button" className={panelButton+' w-full'} onClick={planActions.onLoadSample}><Building2 className="size-4"/>載入範例公寓</button><button type="button" className={panelButton+' w-full'} disabled={!planActions.canRestore} onClick={planActions.onRestorePrevious}><Undo className="size-4"/>復原上一個平面圖</button>{planActions.onRestoreSession&&<button type="button" className={panelButton+' w-full'} disabled={!planActions.canRestoreSession} onClick={planActions.onRestoreSession} title="回到最近一次開啟並修改之前所儲存的平面圖"><History className="size-4"/>復原開始編輯前的平面圖</button>}</div></div><AgentPromptCard agentPrompt={planActions.agentPrompt} mode={planActions.storage.kind}/><p className="workspace-help" data-storage-help>{planActions.storage.help}</p><button type="button" className={panelButton+' w-full'} onClick={onSave}><Save className="size-4"/>{planActions.storage.saveLabel}</button></div></WorkspacePanel>
          <WorkspacePanel id="materials" active={workspace.leftTab==='materials'}><p className="workspace-help mb-4">目前各空間使用的地板材質與面積。</p><div className="space-y-2">{Object.entries(doc.materials).map(([id,material])=>{const rooms=doc.rooms.filter(r=>r.mat===id);return <div key={id} className="workspace-card flex items-center gap-3"><span className="size-9 shrink-0 rounded-lg border border-slate-200" style={{background:material.sw}}/><div className="flex-1"><h3>{material.name}</h3><p className="workspace-help mt-1">{rooms.length} 個空間 · {rooms.reduce((sum,r)=>sum+area(r.poly),0).toFixed(1)} m²</p></div></div>;})}</div></WorkspacePanel>
          <WorkspacePanel id="system" active={workspace.leftTab==='system'}><div className="space-y-3"><h3 className="text-sm font-bold">工作區外觀</h3><button type="button" className={panelButton+' w-full'} onClick={toggleTheme}>{workspace.theme==='dark'?<Sun className="size-4"/>:<Moon className="size-4"/>}{workspace.theme==='dark'?'切換為淺色模式':'切換為深色模式'}</button><button type="button" className={panelButton+' w-full'} onClick={toggleFullscreen}><Maximize2 className="size-4"/>{fullscreen?'退出全螢幕':'全螢幕'}</button><p className="workspace-help">側邊面板與外觀偏好會記錄在此裝置。畫面寬度小於 1280 px 時一次顯示一個面板。</p></div></WorkspacePanel>
        </aside>
      </div>
      <section className="workspace-canvas relative min-h-0 min-w-0 flex-1 overflow-hidden" aria-label="畫布工作區">
        <div className="canvas-content absolute inset-0">{children}</div>
        {planActions.isEmpty&&<EmptyPlanActions onImport={openImport} onLoadSample={planActions.onLoadSample} agentPrompt={planActions.agentPrompt}/>}
        <ScrollToolbar className="absolute left-3 top-3 z-20 max-w-[calc(100%_-_24px)] rounded-xl border border-[#d8e2ee] bg-white/95 p-1.5 shadow-sm dark:border-[#3b4d68] dark:bg-[#18243a]/95 max-sm:max-w-[calc(100%_-_76px)]" role="toolbar" aria-label="畫布工具">
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label="畫布檢視模式">{[['2d',Grid2X2,'2D 平面圖'],['3d',Box,'3D 檢視']].map(([id,Icon,label])=><button key={id} type="button" className={canvasButton+(view===id?' bg-[#4d72e1] !text-white':'')} aria-label={label} aria-pressed={view===id} onClick={()=>onView(id)}><Icon className="size-4"/></button>)}</div>
          <span className="mx-1 h-5 border-l border-[#d8e2ee] dark:border-[#3b4d68]"/>
          {view==='2d'&&[['select',MousePointer2,'選取物件'],['pan',Hand,'瀏覽畫布'],['measure',ScanLine,'測量距離（M）'],['wall',PenLine,'新增牆']].map(([id,Icon,label])=><button type="button" key={id} className={canvasButton+(tool===id?' bg-[#4d72e1] !text-white':'')} aria-label={label} aria-pressed={tool===id} onClick={()=>onTool(id)}><Icon className="size-4"/></button>)}
          <button type="button" className={canvasButton} onClick={()=>openLeft('furniture')} aria-label="加入家具"><Sofa className="size-4"/></button>
          {view==='2d'&&<button type="button" className={canvasButton+(showDimensions?' bg-blue-50 text-blue-600 dark:bg-[#263b6a] dark:text-blue-200':'')} aria-label="顯示尺寸" aria-pressed={showDimensions} onClick={onToggleDimensions}><Ruler className="size-4"/></button>}
          <span className="mx-1 h-5 border-l border-[#d8e2ee] dark:border-[#3b4d68]"/>
          {toolbarActions.map(([label,Icon,action,disabled])=><button type="button" key={label} className={canvasButton} onClick={action} disabled={disabled} aria-label={label}><Icon className="size-4"/></button>)}
          {view==='2d'&&<>
            <span className="mx-1 h-5 border-l border-[#d8e2ee] dark:border-[#3b4d68]"/>
            <div data-canvas-view-controls role="group" aria-label="畫布縮放" className="flex shrink-0 items-center gap-1">
              <button type="button" className={canvasButton} onClick={()=>onZoom(.8)} aria-label="縮小"><ZoomOut className="size-4"/></button>
              <button type="button" className={canvasButton} onClick={()=>onZoom(1.25)} aria-label="放大"><ZoomIn className="size-4"/></button>
              <button type="button" className={canvasButton} onClick={onFit} aria-label="顯示整張平面圖"><Maximize2 className="size-4"/></button>
            </div>
          </>}
          {current&&<div className="flex items-center max-sm:hidden">
            <span className="mx-1 h-5 border-l border-[#d8e2ee] dark:border-[#3b4d68]"/>
            {[[RotateCw,'旋轉 90 度',onRotate],[Copy,'複製家具',onDuplicate],[Trash2,'刪除家具',onDelete]].map(([Icon,label,action])=><button key={label} type="button" className={canvasButton} onClick={action} aria-label={label}><Icon className="size-4"/></button>)}
            <button type="button" className="flex h-9 max-w-32 items-center gap-1.5 rounded-lg bg-blue-50 px-2 text-xs font-bold text-[#4d72e1] dark:bg-[#263b6a] dark:text-blue-300" onClick={()=>openRight('properties')} aria-label="開啟選取家具屬性"><SlidersHorizontal className="size-4 shrink-0"/><span className="truncate">{current.name}</span></button>
          </div>}
        </ScrollToolbar>
        {current&&<details key={current.id+'-'+view} className="absolute right-3 top-3 z-20 rounded-xl border border-[#d8e2ee] bg-white/95 p-1.5 shadow-sm dark:border-[#3b4d68] dark:bg-[#18243a]/95 sm:hidden" onKeyDown={e=>{if(e.key==='Escape'){e.currentTarget.open=false;e.currentTarget.querySelector('summary').focus();}}}>
          <summary className={canvasButton+' list-none [&::-webkit-details-marker]:hidden'} aria-label="更多家具操作"><MoreHorizontal className="size-4"/></summary>
          <div className="absolute right-0 top-full mt-2 w-44 rounded-xl border border-[#d8e2ee] bg-white p-1 shadow-lg dark:border-[#3b4d68] dark:bg-[#18243a]">
            {[[SlidersHorizontal,'家具屬性',()=>openRight('properties')],[RotateCw,'旋轉 90 度',onRotate],[Copy,'複製家具',onDuplicate],[Trash2,'刪除家具',onDelete]].map(([Icon,label,action])=><button key={label} type="button" className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-xs hover:bg-blue-50 dark:hover:bg-[#263b6a]" onClick={e=>{e.currentTarget.closest('details').open=false;action();}}><Icon className="size-4"/>{label}</button>)}
          </div>
        </details>}
        {view==='2d'&&<div className="pointer-events-none absolute bottom-12 left-3 z-20 rounded-lg border border-[#d8e2ee] bg-white/95 px-2.5 py-2 text-[11px] text-[#51647f] shadow-sm dark:border-[#3b4d68] dark:bg-[#18243a]/95 dark:text-[#c0cee1]" aria-label="比例尺">
          <span>{scaleBar.label}</span><div className="mt-1 h-1.5 border-x border-b border-current" style={{width:scaleBar.pixels}}/>
        </div>}

        {planActions.notice&&<div role={planActions.notice.tone==='error'?'alert':'status'} {...(planActions.notice.kind?{'data-file-notice':planActions.notice.kind}:{'data-replace-notice':''})} className={'absolute inset-x-3 bottom-12 z-20 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs shadow-sm '+(planActions.notice.tone==='error'?'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-100':planActions.notice.tone==='warning'?'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100':'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-[#263b6a] dark:text-blue-100')}><span className="min-w-0 flex-1">{planActions.notice.text}</span>{planActions.notice.actions.map(([label,run])=><button key={label} type="button" className={panelButton+' py-1'} onClick={run}>{label}</button>)}{!planActions.notice.kind&&<button type="button" className={iconButton+' size-7'} onClick={planActions.onDismissNotice} aria-label="關閉通知"><X className="size-4"/></button>}</div>}
        <div className="pointer-events-none absolute bottom-0 inset-x-0 flex h-9 items-center justify-between gap-2 border-t border-[#e5ebf3] bg-white/90 px-3 text-[11px] text-[#51647f] dark:border-[#2e3d56] dark:bg-[#18243a]/95 dark:text-[#c0cee1]"><span className="truncate" role="status">{notice||status}</span><span className="truncate max-sm:hidden" data-storage-mode={planActions.storage.kind} title={planActions.storage.label}>{planActions.storage.label}</span><span className="shrink-0 max-sm:hidden">{counts}</span><div className="flex h-full shrink-0 items-center gap-1 border-l border-[#e5ebf3] pl-2 dark:border-[#2e3d56]" data-scale-ratio>{view==='2d'?(<select aria-label="顯示比例" className="pointer-events-auto h-8 max-w-24 cursor-pointer rounded-md bg-transparent px-2 hover:bg-[#eef3ff] dark:hover:bg-[#263b6a] text-xs font-bold text-[#536b92] dark:text-[#b4c3d8] dark:[&>option]:bg-[#18243a]" value="current" onChange={e=>{const value=e.target.value;if(value==='fit')onFit();else onRatio(Number(value));e.target.value='current';}}>
            <option value="current">1:{Math.round(ratio)}</option>
            <option value="fit">符合畫布</option>
            {[20,50,60,75,100,150,200].map(value=><option key={value} value={value}>1:{value}</option>)}
          </select>):<span>3D</span>}<select aria-label="顯示單位" value={unit} onChange={e=>onUnit(e.target.value)} className="pointer-events-auto h-8 cursor-pointer rounded-md bg-transparent px-1 text-xs hover:bg-[#eef3ff] dark:hover:bg-[#263b6a] dark:[&>option]:bg-[#18243a]"><option value="mm">mm</option><option value="cm">cm</option></select></div></div>
      </section>
      <div inert={!workspace.rightOpen} aria-hidden={!workspace.rightOpen} className={'z-40 min-h-0 shrink-0 overflow-hidden transition-[width,transform] duration-200 ease-out motion-reduce:transition-none max-md:absolute max-md:inset-y-0 max-md:right-11 max-md:w-[calc(100%_-_88px)] '+(workspace.rightOpen?'w-80 translate-x-0':'w-0 max-md:translate-x-full')}>
        <aside id="layers-panel" className="flex h-full min-h-0 w-80 flex-col overflow-hidden border-l border-[#e5ebf3] bg-white dark:border-[#2e3d56] dark:bg-[#18243a] max-md:w-full" aria-label="物件面板">
          <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-700"><h2 className="flex-1 text-sm font-bold">{RIGHT_TABS.find(t=>t[0]===workspace.rightTab)?.[2]}</h2><button type="button" className={iconButton+' size-8'} onClick={closeRight} aria-label="收合物件面板"><PanelRightClose className="size-4"/></button></div>
          <WorkspacePanel id="properties" active={workspace.rightTab==='properties'}>{properties}</WorkspacePanel>
          <WorkspacePanel id="objects" active={workspace.rightTab==='objects'}><div className="workspace-card mb-4"><h3>圖層顯示</h3><div className="mt-2 space-y-1">{[['roomNames','空間名稱'],['furniture','家具物件'],['furnitureLabels','家具標籤'],['dimensions','尺寸與測量'],['areas','面積標籤']].map(([key,label])=><div key={key} className="flex items-center gap-1"><button type="button" aria-label={`顯示${label}`} aria-pressed={layers[key]} onClick={()=>onToggleLayer(key)} className="flex min-w-0 flex-1 items-center justify-between rounded-lg px-2 py-2 text-xs hover:bg-blue-50 dark:hover:bg-[#263b6a]"><span>{label}</span>{layers[key]?<Eye className="size-4 text-blue-500"/>:<EyeOff className="size-4 text-slate-400"/>}</button><button type="button" className={iconButton} aria-label={`鎖定${label}`} aria-pressed={layers.locked[key]} onClick={()=>onToggleLayerLock(key)}>{layers.locked[key]?<LockKeyhole className="size-4 text-amber-600"/>:<UnlockKeyhole className="size-4"/>}</button></div>)}</div></div><div className="mb-3 flex items-center justify-between text-xs text-slate-500"><span>{doc.furniture.length} 件家具</span><button className="font-bold text-[#4d72e1]" onClick={()=>openLeft('furniture')}>加入家具</button></div><div className="space-y-2">{[...doc.furniture].reverse().map(f=><div key={f.id} className="flex items-center gap-1"><button type="button" key={f.id} disabled={layers.locked.furniture} onClick={()=>{onSelect(f.id);openRight('properties');}} aria-pressed={f.id===selected} className={'flex min-w-0 flex-1 items-center gap-3 rounded-xl border px-3 py-2 text-left '+(f.id===selected?'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-[#263b6a]':'border-[#e3e9f1] hover:bg-slate-50 dark:border-[#344661] dark:hover:bg-[#263b6a]')}><svg className="size-11 shrink-0" viewBox={`${-f.w/2-50} ${-f.d/2-50} ${f.w+100} ${f.d+100}`} aria-hidden="true"><FurnitureSymbol type={f.type} width={f.w} depth={f.d} color={f.color}/></svg><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold">{f.name}</span><span className="mt-1 block text-[10px] text-slate-500 dark:text-slate-400">{formatLength(f.w,unit)} × {formatLength(f.d,unit)} {unit}</span></span></button></div>)}</div></WorkspacePanel>
          <WorkspacePanel id="history" active={workspace.rightTab==='history'}><p className="workspace-help mb-4">這次開啟工作區的編輯紀錄。點選先前步驟可還原，還原也能復原。</p><div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs font-bold text-blue-700 dark:border-blue-800 dark:bg-[#263b6a] dark:text-blue-200">目前狀態 · {doc.furniture.length} 件家具</div>{history.past.length?<div className="space-y-2">{history.past.map((snapshot,i)=><button type="button" key={i} className={panelButton+' w-full justify-start text-left'} onClick={()=>onRestore(snapshot)}><History className="size-4 shrink-0"/><span>步驟 {i+1} 前 · {describeChange(snapshot,history.past[i+1]||doc)}</span></button>).reverse()}</div>:<p className="workspace-help">尚無編輯紀錄。</p>}</WorkspacePanel>
        </aside>
      </div>
      <div className="z-50 flex w-11 shrink-0 flex-col border-l border-slate-200 bg-white dark:border-slate-700 dark:bg-[#18243a]">
        <PanelRail tabs={RIGHT_TABS} open={workspace.rightOpen} tab={workspace.rightTab} onSelect={openRight} onClose={closeRight}/>
        <button type="button" className={'mx-auto mb-3 mt-auto grid size-9 shrink-0 place-items-center rounded-lg '+(costOpen?'bg-blue-50 text-blue-600 dark:bg-[#263b6a] dark:text-blue-200':'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700')} aria-label="費用估算" aria-expanded={costOpen} aria-controls="cost-content" onClick={()=>setCostOpen(value=>!value)}><Calculator className="size-[18px]"/></button>
      </div>
    </main>
    {dropping&&<DropOverlay/>}
    {planActions.importState&&<ImportDialog state={planActions.importState} onConfirm={planActions.onConfirmImport} onCancel={planActions.onCancelImport}/>}
    <div inert={modal} className="contents"><CostDock open={costOpen} narrow={narrow} onClose={()=>setCostOpen(false)}>{costEstimate}</CostDock></div>
    <ToolbarHints rootRef={root}/>
  </div>;
}
