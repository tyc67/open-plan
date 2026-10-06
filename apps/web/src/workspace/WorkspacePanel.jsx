// Adapted from Mamezu workspace UI.
import React from 'react';

export default function WorkspacePanel({ id, active, children }) {
  return <section id={`${id}-content`} role="tabpanel" aria-labelledby={`${id}-tab`} hidden={!active} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">{children}</section>;
}
