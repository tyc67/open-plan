// Import UI for roadmap B3: the summary or error dialog, the actions on an empty plan, the agent prompt card and the
// drop overlay. The editor reads and checks the file (floorplan/planFile.js); this file only shows the result.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Bot, Building2, Check, ClipboardCopy, FileUp, X } from 'lucide-react';
import { issueMessages, reportMessage } from '../floorplan/issueMessages.js';

const buttonBase='inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-40';
const secondary=buttonBase+' border border-[#dce4ef] bg-white text-[#536b92] hover:bg-slate-50 dark:border-[#3a4c67] dark:bg-[#17253b] dark:text-[#b4c3d8] dark:hover:bg-[#263b6a]';
const primary=buttonBase+' bg-[#4d72e1] text-white hover:bg-[#355dce]';

/** Copies text, also where the Clipboard API is not available (an http page, an older browser). */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  const area=document.createElement('textarea');
  area.value=text; area.setAttribute('readonly',''); area.style.position='fixed'; area.style.opacity='0';
  document.body.append(area); area.select();
  try { return document.execCommand('copy'); } catch { return false; } finally { area.remove(); }
}

/** A copy button that says "已複製" for 2 s after a copy. */
function CopyButton({text,label,className=secondary}) {
  const [state,setState]=useState('');
  useEffect(()=>{if(!state)return;const t=setTimeout(()=>setState(''),2000);return ()=>clearTimeout(t);},[state]);
  return <button type="button" className={className} onClick={async()=>setState(await copyText(text)?'copied':'failed')}>
    {state==='copied'?<Check className="size-4"/>:<ClipboardCopy className="size-4"/>}{state==='copied'?'已複製':state==='failed'?'無法複製，請手動選取':label}
  </button>;
}

/** The report notes grouped by code, in the order each code first appears. */
const reportGroups=report=>{const groups=new Map();for(const note of report)groups.set(note.code,[...(groups.get(note.code)||[]),note]);return [...groups];};

const metres=value=>`${value.toFixed(2)} m`;

