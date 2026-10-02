import { useEffect, useState } from 'react';

/**
 * Wall clock that re-renders about once a second while `untilMs` is in the
 * future (for live "try again in Ns" copy and re-enabling controls when a
 * 429 wait ends). Idle — no timer — when there is no wait.
 */
export function useWaitClock(untilMs: number | null | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (untilMs == null) return;
    const left = untilMs - Date.now();
    if (left <= 0) return;
    // Tick on the second boundary of the remaining wait, then once more at the end.
    const id = setTimeout(() => setNow(Date.now()), Math.min(1000, left % 1000 || 1000));
    return () => clearTimeout(id);
  }, [untilMs, now]);
  // Read the clock at render: `now` only drives the re-render.
  return Math.max(now, Date.now());
}
