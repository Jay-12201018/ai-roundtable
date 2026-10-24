import { createContext, useContext, useEffect } from 'react';

/** Reading an older version (or editing) tells the timeline to stop following new output until it is done. */
export const TimelineHoldContext = createContext<{ hold(): () => void } | null>(null);
export function useTimelineHold(active: boolean) {
  const context = useContext(TimelineHoldContext);
  useEffect(() => (active && context ? context.hold() : undefined), [active, context]);
}
