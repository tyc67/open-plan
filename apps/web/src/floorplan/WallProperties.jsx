import { useMemo, useState } from 'react';
import { wallLength } from 'open-plan-core';
import { formatLength, unitFactor } from './units.js';
import { joinCandidates, wallLengthCommand, wallPoint } from './planEdit.js';

export const canDemolish=wall=>['n','low'].includes(wall.type);
// A demolished bearing or exterior wall (a tolerable issue in a saved plan) can be restored, but not demolished again.
export const canToggleDemolition=wall=>canDemolish(wall)||!!wall.demolished;
export const WALL_TYPES=[['b','承重牆'],['e','外牆'],['n','隔間牆'],['low','矮牆']];
const END_NAMES={a:'起點 a',b:'終點 b'};

/** A typed length in the display unit as mm, or null. */
const typed=(text,unit)=>{const value=Number(String(text).trim());return String(text).trim()!==''&&Number.isFinite(value)&&value>0?value*unitFactor(unit):null;};

/**
 * The panel of a selected wall (roadmap D4a). Each control sends core commands through `onEdit(commands, label)`,
 * which changes the plan as one undo step, or changes nothing and shows the reasons.
 */
export default function WallProperties({wall,doc,unit,onEdit,onDeleted}) {
  const length=wallLength(wall),openings=doc.openings.filter(o=>o.wallId===wall.id).length;
  const [end,setEnd]=useState('b');
  const candidates=useMemo(()=>joinCandidates(doc,wall.id),[doc,wall.id]);
  const [other,setOther]=useState('');
  const otherId=candidates.some(w=>w.id===other)?other:candidates[0]?.id;
  const field='w-full min-w-0 rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600';
  const button='rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold disabled:opacity-40 dark:border-slate-600';
  // A field sends its value on Enter or when the focus leaves it; a value that is not usable goes back to the shown one.
  const lengthField=(name,shown,send)=><input data-wall-field={name} key={`${wall.id}-${name}-${shown}-${unit}`} inputMode="decimal" autoComplete="off" className={field} defaultValue={shown}
    onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)e.currentTarget.blur();}}
    onBlur={e=>{const value=typed(e.target.value,unit);if(value!==null&&e.target.value.trim()!==shown)send(value);e.target.value=shown;}}/>;
  const split=distance=>onEdit([{op:'split_wall',wallId:wall.id,at:wallPoint(wall,distance)}],'分割牆體');
  return <div className="space-y-4" data-wall-panel={wall.id}>
    <div className="workspace-card"><h3>牆體屬性</h3>
      <label className="mt-3 block text-xs">名稱
        <input data-wall-field="name" key={`${wall.id}-name-${wall.name??''}`} className={field+' mt-2'} defaultValue={wall.name??''} placeholder="（未命名）" onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)e.currentTarget.blur();}} onBlur={e=>{const name=e.target.value.trim();if(name!==(wall.name??''))onEdit([{op:'update_wall',wallId:wall.id,name}],'重新命名牆體');}}/>
      </label>
      <label className="mt-3 block text-xs">類型
        <select data-wall-field="type" className={field+' mt-2'} value={wall.type} onChange={e=>onEdit([{op:'update_wall',wallId:wall.id,type:e.target.value}],'變更牆體類型')}>{WALL_TYPES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
      </label>
      <label className="mt-3 block text-xs">厚度（{unit}）
        <div className="mt-2">{lengthField('thickness',formatLength(wall.thickness,unit),thickness=>onEdit([{op:'update_wall',wallId:wall.id,thickness}],'變更牆體厚度'))}</div>
      </label>
      <dl className="mt-3 grid grid-cols-2 gap-y-3 text-xs"><dt>狀態</dt><dd data-wall-state>{wall.demolished?'已標記拆除':'保留'}</dd><dt>開口</dt><dd>{openings} 個</dd></dl>
    </div>
    <div className="workspace-card"><h3>長度</h3>
      <p className="workspace-help mt-2">輸入牆的新長度。選擇要移動的端點；另一個端點不動。圖面上標示了 a 和 b。</p>
      <div className="mt-2 flex gap-4 text-xs" role="radiogroup" aria-label="要移動的端點">{['a','b'].map(key=><label key={key} className="flex items-center gap-1.5"><input type="radio" name="wall-end" data-wall-end={key} checked={end===key} onChange={()=>setEnd(key)}/>移動{END_NAMES[key]}</label>)}</div>
      <label className="mt-3 block text-xs">牆的長度（{unit}）
        <div className="mt-2">{lengthField('length',formatLength(length,unit),value=>onEdit([wallLengthCommand(wall,end,value)],'變更牆體長度'))}</div>
      </label>
    </div>
    <div className="workspace-card"><h3>分割與合併</h3>
      <label className="mt-3 block text-xs">分割位置：距離起點 a（{unit}）
        <div className="mt-2 flex gap-2"><input data-wall-field="split" key={`${wall.id}-split-${length}-${unit}`} inputMode="decimal" autoComplete="off" className={field} defaultValue={formatLength(length/2,unit)}/>
          <button type="button" data-wall-split className={button+' shrink-0'} onClick={e=>{const value=typed(e.currentTarget.previousSibling.value,unit);if(value!==null)split(value);}}>分割</button></div>
      </label>
      {candidates.length>0?<label className="mt-3 block text-xs">和相接的牆合併
        <div className="mt-2 flex gap-2"><select data-wall-field="join" className={field} value={otherId} onChange={e=>setOther(e.target.value)}>{candidates.map(w=><option key={w.id} value={w.id}>{w.name||w.id}（{formatLength(wallLength(w),unit)} {unit}）</option>)}</select>
          <button type="button" data-wall-join className={button+' shrink-0'} onClick={()=>onEdit([{op:'join_walls',wallId:wall.id,otherId}],'合併牆體')}>合併</button></div>
      </label>:<p className="workspace-help mt-3">沒有可以合併的牆。只有在同一條線上、相接、類型和厚度都相同的牆才能合併。</p>}
    </div>
    <button type="button" data-wall-reverse className={button+' w-full'} onClick={()=>onEdit([{op:'reverse_wall',wallId:wall.id}],'反轉牆體方向')}>對調起點和終點（門窗位置不變）</button>
    <button type="button" data-wall-demolish disabled={!canToggleDemolition(wall)} onClick={()=>onEdit([{op:'toggle_demolition',wallId:wall.id}],wall.demolished?'恢復牆體':'標記拆除牆體')} className="w-full rounded-lg border border-orange-300 bg-orange-50 px-3 py-2.5 text-xs font-bold text-orange-800 disabled:opacity-40 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">{wall.demolished?'恢復牆體':'標記拆除'}</button>
    <p className="workspace-help">{wall.type==='b'?'承重牆不可標記拆除。':wall.type==='e'?'外牆保留，不提供拆除操作。':'拆除標記會同步到 2D 與 3D；可復原或恢復牆體。'}</p>
    <button type="button" data-wall-delete className="w-full rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-xs font-bold text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200" onClick={()=>{if(onEdit([{op:'delete_wall',wallId:wall.id}],'刪除牆體').status==='ok')onDeleted();}}>刪除這段牆{openings?`（和牆上的 ${openings} 個開口）`:''}</button>
    <p className="workspace-help">刪除是把牆從平面圖移除（例如圖面上多出來的牆）；「標記拆除」是保留牆並標示要拆除。兩者都可以用「復原」取消。</p>
  </div>;
}

