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
 */
export default function useAsync(task, { enabled = true } = {}) {
  const [state, setState] = useState({
    status: enabled ? 'loading' : 'idle',
    data: null,
    error: null,
  });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (!enabled) {
      setState({ status: 'idle', data: null, error: null });
      return;
    }

    setState((current) => ({ ...current, status: 'loading', error: null }));

    try {
      const data = await task();
      if (!mounted.current) return;

      // An empty array is a distinct outcome, not a boring success.
      const isEmpty = Array.isArray(data) && data.length === 0;
      setState({ status: isEmpty ? 'empty' : 'ready', data, error: null });
    } catch (error) {
      if (!mounted.current) return;
      setState({ status: 'error', data: null, error });
    }
  }, [task, enabled]);

  useEffect(() => {
    run();
  }, [run]);

  return { ...state, retry: run };
}
