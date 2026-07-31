import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Runs an async task and reports it as exactly one of four states:
 * `loading` | `empty` | `error` | `ready` (plus `idle` when disabled).
 *
 * The point of the hook is that *empty is part of the state machine*, not a
 * branch a caller can forget. Every list in the app therefore has to say what an
 * empty result looks like before it can render at all.
 *
 * `task` is the effect's dependency, so it must be stable — wrap it in
 * useCallback. An inline arrow re-runs the fetch on every render.
 *
 * ## Polling
 *
 * Pass `pollMs` to re-run the task on an interval. Those re-runs are
 * *background* fetches, which is a different thing from the first one:
 *
 * - they never set `loading`, so the view does not blink every few seconds;
 * - they never clear the data on failure. Losing a conversation you were
 *   reading because one poll timed out is worse than showing it slightly
 *   behind, so a failed refresh sets `stale` and leaves the last good data up.
 *   Only the foreground fetch may replace the screen with an error;
 * - they pause while the tab is hidden, and fire once on the way back, so a
 *   forgotten tab is not still polling tomorrow morning;
 * - they never stack. A slow response holds the next tick off rather than
 *   queueing behind it.
 */
export default function useAsync(task, { enabled = true, pollMs = 0 } = {}) {
  const [state, setState] = useState({
    status: enabled ? 'loading' : 'idle',
    data: null,
    error: null,
    stale: false,
  });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // One request at a time, so a slow task cannot have polls pile up behind it.
  const inFlight = useRef(false);

  const load = useCallback(
    async ({ background = false } = {}) => {
      if (!enabled) {
        setState({ status: 'idle', data: null, error: null, stale: false });
        return;
      }

      if (inFlight.current && background) return;
      inFlight.current = true;

      if (!background) {
        setState((current) => ({ ...current, status: 'loading', error: null, stale: false }));
      }

      try {
        const data = await task();
        if (!mounted.current) return;

        // An empty array is a distinct outcome, not a boring success.
        const isEmpty = Array.isArray(data) && data.length === 0;
        setState({ status: isEmpty ? 'empty' : 'ready', data, error: null, stale: false });
      } catch (error) {
        if (!mounted.current) return;

        if (background) {
          // Keep what is on screen; just admit it may be behind.
          setState((current) => ({ ...current, stale: true }));
        } else {
          setState({ status: 'error', data: null, error, stale: false });
        }
      } finally {
        inFlight.current = false;
      }
    },
    [task, enabled]
  );

  const run = useCallback(() => load(), [load]);
  const refresh = useCallback(() => load({ background: true }), [load]);

  useEffect(() => {
    run();
  }, [run]);

  useEffect(() => {
    if (!enabled || !pollMs) return undefined;

    const id = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      refresh();
    }, pollMs);

    // Coming back to the tab should not mean waiting out a whole interval.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [refresh, enabled, pollMs]);

  return { ...state, retry: run, refresh };
}