/** The form of the add-wall tool (roadmap D4a): the same edit as two points on the drawing, with typed values. */
export function AddWallPanel({unit,start,onAdd}) {
  const [values,setValues]=useState({x:'',y:'',direction:'right',length:'',type:'n'});
  const set=(key,value)=>setValues(v=>({...v,[key]:value}));
  const number=text=>{const value=Number(String(text).trim());return String(text).trim()!==''&&Number.isFinite(value)?value*unitFactor(unit):null;};
  // A first point from the drawing fills the start fields until the user types in them.
  const x=values.x!==''||!start?values.x:formatLength(start[0],unit),y=values.y!==''||!start?values.y:formatLength(start[1],unit);
  const from=[number(x),number(y)],length=typed(values.length,unit),ready=from[0]!==null&&from[1]!==null&&length!==null;
  const field='mt-2 w-full min-w-0 rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600';
  return <form className="space-y-4" data-add-wall-panel onSubmit={e=>{e.preventDefault();if(ready&&onAdd(from,values.direction,length,values.type).status==='ok')setValues(v=>({...v,x:'',y:'',length:''}));}}>
    <div className="workspace-card"><h3>新增牆</h3>
      <p className="workspace-help mt-2">在圖面上點兩個點（起點和終點），或在這裡輸入數值。牆只能是水平或垂直。X 向右、Y 向下。</p>
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <label>起點 X（{unit}）<input data-add-wall="x" inputMode="decimal" autoComplete="off" className={field} value={x} onChange={e=>set('x',e.target.value)}/></label>
        <label>起點 Y（{unit}）<input data-add-wall="y" inputMode="decimal" autoComplete="off" className={field} value={y} onChange={e=>set('y',e.target.value)}/></label>
        <label>方向<select data-add-wall="direction" className={field} value={values.direction} onChange={e=>set('direction',e.target.value)}><option value="right">向右</option><option value="left">向左</option><option value="down">向下</option><option value="up">向上</option></select></label>
        <label>長度（{unit}）<input data-add-wall="length" inputMode="decimal" autoComplete="off" className={field} value={values.length} onChange={e=>set('length',e.target.value)}/></label>
        <label className="col-span-2">類型<select data-add-wall="type" className={field} value={values.type} onChange={e=>set('type',e.target.value)}>{WALL_TYPES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      <button type="submit" data-add-wall-submit disabled={!ready} className="mt-4 w-full rounded-lg border border-blue-600 bg-blue-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">新增牆</button>
      <p className="workspace-help mt-3">厚度會和最近的牆相同；新增後可以在牆體屬性修改。</p>
    </div>
  </form>;
}