/** The import result: the summary and the replace action, or the errors. Escape and 取消 close it. */
export function ImportDialog({state,onConfirm,onCancel}) {
  const dialog=useRef(null), cancel=useRef(onCancel); cancel.current=onCancel;
  // Focus goes back to the control that had it before the dialog (for example the 匯入 button), if it still exists.
  // It is read in a layout effect, before the browser moves focus out of the now inert background, and set again
  // after the commit that removes the dialog, when the background is no longer inert.
  useLayoutEffect(()=>{
    const opener=document.activeElement;
    return ()=>queueMicrotask(()=>{if(opener instanceof HTMLElement&&opener.isConnected&&!opener.closest('[inert]'))opener.focus();});
  },[]);
  useEffect(()=>{dialog.current?.querySelector('[data-autofocus]')?.focus();},[state]);
  useEffect(()=>{
    // Capture phase, and stopped: the editor's shortcuts (Escape, Delete, undo) must not act behind the dialog. The
    // background is inert (WorkspaceShell); Tab also wraps inside the dialog, so focus never leaves it.
    const onKey=e=>{
      e.stopPropagation();
      if(e.key==='Escape'){e.preventDefault();cancel.current();return;}
      if(e.key!=='Tab')return;
      const items=[...dialog.current.querySelectorAll('button,summary,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(el=>!el.disabled&&el.getClientRects().length);
      if(!items.length)return;
      const first=items[0], last=items.at(-1), inside=dialog.current.contains(document.activeElement);
      if(e.shiftKey&&(!inside||document.activeElement===first)){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&(!inside||document.activeElement===last)){e.preventDefault();first.focus();}
    };
    window.addEventListener('keydown',onKey,true);
    return ()=>window.removeEventListener('keydown',onKey,true);
  },[]);
  const {fileName,result}=state, report=result.report||[];
  const errorLines=result.ok?[]:issueMessages(result.errors);
  return <div className="absolute inset-0 z-[60] grid place-items-center bg-slate-900/40 p-4">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="import-title" data-import-dialog={result.ok?'ok':'error'} className="flex max-h-[calc(100dvh_-_2rem)] w-full max-w-lg flex-col rounded-2xl border border-[#dce4ef] bg-white shadow-xl dark:border-[#3a4c67] dark:bg-[#18243a]">
      <div className="flex items-start gap-2 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
        <div className="min-w-0 flex-1"><h2 id="import-title" className="text-sm font-bold">{result.ok?'匯入平面圖':'無法匯入這個檔案'}</h2><p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{fileName}</p></div>
        <button type="button" className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700" onClick={onCancel} aria-label="關閉"><X className="size-4"/></button>
      </div>
      <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4 text-xs">
        {result.ok&&<dl data-import-summary className="grid grid-cols-2 gap-y-2">
          <dt>名稱</dt><dd className="font-bold">{result.plan.name}</dd>
          <dt>牆體</dt><dd>{result.summary.walls} 段</dd>
          <dt>門窗</dt><dd>{result.summary.openings} 個</dd>
          <dt>空間</dt><dd>{result.summary.rooms} 個</dd>
          <dt>家具</dt><dd>{result.summary.furniture} 件</dd>
          <dt>大小</dt><dd>{metres(result.summary.width)} × {metres(result.summary.depth)}</dd>
        </dl>}
        {!result.ok&&<div data-import-errors>
          <p>共 {result.errors.length} 個問題，目前的平面圖沒有改變。可把錯誤訊息貼給 AI 助理修正。</p>
          <ul className="mt-2 space-y-1 text-red-700 dark:text-red-300">{errorLines.map((line,i)=><li key={i}>{line}</li>)}</ul>
        </div>}
        {report.length>0&&<div data-import-report>
          <h3 className="font-bold">舊版（v1）檔案已轉換 · {report.length} 項說明</h3>
          <p className="mt-1 text-slate-500 dark:text-slate-400">轉換已完成，以下是轉換時做的變更。展開可看每一項。</p>
          <ul className="mt-2 space-y-1.5">{reportGroups(report).map(([code,notes])=><li key={code}><details>
            <summary className="cursor-pointer">{reportMessage({code,message:notes[0].message})} · {notes.length} 項</summary>
            <ul className="mt-1 space-y-1 pl-4">{notes.map((note,i)=><li key={i}><span>{reportMessage(note)}</span><span className="block text-[11px] text-slate-500 dark:text-slate-400">{note.message}</span></li>)}</ul>
          </details></li>)}</ul>
        </div>}
        {result.ok&&<p className="text-slate-500 dark:text-slate-400">取代前會先備份目前的平面圖；可用「復原上一個平面圖」或「復原」取回。</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700">
        {result.ok?<>
          <button type="button" className={secondary} onClick={onCancel}>取消</button>
          <button type="button" className={primary} onClick={onConfirm} data-autofocus>取代目前平面圖</button>
        </>:<>
          <CopyButton text={issueMessages(result.errors,result.errors.length).join('\n')} label="複製錯誤訊息"/>
          <button type="button" className={primary} onClick={onCancel} data-autofocus>關閉</button>
        </>}
      </div>
    </div>
  </div>;
}

/** The first actions on an empty plan. It does not cover the canvas toolbar, and it lets clicks through around the card. */
export function EmptyPlanActions({onImport,onLoadSample,agentPrompt}) {
  return <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-4" data-empty-plan>
    <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-[#dce4ef] bg-white/95 p-5 text-center shadow-sm dark:border-[#3a4c67] dark:bg-[#18243a]/95">
      <h2 className="text-sm font-bold">開始一個平面圖</h2>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">匯入平面圖 JSON 檔案（也可以拖放到這裡），或先看看範例公寓。</p>
      <div className="mt-4 grid gap-2">
        <button type="button" className={primary} onClick={onImport}><FileUp className="size-4"/>匯入平面圖</button>
        <button type="button" className={secondary} onClick={onLoadSample}><Building2 className="size-4"/>載入範例公寓</button>
        <CopyButton text={agentPrompt} label="複製 AI 提示"/>
      </div>
      <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">把 AI 提示和平面圖圖片交給 AI 助理，它會回覆可匯入的 JSON。</p>
    </div>
  </div>;
}

/** Privacy text for each storage mode (roadmap B3, C3). */
export const PRIVACY_TEXT={
  website:'Open Plan 不會上傳你的圖片或平面圖。此網站版把資料存在這個瀏覽器中。你把圖片交給 AI 助理時，圖片由該助理處理。',
  file:'Open Plan 不會上傳你的圖片或平面圖。本機檔案模式把資料存在你電腦上的檔案中。你把圖片交給 AI 助理時，圖片由該助理處理。',
};

/** The agent prompt with its copy button and the privacy text, for the plan panel. */
export function AgentPromptCard({agentPrompt,mode}) {
  return <div className="workspace-card" data-agent-prompt>
    <h3 className="flex items-center gap-1.5"><Bot className="size-4"/>用 AI 助理產生平面圖</h3>
    <p className="workspace-help mt-1">複製提示，連同平面圖圖片交給 AI 助理，再匯入它回覆的 JSON。</p>
    <textarea readOnly value={agentPrompt} aria-label="AI 提示內容" className="mt-2 h-24 w-full resize-y rounded-lg border border-[#dce4ef] bg-slate-50 p-2 font-mono text-[10px] dark:border-[#3a4c67] dark:bg-[#101827]"/>
    <div className="mt-2 grid"><CopyButton text={agentPrompt} label="複製 AI 提示"/></div>
    <p className="workspace-help mt-2" data-privacy>{PRIVACY_TEXT[mode]}</p>
  </div>;
}

/**
 * Drag-and-drop of one file on an element. Returns true while a file is over it, for the overlay. Only drags that
 * carry files are taken, so dragging furniture or text inside the page is not changed.
 */
export function useFileDrop(ref,onFile) {
  const [over,setOver]=useState(false);
  const latest=useRef(onFile); latest.current=onFile;
  useEffect(()=>{
    const el=ref.current;if(!el)return;
    let depth=0;
    const hasFiles=e=>[...(e.dataTransfer?.types||[])].includes('Files');
    const enter=e=>{if(!hasFiles(e))return;e.preventDefault();depth++;setOver(true);};
    const overEvent=e=>{if(!hasFiles(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';};
    const leave=e=>{if(!hasFiles(e))return;depth=Math.max(0,depth-1);if(!depth)setOver(false);};
    const drop=e=>{if(!hasFiles(e))return;e.preventDefault();depth=0;setOver(false);const file=e.dataTransfer.files?.[0];if(file)latest.current(file);};
    el.addEventListener('dragenter',enter);el.addEventListener('dragover',overEvent);el.addEventListener('dragleave',leave);el.addEventListener('drop',drop);
    return ()=>{el.removeEventListener('dragenter',enter);el.removeEventListener('dragover',overEvent);el.removeEventListener('dragleave',leave);el.removeEventListener('drop',drop);};
  },[ref]);
  return over;
}

export function DropOverlay() {
  return <div className="pointer-events-none absolute inset-0 z-[55] grid place-items-center bg-[#4d72e1]/15 p-6" data-drop-overlay>
    <div className="rounded-2xl border-2 border-dashed border-[#4d72e1] bg-white/95 px-6 py-5 text-sm font-bold text-[#4d72e1] dark:bg-[#18243a]/95">放開以匯入平面圖 JSON</div>
  </div>;
}
