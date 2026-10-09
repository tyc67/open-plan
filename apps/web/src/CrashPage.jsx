import React from 'react';
import { savedDocumentText, setAsideSavedDocument } from './floorplan/storage.js';

// The page shown when the editor cannot render. Website mode and local file mode keep their plans in different places
// (browser storage, or the plan file that `serve` opened), so each mode has its own page and acts only on its own place.

function downloadSaved() {
  const text = savedDocumentText();
  if (!text) return;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: 'open-plan-saved.json' });
  link.click();
  URL.revokeObjectURL(url);
}
function startOver() {
  if (setAsideSavedDocument()) location.reload();
  else alert('無法備份目前的資料，因此未清除。請先下載已儲存資料。');
}
const button = 'rounded-lg border border-slate-300 px-3 py-2 text-sm';

/** `fileMode`: the editor was opened by `serve` for a plan file; nothing here reads or changes browser storage. */
export default function CrashPage({ error, fileMode }) {
  return <main role="alert" className="mx-auto max-w-lg space-y-4 p-6 text-slate-800">
    <h1 className="text-lg font-bold">Open Plan 發生錯誤</h1>
    {fileMode
      ? <p className="text-sm">畫面無法顯示。平面圖檔案保留最後一次成功儲存的版本；尚未儲存的編輯可能已遺失。重新載入後，編輯器會再從檔案開啟。</p>
      : <p className="text-sm">畫面無法顯示。已儲存的平面圖仍在此瀏覽器內。請先下載已儲存資料，再重新載入或改用新的平面圖。</p>}
    <p className="text-xs text-slate-500">{error.message}</p>
    <div className="flex flex-wrap gap-2">
      {!fileMode && <button type="button" className={button} onClick={downloadSaved}>下載已儲存資料</button>}
      <button type="button" className={button} onClick={() => location.reload()}>重新載入</button>
      {!fileMode && <button type="button" className={button} onClick={startOver}>備份後改用新的平面圖</button>}
    </div>
  </main>;
}
