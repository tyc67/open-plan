// Adapted from Mamezu workspace UI.
import React, { useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function ScrollToolbar({ children, className = '', contentClassName = '', ...props }) {
  const viewport = useRef(null), content = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  function measure() {
    const el = viewport.current;
    if (!el) return;
    const next = { left: el.scrollLeft > 1, right: el.scrollWidth - el.clientWidth - el.scrollLeft > 1 };
    setEdges(old => old.left === next.left && old.right === next.right ? old : next);
  }
  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure);
    observer.observe(viewport.current); observer.observe(content.current); measure();
    return () => observer.disconnect();
  }, []);
  const move = direction => viewport.current.scrollBy({ left: direction * Math.max(100, viewport.current.clientWidth * .7), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  return <div {...props} className={'min-w-0 ' + className}>
    <div className="relative min-w-0 max-w-full">
      <div ref={viewport} data-toolbar-scroll onScroll={measure} className="max-w-full overflow-x-auto overscroll-x-contain">
        <div ref={content} className={'flex w-max min-w-full flex-nowrap items-center gap-1 [&>button]:shrink-0 [&>span]:shrink-0 ' + contentClassName}>{children}</div>
      </div>
      {edges.left && <button type="button" aria-label={'向左捲動工具列'} title={'向左捲動工具列'} onClick={() => move(-1)} className="absolute inset-y-0 left-0 z-10 flex w-8 items-center justify-start bg-gradient-to-r from-white via-white/95 to-transparent text-blue-600 dark:from-[#18243a] dark:via-[#18243a]/95 dark:text-blue-300"><ChevronLeft className="size-5" /></button>}
      {edges.right && <button type="button" aria-label={'向右捲動工具列'} title={'向右捲動工具列'} onClick={() => move(1)} className="absolute inset-y-0 right-0 z-10 flex w-8 items-center justify-end bg-gradient-to-l from-white via-white/95 to-transparent text-blue-600 dark:from-[#18243a] dark:via-[#18243a]/95 dark:text-blue-300"><ChevronRight className="size-5" /></button>}
    </div>
  </div>;
}
