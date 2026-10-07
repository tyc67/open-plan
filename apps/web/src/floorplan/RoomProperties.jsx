import { formatLength } from './units.js';
import { containsPoint, roomArea, roomPerimeter } from 'open-plan-core';

export default function RoomProperties({nameLocked,room,doc,unit,onPatch,onSelectFurniture}) {
  const area=roomArea(room.poly),perimeter=roomPerimeter(room.poly);
  const xs=room.poly.map(p=>p[0]),ys=room.poly.map(p=>p[1]);
  const furniture=doc.furniture.filter(f=>containsPoint(room.poly,f.cx,f.cy));
  return <div className="space-y-4">
    <div className="workspace-card"><h3>空間屬性</h3>
      <label className="mt-3 block text-xs">名稱<input key={room.id+'-'+room.name} className="mt-2 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600" disabled={nameLocked} defaultValue={room.name} maxLength={80} onBlur={e=>{const name=e.target.value.trim();if(name&&name!==room.name)onPatch({name});else e.target.value=room.name;}} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)e.currentTarget.blur();}}/></label>
      <dl className="mt-4 grid grid-cols-2 gap-y-2 text-xs"><dt>面積</dt><dd>{area.toFixed(1)} m²</dd><dt>周長</dt><dd>{perimeter.toFixed(1)} m</dd><dt>寬度</dt><dd>{formatLength(Math.max(...xs)-Math.min(...xs),unit)} {unit}</dd><dt>深度</dt><dd>{formatLength(Math.max(...ys)-Math.min(...ys),unit)} {unit}</dd></dl>
      <p className="workspace-help mt-3">牆面面積約 {(perimeter*2.8).toFixed(1)} m²（層高 2.8 m，未扣門窗）</p>
    </div>
    <div className="workspace-card"><h3>地板材質</h3><div className="mt-3 grid grid-cols-2 gap-2">{Object.entries(doc.materials).map(([id,material])=><button key={id} type="button" aria-pressed={room.mat===id} onClick={()=>{if(room.mat!==id)onPatch({mat:id});}} className={'flex items-center gap-2 rounded-lg border p-2 text-left text-xs '+(room.mat===id?'border-blue-400 bg-blue-50 text-blue-700 dark:bg-[#263b6a] dark:text-blue-200':'border-slate-200 dark:border-slate-600')}><span className="size-6 shrink-0 rounded border border-slate-300" style={{background:material.sw}}/><span>{material.name}</span></button>)}</div></div>
    <div className="workspace-card"><h3>空間內家具 · {furniture.length} 件</h3><p className="workspace-help mt-1">依家具中心位置歸屬。</p><div className="mt-2 space-y-1">{furniture.map(f=><button key={f.id} type="button" onClick={()=>onSelectFurniture(f.id)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-blue-50 dark:hover:bg-[#263b6a]"><span>{f.name}</span><span className="shrink-0 text-[10px]">{formatLength(f.w,unit)} × {formatLength(f.d,unit)} {unit}</span></button>)}{!furniture.length&&<p className="workspace-help">尚無家具。</p>}</div></div>
  </div>;
}
