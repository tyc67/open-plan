import React from 'react';
import { createRoot } from 'react-dom/client';
import FloorPlanEditor from './floorplan/FloorPlanEditor.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import CrashPage from './CrashPage.jsx';
import { fileModeToken, openFileSession } from './floorplan/fileSession.js';
import './style.css';

function FileModeError({ message }) {
  return <main role="alert" className="mx-auto max-w-lg space-y-4 p-6 text-slate-800">
    <h1 className="text-lg font-bold">無法開啟本機檔案</h1>
    <p className="text-sm">{message}</p>
  </main>;
}
const root = createRoot(document.getElementById('root'));
const start = fileSession => root.render(<React.StrictMode><ErrorBoundary fallback={error => <CrashPage error={error} fileMode={Boolean(fileSession)}/>}><FloorPlanEditor fileSession={fileSession}/></ErrorBoundary></React.StrictMode>);
// Local file mode (roadmap C3): `serve` opens the editor with a token in the URL fragment. Website mode has none.
const token = fileModeToken();
if (token) openFileSession(token).then(start, error => root.render(<FileModeError message={error.message}/>));
else start(null);
