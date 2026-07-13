import { useCallback, useEffect, useRef, useState } from 'react';
import type { WrenResponse } from '@wren/core';
import { useWren } from './useWren.js';

export interface UseStreamingQueryResult {
  query: (text: string) => Promise<void>;
  response: Partial<WrenResponse> | undefined;
  loading: boolean;
  error: Error | null;
  cancel: () => void;
}

/** Same cancellation contract as useQuery, but response.answer accumulates as Wren streams it in. */
export function useStreamingQuery(): UseStreamingQueryResult {
  const { wren } = useWren();
  const [response, setResponse] = useState<Partial<WrenResponse> | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const controllerRef = useRef<AbortController | undefined>(undefined);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  const query = useCallback(
    async (text: string): Promise<void> => {
      if (!wren) return;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      setLoading(true);
      setError(null);
      setResponse(undefined);
      try {
        for await (const partial of wren.queryStreaming(text, { signal: controller.signal })) {
          if (controllerRef.current !== controller) return;
          setResponse(partial);
        }
      } catch (err) {
        if (controllerRef.current !== controller) return;
        setError(err instanceof Error ? err : new Error(String(err)));
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
