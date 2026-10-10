import { useEffect, useState } from 'react';
import { issueMessages } from './issueMessages.js';
import { parseDistance, scalePreview } from './planScale.js';
import { formatLength } from './units.js';

// The panel of a selected measurement, with plan scaling (roadmap D3): the user types the real length of the
// measurement, sees what the scaling would do, and applies it. Nothing changes in the plan before 套用.
const NOTES = {
  'unusual-factor': '比例變化很大，請確認輸入的長度和單位是否正確。',
  'short-measurement': '這段測量很短，校正結果可能不準；建議改用較長的測量。',
};
const metres = v => v.toFixed(2);
const percent = factor => `${factor >= 1 ? '+' : '−'}${Math.abs((factor - 1) * 100).toFixed(1)}%`;

/**
 * `onApply(distance)` scales the newest plan and returns its preview result; `onSession(open)` tells the editor that a
 * scaling is open (an open scaling counts as busy, so a file change from outside is a conflict, not a silent load).
 */
export default function MeasurementProperties({ doc, measurementId, unit, shown: visible, onApply, onDelete, onSession }) {
  // The unit of the field stays the one from when the form was opened, so a typed value keeps its meaning.
  const [form, setForm] = useState(null);                                       // null: closed; else { text, unit }
  const [refused, setRefused] = useState(null);
  useEffect(() => { onSession(!!form); }, [!!form]);
  useEffect(() => () => onSession(false), []);
  // The panel stays mounted when its tab or the side panel is not shown. A form that the user cannot see must not
  // keep the editor busy, so it closes.
  useEffect(() => { if (!visible) { setForm(null); setRefused(null); } }, [visible]);
  const distance = form ? parseDistance(form.text, form.unit) : null;
  const preview = scalePreview(doc, measurementId, distance);
  if (preview.status === 'missing') return null;
  const close = () => { setForm(null); setRefused(null); };
  const apply = () => {
    if (distance === null) return;
    const result = onApply(distance);
    if (result.status === 'ok') close(); else setRefused(result);
  };
  const shown = form && refused?.status === 'refused' && preview.status !== 'ok' ? refused : preview;
  const errors = shown.status === 'refused' ? issueMessages(shown.errors[0]?.params?.issues ?? shown.errors, 5) : [];
  const field = 'mt-2 w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600';
  const button = 'rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40';
  return <div className="space-y-4" data-measurement-panel={measurementId}>
    <div className="workspace-card"><h3>測量</h3>
      <dl className="mt-3 grid grid-cols-2 gap-y-3 text-xs"><dt>長度</dt><dd data-measured-length>{formatLength(preview.measured, unit)} {unit}</dd></dl>
    </div>
    {!form && <>
      <button type="button" data-scale-open disabled={preview.status === 'zero'} onClick={() => setForm({ text: '', unit })} className={`w-full border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200 ${button}`}>以此測量校正比例</button>
      <p className="workspace-help">{preview.status === 'zero' ? '這段測量的長度是 0，不能用來校正比例。' : '如果平面圖的比例不對：輸入這段測量的實際長度，整張平面圖會依比例調整。'}</p>
      <button type="button" data-measurement-delete onClick={onDelete} className={`w-full border-slate-300 dark:border-slate-600 ${button}`}>刪除測量</button>
    </>}
    {form && <form className="workspace-card" data-scale-form onSubmit={e => { e.preventDefault(); apply(); }} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
      <h3>校正比例</h3>
      <label className="mt-3 block text-xs">實際長度（{form.unit}）
        <input data-scale-distance autoFocus inputMode="decimal" autoComplete="off" className={field} value={form.text} onChange={e => { setForm({ ...form, text: e.target.value }); setRefused(null); }}/>
      </label>
      {form.text.trim() !== '' && distance === null && <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">請輸入大於 0 的數字。</p>}
      {shown.factor !== undefined && <dl className="mt-3 grid grid-cols-2 gap-y-2 text-xs" data-scale-preview>
        <dt>比例</dt><dd data-scale-factor>×{shown.factor.toFixed(4)}（{percent(shown.factor)}）</dd>
        {shown.after && <><dt>平面圖大小</dt><dd>{metres(shown.before.width)} × {metres(shown.before.depth)} m → {metres(shown.after.width)} × {metres(shown.after.depth)} m</dd></>}
      </dl>}
      {shown.status === 'same' && <p className="mt-2 text-xs">這個長度和目前的相同，不需要調整。</p>}
      {(shown.notes ?? []).map(note => <p key={note} data-scale-note={note} className="mt-2 text-xs text-amber-700 dark:text-amber-300">{NOTES[note]}</p>)}
      {shown.status === 'ok' && shown.warnings.length > 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">調整後有 {shown.warnings.length} 個需要注意的地方，套用後清單在「平面圖設定」。</p>}
      {errors.length > 0 && <div role="alert" data-scale-errors className="mt-2 text-xs text-red-700 dark:text-red-300"><p className="font-bold">這個比例會讓平面圖出現錯誤，所以沒有調整：</p><ul className="mt-1 list-disc pl-4">{errors.map(line => <li key={line}>{line}</li>)}</ul></div>}
      <div className="mt-4 flex gap-2">
        <button type="submit" data-scale-apply disabled={preview.status !== 'ok'} className={`flex-1 border-blue-600 bg-blue-600 text-white ${button}`}>套用</button>
        <button type="button" data-scale-cancel onClick={close} className={`flex-1 border-slate-300 dark:border-slate-600 ${button}`}>取消</button>
      </div>
      <p className="workspace-help mt-3">牆、門窗、空間和家具位置會依比例調整；家具尺寸和高度不變。可以用「復原」取消。</p>
    </form>}
  </div>;
}
