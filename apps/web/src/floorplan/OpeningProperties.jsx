import { useState } from 'react';
import { wallLength } from 'open-plan-core';
import { formatLength, unitFactor } from './units.js';
import { OPENING_DEFAULTS, openingTypeCommand, wallHeading } from './planEdit.js';

export const OPENING_TYPES=[['door','門'],['window','窗戶'],['sliding-door','推拉門'],['hole','開口（無門）']];
export const openingLabel=opening=>opening.name||OPENING_TYPES.find(([type])=>type===opening.type)?.[1]||opening.id;
const HEADINGS={right:'水平，a 在左、b 在右',left:'水平，a 在右、b 在左',down:'垂直，a 在上、b 在下',up:'垂直，a 在下、b 在上'};
export const wallSummary=(wall,unit)=>`${wall.name||wall.id}（${HEADINGS[wallHeading(wall)]}，${formatLength(wallLength(wall),unit)} ${unit}）`;

/** A typed length in the display unit as mm, or null. 0 is a length (an offset or a sill at 0). */
const typed=(text,unit)=>{const value=Number(String(text).trim());return String(text).trim()!==''&&Number.isFinite(value)&&value>=0?value*unitFactor(unit):null;};

/**
 * The panel of a selected opening (roadmap D4b). Each control sends core commands through `onEdit(commands, label)`,
 * which changes the plan as one undo step, or changes nothing and shows the reasons.
 */
export default function OpeningProperties({opening,doc,unit,onEdit,onDeleted,onSelectWall}) {
  const wall=doc.walls.find(w=>w.id===opening.wallId);
  const [keep,setKeep]=useState('start');
  // A move to another wall: the wall, and the offset in it. Nothing moves before 移動. The unit of the offset field
  // stays the one from when the wall was chosen, so a typed value keeps its meaning when the display unit changes.
  const [target,setTarget]=useState({wallId:'',offset:'',unit});
  const others=doc.walls.filter(w=>w.id!==opening.wallId&&!w.demolished),targetWall=others.find(w=>w.id===target.wallId);
  const targetOffset=typed(target.offset,target.unit);
  const field='w-full min-w-0 rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600';
  const button='rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold disabled:opacity-40 dark:border-slate-600';
  const update=(values,label)=>onEdit([{op:'update_opening',openingId:opening.id,...values}],label);
  // A field sends its value on Enter or when the focus leaves it; a value that is not usable goes back to the shown one.
  const lengthField=(name,value,send)=>{const shown=formatLength(value,unit);return <input data-opening-field={name} key={`${opening.id}-${name}-${shown}-${unit}`} inputMode="decimal" autoComplete="off" className={field+' mt-2'} defaultValue={shown}
    onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)e.currentTarget.blur();}}
    onBlur={e=>{const next=typed(e.target.value,unit);if(next!==null&&e.target.value.trim()!==shown)send(next);e.target.value=shown;}}/>;};
  return <div className="space-y-4" data-opening-panel={opening.id}>
    <div className="workspace-card"><h3>門窗屬性</h3>
      <label className="mt-3 block text-xs">名稱
        <input data-opening-field="name" key={`${opening.id}-name-${opening.name??''}`} className={field+' mt-2'} defaultValue={opening.name??''} placeholder="（未命名）" onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing)e.currentTarget.blur();}} onBlur={e=>{const name=e.target.value.trim();if(name!==(opening.name??''))update({name},'重新命名門窗');}}/>
      </label>
      <label className="mt-3 block text-xs">類型
        <select data-opening-field="type" className={field+' mt-2'} value={opening.type} onChange={e=>onEdit([openingTypeCommand(doc,opening,e.target.value)],'變更門窗類型')}>{OPENING_TYPES.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
      </label>
      <p className="workspace-help mt-2">換類型時，寬度和位置不變。門、推拉門和開口互換時頂高不變；換成窗戶或從窗戶換出時，高度用預設值。換成門時，鉸鏈側和開門方向用預設值。都可以在下面修改。</p>
    </div>
    <div className="workspace-card"><h3>位置與寬度</h3>
      {wall&&<p className="workspace-help mt-2" data-opening-wall>所在牆：{wallSummary(wall,unit)}。圖面上標示了 a 和 b。</p>}
      {wall?.demolished&&<p className="workspace-help mt-2 text-orange-700 dark:text-orange-300" data-opening-demolished>這段牆已標記拆除，所以圖面上不顯示這個開口。可以改名稱和高度、刪除，或移到另一面牆。</p>}
      <label className="mt-3 block text-xs">位置：距離起點 a（{unit}）{lengthField('offset',opening.offset,offset=>onEdit([{op:'move_opening',openingId:opening.id,offset}],'移動門窗'))}</label>
      <label className="mt-3 block text-xs">寬度（{unit}）{lengthField('width',opening.width,width=>onEdit([{op:'resize_opening',openingId:opening.id,width,keep}],'變更門窗寬度'))}</label>
      <div className="mt-2 flex gap-4 text-xs" role="radiogroup" aria-label="改寬度時不動的一側">{[['start','靠 a 的一側不動'],['end','靠 b 的一側不動']].map(([key,label])=><label key={key} className="flex items-center gap-1.5"><input type="radio" name="opening-keep" data-opening-keep={key} checked={keep===key} onChange={()=>setKeep(key)}/>{label}</label>)}</div>
    </div>
    <div className="workspace-card"><h3>高度</h3>
      {opening.type==='window'&&<label className="mt-3 block text-xs">窗台高度（{unit}）{lengthField('sill',opening.sill,sill=>update({sill},'變更窗台高度'))}</label>}
      <label className="mt-3 block text-xs">頂高（{unit}）{lengthField('head',opening.head,head=>update({head},'變更門窗頂高'))}</label>
    </div>
    {opening.type==='door'&&<div className="workspace-card"><h3>開門方式</h3>
      <label className="mt-3 block text-xs">鉸鏈側
        <select data-opening-field="hinge" className={field+' mt-2'} value={opening.hinge} onChange={e=>update({hinge:e.target.value},'變更鉸鏈側')}><option value="start">靠 a 的一側</option><option value="end">靠 b 的一側</option></select>
      </label>
      <label className="mt-3 block text-xs">開門方向（從 a 看向 b）
        <select data-opening-field="swing" className={field+' mt-2'} value={opening.swing} onChange={e=>update({swing:e.target.value},'變更開門方向')}><option value="left">往左側開</option><option value="right">往右側開</option></select>
      </label>
    </div>}
    <div className="workspace-card"><h3>移到另一面牆</h3>
      {others.length>0?<>
        <label className="mt-3 block text-xs">目的牆
          <select data-opening-field="wall" className={field+' mt-2'} value={targetWall?.id??''} onChange={e=>setTarget({wallId:e.target.value,offset:formatLength(opening.offset,unit),unit})}><option value="">（選擇一面牆）</option>{others.map(w=><option key={w.id} value={w.id}>{wallSummary(w,unit)}</option>)}</select>
        </label>
        {targetWall&&<>
          <label className="mt-3 block text-xs">在目的牆的位置：距離它的起點 a（{target.unit}）
            <input data-opening-field="wall-offset" inputMode="decimal" autoComplete="off" className={field+' mt-2'} value={target.offset} onChange={e=>setTarget({...target,offset:e.target.value})}/>
          </label>
          <p className="workspace-help mt-2">位置不會自動調整：放不下時不會移動，並顯示原因。{opening.type==='door'?'鉸鏈側和開門方向是照目的牆的 a、b 來算，移動後請檢查。':''}</p>
          <button type="button" data-opening-move-wall disabled={targetOffset===null} className={button+' mt-3 w-full'} onClick={()=>{if(onEdit([{op:'move_opening',openingId:opening.id,wallId:targetWall.id,offset:targetOffset}],'移動門窗到另一面牆').status==='ok')setTarget({wallId:'',offset:'',unit});}}>移動</button>
        </>}
      </>:<p className="workspace-help mt-2">沒有其他的牆。</p>}
    </div>
    {wall&&<button type="button" data-opening-select-wall className={button+' w-full'} onClick={()=>onSelectWall(wall.id)}>選取所在的牆</button>}
    <button type="button" data-opening-delete className="w-full rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-xs font-bold text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200" onClick={()=>{if(onEdit([{op:'delete_opening',openingId:opening.id}],'刪除門窗').status==='ok')onDeleted();}}>刪除這個門窗</button>
    <p className="workspace-help">刪除後，牆在這裡恢復成實牆。可以用「復原」取消。</p>
  </div>;
}

