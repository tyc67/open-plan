// Adapted from Mamezu workspace UI.
import React from 'react';
import { Layers3, History } from 'lucide-react';

const defaultTabs = [['layers', Layers3, '圖層'], ['history', History, '歷史紀錄']];

export default function PanelRail({ open, tab, onSelect, onClose, side = 'right', tabs = defaultTabs }) {
  const t = (label, values = {}) => label.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? '');
  return <div data-panel-rail={side} role="tablist" aria-label={side === "left" ? t("左側設定分頁") : t("右側面板分頁")} aria-orientation="vertical" className={"z-50 flex w-11 shrink-0 flex-col items-center gap-2 border-slate-200 bg-white py-3 dark:border-slate-700 dark:bg-[#18243a] " + (side === "left" ? "border-r" : "border-l")}>
    {tabs.map(([id, Icon, label]) => {
      const active = open && tab === id;
      return <button key={id} id={`${id}-tab`} type="button" role="tab" aria-label={t(label)} aria-selected={active} aria-expanded={active} aria-controls={`${id}-content`} tabIndex={tab === id ? 0 : -1} data-tooltip={active ? t("收合{{v0}}", { v0: t(label) }) : t(label)} onClick={() => active ? onClose() : onSelect(id)} onKeyDown={event => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const index = tabs.findIndex(item => item[0] === id);
        const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + tabs.length) % tabs.length][0];
        onSelect(next); document.getElementById(`${next}-tab`)?.focus();
      }} className={'relative grid size-9 place-items-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 motion-reduce:transition-none ' + (active ? (side === 'left' ? 'before:-right-1 ' : 'before:-left-1 ') + 'bg-blue-50 text-blue-600 before:absolute before:h-5 before:w-0.5 before:rounded-full before:bg-blue-500 dark:bg-[#263b6a] dark:text-blue-200' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700')}><Icon className="size-[18px]" aria-hidden="true" /></button>;
    })}
  </div>;
}
