import { useCallback, useState } from 'react';
import type { IngestOptions, IngestProgress, IngestResult, WrenSource } from '@wren/core';
import { notifyDocumentsChanged } from './documentsBus.js';
import { useWren } from './useWren.js';

export interface UseIngestResult {
  ingest: (source: WrenSource, opts?: IngestOptions) => Promise<IngestResult | undefined>;
  progress: IngestProgress | undefined;
  loading: boolean;
  error: Error | null;
}

/** Wraps Wren.ingest(), tracking its progress events as React state and notifying useDocuments to refetch once it succeeds. */
export function useIngest(): UseIngestResult {
  const { wren } = useWren();
  const [progress, setProgress] = useState<IngestProgress | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const ingest = useCallback(
    async (source: WrenSource, opts: IngestOptions = {}): Promise<IngestResult | undefined> => {
      if (!wren) return undefined;
      setLoading(true);
      setError(null);
      setProgress(undefined);
      try {
        const result = await wren.ingest(source, {
          ...opts,
          onProgress: (current) => {
            setProgress(current);
            opts.onProgress?.(current);
          },
        });
        notifyDocumentsChanged(wren);
        return result;
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [wren],
  );

  return { ingest, progress, loading, error };
}
