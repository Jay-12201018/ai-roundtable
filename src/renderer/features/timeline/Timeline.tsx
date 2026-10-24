import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown } from 'lucide-react';
import { TimelineHoldContext } from './hold';

export type TimelineItem = { key: string; render: () => ReactNode };
/** Below this many slots everything renders (the common case); above it only what is near the viewport. */
export const VIRTUALIZE_AT = 150;
const ESTIMATE = 180, OVERSCAN = 1200, BOTTOM_SLACK = 48;
/** Reading positions survive switching to another discussion and back (per window, not persisted). */
const positions = new Map<string, number>();

type Props = {
  /** Identifies the discussion; the reading position is kept per key. */
  viewKey: string;
  items: TimelineItem[];
  /** Changes whenever content may have grown (sequence, streamed text); drives following and the new-content pill. */
  contentVersion: string | number;
  header?: ReactNode; footer?: ReactNode; label: string;
};

/**
 * The reading column. While the host is at the bottom it follows new output; scrolling up, selecting text, editing
 * or looking at an older version stops following, and a 「有新消息 · 回到最新」 pill appears instead of jumping.
 * Long histories are windowed with measured heights keyed by slotId, so the DOM stays bounded.
 */
export function Timeline({ viewKey, items, contentVersion, header, footer, label }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const holds = useRef(0);
  const [fresh, setFresh] = useState(false);
  const [, setTick] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  const heights = useRef(new Map<string, number>());
  const virtual = items.length > VIRTUALIZE_AT;
  const selecting = useRef(false);

  const following = () => atBottom.current && holds.current === 0 && !selecting.current;
  const stick = useCallback(() => {
    const element = scroller.current; if (!element) return;
    element.scrollTop = element.scrollHeight;
    // Re-window at once rather than waiting for the scroll event, so the newest messages are rendered right away.
    atBottom.current = true; setFresh(false); setScrollTop(element.scrollTop);
  }, []);
  const hold = useMemo(() => ({ hold: () => { holds.current++; return () => { holds.current = Math.max(0, holds.current - 1); }; } }), []);

  // Restore the remembered position for this discussion, or start at the latest message.
  useLayoutEffect(() => {
    const element = scroller.current; if (!element) return;
    const saved = positions.get(viewKey);
    if (saved === undefined) stick();
    else { element.scrollTop = saved; atBottom.current = element.scrollHeight - saved - element.clientHeight < BOTTOM_SLACK; }
    setScrollTop(element.scrollTop); setViewport(element.clientHeight); setFresh(false);
  }, [viewKey, stick]);

  // New content: follow when reading at the bottom, otherwise offer a way back without moving the page.
  useLayoutEffect(() => {
    if (following()) stick(); else setFresh(true);
  }, [contentVersion]);

  useEffect(() => {
    const element = scroller.current; if (!element) return;
    const onSelection = () => {
      const selection = document.getSelection();
      selecting.current = !!selection && !selection.isCollapsed && element.contains(selection.anchorNode);
    };
    document.addEventListener('selectionchange', onSelection);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { setViewport(element.clientHeight); if (following()) stick(); }) : undefined;
    observer?.observe(element);
    return () => { document.removeEventListener('selectionchange', onSelection); observer?.disconnect(); };
  }, [stick]);

  const onScroll = () => {
    const element = scroller.current!;
    atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_SLACK;
    if (atBottom.current) setFresh(false);
    positions.set(viewKey, element.scrollTop);
    if (virtual) setScrollTop(element.scrollTop);
  };

  // Window: offsets from measured (or estimated) heights; the list's own offset inside the scroller is subtracted.
  let start = 0, end = items.length, before = 0, after = 0;
  if (virtual) {
    const offset = list.current?.offsetTop ?? 0;
    const top = scrollTop - offset - OVERSCAN, bottom = scrollTop - offset + (viewport || 800) + OVERSCAN;
    let y = 0; start = -1; end = items.length;
    for (let index = 0; index < items.length; index++) {
      const height = heights.current.get(items[index].key) ?? ESTIMATE;
      if (start < 0 && y + height >= top) { start = index; before = y; }
      if (start >= 0 && y > bottom) { end = index; break; }
      y += height;
    }
    if (start < 0) { start = Math.max(0, items.length - 1); before = y - (heights.current.get(items[start]?.key) ?? ESTIMATE); }
    for (let index = end; index < items.length; index++) after += heights.current.get(items[index].key) ?? ESTIMATE;
  }
  const measure = useCallback((key: string, height: number) => {
    if (heights.current.get(key) === height) return;
    heights.current.set(key, height);
    setTick(value => value + 1);
    if (following()) requestAnimationFrame(stick);
  }, [stick]);

  return <TimelineHoldContext.Provider value={hold}>
    <div className="timeline-wrap">
      <div ref={scroller} className="timeline-scroll" onScroll={onScroll} tabIndex={-1} role="region" aria-label={label}>
        <div className="thread">
          {header}
          <div ref={list} className="thread-list" data-virtual={virtual || undefined} data-rendered={end - start}>
            {virtual && <div aria-hidden style={{ height: before }} />}
            {items.slice(start, end).map(item => virtual
              ? <Measured key={item.key} id={item.key} onHeight={measure}>{item.render()}</Measured>
              : <div key={item.key} className="thread-item">{item.render()}</div>)}
            {virtual && <div aria-hidden style={{ height: after }} />}
          </div>
          {footer}
        </div>
      </div>
      {fresh && <button type="button" className="jump-latest" onClick={stick}><ArrowDown aria-hidden size={14} />有新消息 · 回到最新</button>}
    </div>
  </TimelineHoldContext.Provider>;
}

function Measured({ id, onHeight, children }: { id: string; onHeight: (key: string, height: number) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current; if (!element) return;
    onHeight(id, element.offsetHeight);
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => onHeight(id, element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, [id, onHeight]);
  return <div ref={ref} className="thread-item" data-key={id}>{children}</div>;
}
