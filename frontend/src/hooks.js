import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/** Loads data from the API and re-runs whenever `deps` change. */
export function useApi(path, params, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const key = JSON.stringify([path, params]);
  const counter = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const id = ++counter.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api(path, { params });
      if (id === counter.current) setState({ data, loading: false, error: null });
    } catch (error) {
      if (id === counter.current) setState({ data: null, loading: false, error });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load, setData: (data) => setState((s) => ({ ...s, data })) };
}