/** The openings of a wall and the action that adds one, for the wall panel (roadmap D4b). */
export function WallOpenings({wall,doc,unit,onAdd,onSelectOpening}) {
  const [type,setType]=useState('door');
  const openings=doc.openings.filter(o=>o.wallId===wall.id).sort((p,q)=>p.offset-q.offset);
  const field='w-full min-w-0 rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600';
  const button='rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold disabled:opacity-40 dark:border-slate-600';
  return <div className="workspace-card" data-wall-openings><h3>門窗 · {openings.length}</h3>
    {openings.length>0&&<div className="mt-2 space-y-1">{openings.map(o=><button type="button" key={o.id} data-wall-opening={o.id} className={button+' flex w-full justify-between text-left font-normal'} onClick={()=>onSelectOpening(o.id)}><span>{openingLabel(o)}</span><span>距 a {formatLength(o.offset,unit)}，寬 {formatLength(o.width,unit)} {unit}</span></button>)}</div>}
    <label className="mt-3 block text-xs">新增門窗
      <div className="mt-2 flex gap-2"><select data-wall-add-opening-type className={field} value={type} onChange={e=>setType(e.target.value)}>{OPENING_TYPES.map(([value,label])=><option key={value} value={value}>{label}（{formatLength(OPENING_DEFAULTS[value].width,unit)} {unit}）</option>)}</select>
        <button type="button" data-wall-add-opening className={button+' shrink-0'} onClick={()=>onAdd(type)}>新增</button></div>
    </label>
    <p className="workspace-help mt-2">新的門窗放在牆上最靠近中間的空位，寬度是預設值；新增後可以修改。牆太短時不會新增，並顯示原因。</p>
  </div>;
}
