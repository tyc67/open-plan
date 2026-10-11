import { X } from 'lucide-react';

/**
 * The result of the last edit through the core commands (roadmap D4): the reasons of a refused edit, or what the
 * edit also did (for example the openings that went with a deleted wall). It stays until the user closes it or
 * makes the next edit. A room whose outline lost its wall can be selected from here; the outline is never changed
 * automatically.
 */
export default function EditNotice({notice,rooms,onSelectRoom,onClose}) {
  if(!notice)return null;
  const error=notice.tone==='error';
  const affected=(notice.roomIds??[]).map(id=>rooms.find(r=>r.id===id)).filter(Boolean);
  return <div role={error?'alert':'status'} data-edit-notice={notice.tone} className={'mb-4 rounded-xl border p-3 text-xs '+(error?'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200':'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200')}>
    <div className="flex items-start gap-2"><p className="flex-1 font-bold">{error?'沒有變更，原因：':'這次修改也造成：'}</p><button type="button" aria-label="關閉訊息" data-edit-notice-close onClick={onClose}><X className="size-4"/></button></div>
    <ul className="mt-1 list-disc pl-4">{notice.lines.map(line=><li key={line}>{line}</li>)}</ul>
    {affected.length>0&&<div className="mt-2 flex flex-wrap gap-2">{affected.map(room=><button type="button" key={room.id} data-edit-notice-room={room.id} className="rounded-lg border border-current px-2 py-1 font-bold" onClick={()=>onSelectRoom(room.id)}>選取 {room.name}</button>)}</div>}
  </div>;
}
