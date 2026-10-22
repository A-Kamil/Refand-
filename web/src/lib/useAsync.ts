import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api';

export type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError | Error }
  | { status: 'ready'; data: T };

/** Charge une donnée ; `reload()` relance. Ignore les réponses obsolètes. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading' });
  const run = useRef(0);

  const load = useCallback(() => {
    const id = ++run.current;
    setState({ status: 'loading' });
    fn().then(
      (data) => id === run.current && setState({ status: 'ready', data }),
      (error) => id === run.current && setState({ status: 'error', error }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
    return () => {
      run.current++;
    };
  }, [load]);

  return { state, reload: load };
}
