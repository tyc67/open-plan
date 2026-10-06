// Adapted from Mamezu workspace UI.
import React, { useEffect, useState } from 'react';

// Delegation keeps tooltips outside scrolling toolbars and inside the fullscreen root.
export default function ToolbarHints({ rootRef }) {
  const [hint, setHint] = useState(null);
  useEffect(() => {
    const root = rootRef.current;
    let active = null;
    function close() { active?.removeAttribute('aria-describedby'); active = null; setHint(null); }
    function show(event) {
      if (event.pointerType === 'touch') return;
      const button = event.target.closest?.('button');
      if (!button || !button.closest('header, [role="toolbar"], [data-canvas-view-controls], [data-panel-rail], #layers-panel, #settings-sidebar')) return;
      if (button.closest('[data-storage-menu]') || button.getAttribute('aria-expanded') === 'true') { close(); return; }
      const text = button.getAttribute('title') || button.dataset.tooltip || button.getAttribute('aria-label') || button.textContent;
      if (!text) return;
      close(); active = button;
      if (button.hasAttribute('title')) { button.dataset.tooltip = text; button.removeAttribute('title'); }
      button.setAttribute('aria-describedby', 'toolbar-hint');
      const rect = button.getBoundingClientRect();
      const rail = button.closest('[data-panel-rail]');
      if (rail) {
        const toRight = rail.dataset.panelRail === 'left';
        setHint({ text, side: true, toRight, left: toRight ? rect.right + 8 : rect.left - 8, top: rect.top + rect.height / 2 });
        return;
      }
      setHint({ text, left: Math.max(8, Math.min(window.innerWidth - 248, rect.left)), top: rect.bottom + 8, above: rect.bottom > window.innerHeight - 70, bottom: window.innerHeight - rect.top + 8 });
    }
    function keydown(event) { if (event.key === 'Escape') close(); }
    const observer = new MutationObserver(() => {
      if (!active) return;
      if (active.getAttribute('aria-expanded') === 'true') { close(); return; }
      const text = active.getAttribute('title') || active.dataset.tooltip || active.getAttribute('aria-label') || active.textContent;
      setHint(value => value && ({ ...value, text }));
    });
    observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['data-tooltip', 'title', 'aria-label', 'aria-expanded'] });
    function leave(event) { if (active && !active.contains(event.relatedTarget)) close(); }
    root.addEventListener('pointerover', show); root.addEventListener('focusin', show);
    root.addEventListener('pointerout', leave); root.addEventListener('focusout', leave);
    root.addEventListener('pointerdown', close); root.addEventListener('scroll', close, true);
    window.addEventListener('resize', close); window.addEventListener('keydown', keydown);
    return () => { observer.disconnect(); close(); root.removeEventListener('pointerover', show); root.removeEventListener('focusin', show); root.removeEventListener('pointerout', leave); root.removeEventListener('focusout', leave); root.removeEventListener('pointerdown', close); root.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); window.removeEventListener('keydown', keydown); };
  }, [rootRef]);
  return hint && <div id="toolbar-hint" role="tooltip" className="pointer-events-none fixed z-[100] w-max max-w-60 rounded-md bg-[#1b2840] px-2.5 py-1.5 text-xs text-white shadow-lg dark:bg-[#e9eff9] dark:text-[#1b2840]" style={{ left: hint.left, ...(hint.side ? { top: hint.top, transform: hint.toRight ? "translateY(-50%)" : "translate(-100%, -50%)" } : hint.above ? { bottom: hint.bottom } : { top: hint.top }) }}>{hint.text}</div>;
}
