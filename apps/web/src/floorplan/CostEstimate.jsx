import { roomArea, containsPoint } from './roomGeometry.js';

const defaults={currency:'TWD',wastePercent:5,furniturePrices:{},materialPrices:{}};
const validPrice=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
// A number input reports unparsable text (e.g. "1e") as '', so only an empty field without badInput means "clear".
function NumberField({value,onCommit,label,max}) {
  return <input aria-label={label} type="number" min="0" max={max} step="0.01" defaultValue={value??''} placeholder="未填" className="w-20 rounded border border-transparent bg-transparent px-1.5 py-1 text-right text-xs tabular-nums hover:border-slate-300 focus:border-blue-500 focus:outline-none dark:hover:border-slate-600" onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}} onBlur={e=>{const raw=e.target.value,next=raw===''?null:Number(raw);if(e.target.validity.badInput){e.target.value=value??'';return;}if(next===null||validPrice(next)&&(max===undefined||next<=max)){if(next!==(value??null))onCommit(next);}else e.target.value=value??'';}}/>;
}
// Money follows what the table shows: quantity rounded to 2 decimals, each subtotal rounded to cents, totals summed from those subtotals in integer cents.
const round2=value=>Math.round(value*100)/100;
const subtotalCents=row=>validPrice(row.price)?Math.round(row.quantity*row.price*100):0;
const sumCents=rows=>rows.reduce((total,row)=>total+subtotalCents(row),0);
function EstimateTable({doc,cost,onChange}) {
  const money=value=>new Intl.NumberFormat('zh-TW',{maximumFractionDigits:cost.currency==='JPY'?0:2}).format(value);
  const furniture=doc.furniture.map(f=>({id:f.id,name:f.name,room:doc.rooms.find(r=>containsPoint(r.poly,f.cx,f.cy))?.name||'未歸屬',quantity:1,unit:'件',price:cost.furniturePrices[f.id],kind:'furniture'}));
  const flooring=doc.rooms.filter(r=>r.counted!==false).map(r=>({id:r.id,name:doc.materials[r.mat]?.name||r.mat,room:r.name,quantity:round2(roomArea(r.poly)*(1+cost.wastePercent/100)),unit:'m²',price:cost.materialPrices[r.mat],kind:'flooring',material:r.mat}));
  const missing=[...furniture,...flooring].filter(row=>!validPrice(row.price)).length;
  function priceChange(row,value){const key=row.kind==='furniture'?'furniturePrices':'materialPrices',id=row.kind==='furniture'?row.id:row.material;const prices={...cost[key]};if(value===null)delete prices[id];else prices[id]=value;onChange({...cost,[key]:prices});}
  const table=(title,rows)=><section className="mt-4"><div className="mb-1 flex items-center gap-2"><h3 className="text-sm font-bold">{title}</h3><span className="text-[10px] text-slate-500">{rows.length} 項</span></div><div className="overflow-x-auto"><table className="w-full min-w-[460px] table-fixed border-collapse text-xs">
    <colgroup><col/><col style={{width:96}}/><col style={{width:90}}/><col style={{width:90}}/><col style={{width:104}}/></colgroup>
    <thead><tr className="border-b border-slate-300 text-left text-slate-500 dark:border-slate-600"><th className="py-1.5 pr-2">項目</th><th className="pr-2">空間</th><th className="pr-2 text-right">數量</th><th className="pr-2 text-right">單價</th><th className="text-right">小計</th></tr></thead>
    <tbody>{rows.map(row=><tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"><td className="py-1 pr-2"><span className="block truncate" title={row.name}>{row.name}</span></td><td className="pr-2"><span className="block truncate" title={row.room}>{row.room}</span></td><td className="whitespace-nowrap pr-2 text-right tabular-nums">{row.quantity.toFixed(row.unit==='件'?0:2)} <span className="text-[10px] text-slate-500">{row.unit}</span></td><td className="py-1 pr-2 text-right"><NumberField key={row.id+'-'+row.price} value={row.price} label={`${row.room} ${row.name} 單價`} onCommit={value=>priceChange(row,value)}/></td><td className="whitespace-nowrap text-right tabular-nums">{validPrice(row.price)?money(subtotalCents(row)/100):'—'}</td></tr>)}</tbody>
  </table></div></section>;
  return <div className="estimate-layout">
    <aside className="estimate-summary">
    <div className="flex flex-wrap items-end gap-3"><label className="flex items-center gap-2 text-xs"><span className="whitespace-nowrap">地板損耗</span><NumberField key={'waste-'+cost.wastePercent} value={cost.wastePercent} max={100} label="地板損耗百分比" onCommit={value=>onChange({...cost,wastePercent:value??0})}/><span>%</span></label></div>
    <p className="workspace-help mt-3">請自行填寫報價；原參考案例的材料價格不套用。同材質共用單價，地板數量含損耗；飄窗不計入地板估算。</p>
    <p className="mt-3 text-[11px] font-semibold text-slate-500">金額單位：{cost.currency}</p>
    <div className="workspace-card mt-2 space-y-2 text-xs"><div className="flex justify-between"><span>家具小計</span><strong>{money(sumCents(furniture)/100)}</strong></div><div className="flex justify-between"><span>地板小計</span><strong>{money(sumCents(flooring)/100)}</strong></div><div className="flex justify-between border-t border-slate-200 pt-2 text-sm dark:border-slate-600"><span>已填項目合計</span><strong>{money((sumCents(furniture)+sumCents(flooring))/100)}</strong></div><p className="workspace-help">{missing?`${missing} 項未填單價，合計尚未完整。`:'所有項目已填單價。'} 不含施工、運費與稅額。</p></div>
    </aside>
    <div className="estimate-tables">{table('家具',furniture)}{table('地板材質',flooring)}</div>
  </div>;
}
export default function CostEstimate({doc,onChange}) {
  const cost={...defaults,...doc.costEstimate,currency:'TWD'};
  return <EstimateTable doc={doc} cost={cost} onChange={onChange}/>;
}
