import { useCallback, useEffect, useState } from 'react';
import type { WrenDocument } from '@wren/core';
import { notifyDocumentsChanged, subscribeToDocumentChanges } from './documentsBus.js';
import { useWren } from './useWren.js';

export interface UseDocumentsResult {
  documents: WrenDocument[];
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  /** Deletes a document and refetches, so callers do not have to remember to call refresh() themselves. */
  deleteDocument: (id: string) => Promise<void>;
}

/** The document list, kept in sync with useIngest and its own deleteDocument, in this component and any other useDocuments watching the same Wren. */
export function useDocuments(): UseDocumentsResult {
  const { wren } = useWren();
  const [documents, setDocuments] = useState<WrenDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!wren) return;
    setLoading(true);
    setError(null);
    try {
      setDocuments(await wren.listDocuments());
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [wren]);

  const deleteDocument = useCallback(
    async (id: string): Promise<void> => {
      if (!wren) return;
      await wren.deleteDocument(id);
      notifyDocumentsChanged(wren);
    },
    [wren],
  );

  useEffect(() => {
    void refresh();
    if (!wren) return undefined;
    return subscribeToDocumentChanges(wren, () => {
      void refresh();
    });
  }, [wren, refresh]);

  return { documents, loading, error, refresh, deleteDocument };
}
