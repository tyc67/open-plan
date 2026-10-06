import { formatLength } from './units.js';
export const canDemolish=wall=>['n','low'].includes(wall.type);
export default function WallProperties({wall,unit,onToggle}) {
  const [x0,y0,x1,y1]=wall.rect,width=x1-x0,depth=y1-y0;
  const type={b:'承重牆',e:'外牆',n:'隔間牆',low:'矮牆'}[wall.type]||wall.type;
  return <div className="space-y-4"><div className="workspace-card"><h3>牆體屬性</h3><dl className="mt-3 grid grid-cols-2 gap-y-3 text-xs"><dt>類型</dt><dd>{type}</dd><dt>長度</dt><dd>{formatLength(Math.max(width,depth),unit)} {unit}</dd><dt>厚度</dt><dd>{formatLength(Math.min(width,depth),unit)} {unit}</dd><dt>狀態</dt><dd>{wall.demolished?'已標記拆除':'保留'}</dd></dl></div>
    <button type="button" disabled={!canDemolish(wall)} onClick={onToggle} className="w-full rounded-lg border border-orange-300 bg-orange-50 px-3 py-2.5 text-xs font-bold text-orange-800 disabled:opacity-40 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">{wall.demolished?'恢復牆體':'標記拆除'}</button>
    <p className="workspace-help">{wall.type==='b'?'承重牆不可標記拆除。':wall.type==='e'?'外牆保留，不提供拆除操作。':'拆除標記會同步到 2D 與 3D；可復原或恢復牆體。'}</p>
  </div>;
}
