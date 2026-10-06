import React from 'react';
import { createRoot } from 'react-dom/client';
import FloorPlanEditor from './floorplan/FloorPlanEditor.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import { savedDocumentText, setAsideSavedDocument } from './floorplan/storage.js';
import './style.css';

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
function AppCrash({ error }) {
  const button = 'rounded-lg border border-slate-300 px-3 py-2 text-sm';
  return <main role="alert" className="mx-auto max-w-lg space-y-4 p-6 text-slate-800">
    <h1 className="text-lg font-bold">Open Plan 發生錯誤</h1>
    <p className="text-sm">畫面無法顯示。已儲存的平面圖仍在此瀏覽器內。請先下載已儲存資料，再重新載入或改用新的平面圖。</p>
    <p className="text-xs text-slate-500">{error.message}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} onClick={downloadSaved}>下載已儲存資料</button>
      <button type="button" className={button} onClick={() => location.reload()}>重新載入</button>
      <button type="button" className={button} onClick={startOver}>備份後改用新的平面圖</button>
    </div>
  </main>;
}
createRoot(document.getElementById('root')).render(<React.StrictMode><ErrorBoundary fallback={error => <AppCrash error={error}/>}><FloorPlanEditor /></ErrorBoundary></React.StrictMode>);
