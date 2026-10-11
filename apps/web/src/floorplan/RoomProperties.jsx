import { useState } from 'react';
import { formatLength, unitFactor } from './units.js';
import { containsPoint, effectiveCeilingHeight, roomArea, roomPerimeter } from 'open-plan-core';
import { deletePoint, insertPoint, movedPoly, rectanglePoly } from './planEdit.js';

/** A typed coordinate in the display unit as mm, or null. A coordinate can be 0 or negative. */
const coordinate=(text,unit)=>{const value=Number(String(text).trim());return String(text).trim()!==''&&Number.isFinite(value)?value*unitFactor(unit):null;};
/** A typed length above 0 in the display unit as mm, or null. */
const length=(text,unit)=>{const value=coordinate(text,unit);return value!==null&&value>0?value:null;};

/**
 * The panel of a selected room. Each control sends core commands through `onEdit(commands, label)` (roadmap D4c),
 * which changes the plan as one undo step, or changes nothing and shows the reasons.
 */
export default function RoomProperties({nameLocked,room,doc,unit,onEdit,onDeleted,onSelectFurniture}) {
  const area=roomArea(room.poly),perimeter=roomPerimeter(room.poly),ceiling=effectiveCeilingHeight(doc)/1000;
  const xs=room.poly.map(p=>p[0]),ys=room.poly.map(p=>p[1]);
  const furniture=doc.furniture.filter(f=>containsPoint(room.poly,f.cx,f.cy));
  const update=(values,label)=>onEdit([{op:'update_room',roomId:room.id,...values}],label);
  const outline=poly=>update({poly},'調整空間外框');
  const field='w-full min-w-0 rounded-lg border border-slate-300 bg-transparent px-2 py-1.5 dark:border-slate-600';
  const small='rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-bold disabled:opacity-40 dark:border-slate-600';
  // A field sends its value on Enter or when the focus leaves it; a value that is not usable goes back to the shown one.
  const pointField=(index,axis)=>{const shown=formatLength(room.poly[index][axis],unit);return <input data-room-point={`${index}-${axis?'y':'x'}`} aria-label={`第 ${index+1} 點的 ${axis?'Y':'X'}`} key={`${room.id}-${index}-${axis}-${shown}-${unit}-${room.poly.length}`} inputMode="decimal" autoComplete="off" className={field} defaultValue={shown}
    onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)e.currentTarget.blur();}}
    onBlur={e=>{const value=coordinate(e.target.value,unit);if(value!==null&&e.target.value.trim()!==shown){const point=[...room.poly[index]];point[axis]=value;outline(movedPoly(room.poly,index,point));}e.target.value=shown;}}/>;};
  return <div className="space-y-4" data-room-panel={room.id}>
    <div className="workspace-card"><h3>空間屬性</h3>
      <label className="mt-3 block text-xs">名稱<input key={room.id+'-'+room.name} className="mt-2 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600" disabled={nameLocked} defaultValue={room.name} maxLength={80} onBlur={e=>{const name=e.target.value.trim();if(name&&name!==room.name)update({name},'重新命名空間');else e.target.value=room.name;}} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)e.currentTarget.blur();}}/></label>
      <dl className="mt-4 grid grid-cols-2 gap-y-2 text-xs"><dt>面積</dt><dd>{area.toFixed(1)} m²</dd><dt>周長</dt><dd>{perimeter.toFixed(1)} m</dd><dt>寬度</dt><dd>{formatLength(Math.max(...xs)-Math.min(...xs),unit)} {unit}</dd><dt>深度</dt><dd>{formatLength(Math.max(...ys)-Math.min(...ys),unit)} {unit}</dd></dl>
      <p className="workspace-help mt-3">牆面面積約 {(perimeter*ceiling).toFixed(1)} m²（層高 {ceiling.toFixed(1)} m，未扣門窗）</p>
      <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" data-room-counted checked={room.counted!==false} onChange={e=>update({counted:e.target.checked},e.target.checked?'計入空間面積':'不計入空間面積')}/>計入空間總面積</label>
    </div>
    <div className="workspace-card"><h3>地板材質</h3><div className="mt-3 grid grid-cols-2 gap-2">{Object.entries(doc.materials).map(([id,material])=><button key={id} type="button" aria-pressed={room.mat===id} onClick={()=>{if(room.mat!==id)update({mat:id},`變更 ${room.name} 地板材質`);}} className={'flex items-center gap-2 rounded-lg border p-2 text-left text-xs '+(room.mat===id?'border-blue-400 bg-blue-50 text-blue-700 dark:bg-[#263b6a] dark:text-blue-200':'border-slate-200 dark:border-slate-600')}><span className="size-6 shrink-0 rounded border border-slate-300" style={{background:material.sw}}/><span>{material.name}</span></button>)}</div></div>
    <div className="workspace-card" data-room-points><h3>外框的點 · {room.poly.length}</h3>
      <p className="workspace-help mt-2">圖面上每個點有編號，可以拖曳；也可以在這裡輸入座標（{unit}，X 向右、Y 向下）。「＋」在這個點和下一個點的中間加一個點。</p>
      <div className="mt-3 space-y-1.5">{room.poly.map((_,index)=><div key={index} className="flex items-center gap-1.5 text-xs" data-room-point-row={index}>
        <span className="w-5 shrink-0 text-center font-bold">{index+1}</span>{pointField(index,0)}{pointField(index,1)}
        <button type="button" className={small} data-room-point-insert={index} aria-label={`在第 ${index+1} 點後面加一個點`} onClick={()=>outline(insertPoint(room.poly,index))}>＋</button>
        <button type="button" className={small} data-room-point-delete={index} aria-label={`刪除第 ${index+1} 點`} disabled={room.poly.length<=3} onClick={()=>outline(deletePoint(room.poly,index))}>−</button>
      </div>)}</div>
      <p className="workspace-help mt-2">外框不會自動跟著牆移動；空間的標籤位置也不會跟著外框移動，可以在圖面上拖曳標籤。</p>
    </div>
    <div className="workspace-card"><h3>空間內家具 · {furniture.length} 件</h3><p className="workspace-help mt-1">依家具中心位置歸屬。</p><div className="mt-2 space-y-1">{furniture.map(f=><button key={f.id} type="button" onClick={()=>onSelectFurniture(f.id)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-blue-50 dark:hover:bg-[#263b6a]"><span>{f.name}</span><span className="shrink-0 text-[10px]">{formatLength(f.w,unit)} × {formatLength(f.d,unit)} {unit}</span></button>)}{!furniture.length&&<p className="workspace-help">尚無家具。</p>}</div></div>
    <button type="button" data-room-delete className="w-full rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-xs font-bold text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200" onClick={()=>{if(onEdit([{op:'delete_room',roomId:room.id}],'刪除空間').status==='ok')onDeleted();}}>刪除這個空間</button>
    <p className="workspace-help">刪除空間不會刪除牆和家具。可以用「復原」取消。</p>
  </div>;
}

/**
 * The panel of the add-room tool (roadmap D4c): the points that were placed on the drawing, and a rectangle from typed
 * values. The editor gives this panel a key with the display unit, so an unfinished form starts again when the unit
 * changes and a typed value never gets a new meaning. A refused rectangle keeps its values.
 */
export function AddRoomPanel({unit,points,onFinish,onRemoveLast,onCancel,onAddRectangle}) {
  const [values,setValues]=useState({x:'',y:'',width:'',depth:''});
  const set=(key,value)=>setValues(v=>({...v,[key]:value}));
  const x=coordinate(values.x,unit),y=coordinate(values.y,unit),width=length(values.width,unit),depth=length(values.depth,unit),ready=x!==null&&y!==null&&width!==null&&depth!==null;
  const field='mt-2 w-full min-w-0 rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600';
  const button='rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold disabled:opacity-40 dark:border-slate-600';
  return <div className="space-y-4" data-add-room-panel>
    <div className="workspace-card"><h3>新增空間</h3>
      <p className="workspace-help mt-2">在圖面上依序點出外框的每個點。點會吸附到附近的牆面和其他空間的點。點回第一個點、按 Enter 或按「完成」來結束；Esc 取消。</p>
      <p className="mt-3 text-xs font-bold" data-add-room-count>已經點了 {points.length} 個點{points.length<3?'（至少 3 個）':''}</p>
      {points.length>0&&<ol className="mt-2 space-y-0.5 text-xs" data-add-room-points>{points.map((p,i)=><li key={i}>{i+1}.　X {formatLength(p[0],unit)}，Y {formatLength(p[1],unit)} {unit}</li>)}</ol>}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button type="button" data-add-room-finish disabled={points.length<3} className="rounded-lg border border-blue-600 bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40" onClick={onFinish}>完成</button>
        <button type="button" data-add-room-remove disabled={!points.length} className={button} onClick={onRemoveLast}>移除上一點</button>
        <button type="button" data-add-room-cancel disabled={!points.length} className={button} onClick={onCancel}>取消</button>
      </div>
    </div>
    <form className="workspace-card" data-add-room-rectangle onSubmit={e=>{e.preventDefault();if(ready&&onAddRectangle(rectanglePoly(x,y,width,depth)).status==='ok')setValues({x:'',y:'',width:'',depth:''});}}>
      <h3>或輸入一個矩形</h3>
      <p className="workspace-help mt-2">輸入左上角的位置和大小。新增後，可以在空間屬性的「外框的點」加點或移動點，改成其他形狀。</p>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <label>左上角 X（{unit}）<input data-add-room="x" inputMode="decimal" autoComplete="off" className={field} value={values.x} onChange={e=>set('x',e.target.value)}/></label>
        <label>左上角 Y（{unit}）<input data-add-room="y" inputMode="decimal" autoComplete="off" className={field} value={values.y} onChange={e=>set('y',e.target.value)}/></label>
        <label>寬度（{unit}）<input data-add-room="width" inputMode="decimal" autoComplete="off" className={field} value={values.width} onChange={e=>set('width',e.target.value)}/></label>
        <label>深度（{unit}）<input data-add-room="depth" inputMode="decimal" autoComplete="off" className={field} value={values.depth} onChange={e=>set('depth',e.target.value)}/></label>
      </div>
      <button type="submit" data-add-room-submit disabled={!ready} className="mt-4 w-full rounded-lg border border-blue-600 bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">新增矩形空間</button>
      <p className="workspace-help mt-3">新的空間叫「新空間」，用平面圖的第一種地板材質；新增後可以修改。</p>
    </form>
  </div>;
}
