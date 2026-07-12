import { useCallback, useEffect, useRef, useState } from 'react';
import type { WrenResponse } from '@wren/core';
import { useWren } from './useWren.js';

export interface UseQueryResult {
  query: (text: string) => Promise<WrenResponse | undefined>;
  response: WrenResponse | undefined;
  loading: boolean;
  error: Error | null;
  cancel: () => void;
}

/** Runs the dispatcher for one query at a time: a new query() call cancels whatever is still in flight, and unmount cancels the last one. */
export function useQuery(): UseQueryResult {
  const { wren } = useWren();
  const [response, setResponse] = useState<WrenResponse | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const controllerRef = useRef<AbortController | undefined>(undefined);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const query = useCallback(
    async (text: string): Promise<WrenResponse | undefined> => {
      if (!wren) return undefined;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setLoading(true);
      setError(null);
      try {
        const result = await wren.query(text, { signal: controller.signal });
        if (controllerRef.current !== controller) return undefined;
        setResponse(result);
        return result;
      } catch (err) {
        if (controllerRef.current !== controller) return undefined;
        setError(err instanceof Error ? err : new Error(String(err)));
        return undefined;
      } finally {
        if (controllerRef.current === controller) setLoading(false);
      }
    },
    [wren],
  );

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  return { query, response, loading, error, cancel };
}
