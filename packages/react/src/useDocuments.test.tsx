import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProgressCallback, WrenDocument, WrenSource } from '@wren/core';
import { WrenContext } from './WrenContext.js';
import { readyValue } from './test-support/contextWrapper.js';
import { useDocuments, type UseDocumentsResult } from './useDocuments.js';
import { useIngest } from './useIngest.js';

function doc(id: string): WrenDocument {
  return { id, title: id, sourceType: 'text', createdAt: '2026-01-01T00:00:00.000Z' };
}

describe('useDocuments', () => {
  it('fetches on mount and refresh() re-fetches', async () => {
    let documents = [doc('a')];
    const wren = { listDocuments: vi.fn(async () => documents) } as never;

    let api!: UseDocumentsResult;
    function Probe() {
      api = useDocuments();
      return null;
    }
    render(
      <WrenContext.Provider value={readyValue(wren)}>
        <Probe />
      </WrenContext.Provider>,
    );

    await waitFor(() => expect(api.documents).toEqual([doc('a')]));

    documents = [doc('a'), doc('b')];
    await act(async () => {
      await api.refresh();
    });
    expect(api.documents).toEqual([doc('a'), doc('b')]);
  });

  it('deleteDocument deletes and refetches', async () => {
    let documents = [doc('a'), doc('b')];
    const wren = {
      listDocuments: vi.fn(async () => documents),
      deleteDocument: vi.fn(async (id: string) => {
        documents = documents.filter((d) => d.id !== id);
      }),
    } as never;

    let api!: UseDocumentsResult;
    function Probe() {
      api = useDocuments();
      return null;
    }
    render(
      <WrenContext.Provider value={readyValue(wren)}>
        <Probe />
      </WrenContext.Provider>,
    );
    await waitFor(() => expect(api.documents).toHaveLength(2));

    await act(async () => {
      await api.deleteDocument('a');
    });
    expect(api.documents).toEqual([doc('b')]);
  });

  it('refetches after a useIngest call succeeds on the same Wren instance', async () => {
    let documents = [doc('a')];
    const wren = {
      listDocuments: vi.fn(async () => documents),
      ingest: vi.fn(async (_source: WrenSource, opts: { onProgress?: ProgressCallback }) => {
        opts.onProgress?.({ phase: 'indexing', current: 1, total: 1 });
        documents = [...documents, doc('b')];
        return { docId: 'b', sectionCount: 1, warnings: [], labelStrategy: 'heuristic' as const, durationMs: 1 };
      }),
    } as never;

    let documentsApi!: UseDocumentsResult;
    let ingest!: (source: WrenSource) => Promise<unknown>;
    function Probe() {
      documentsApi = useDocuments();
      ingest = useIngest().ingest;
      return null;
    }
    render(
      <WrenContext.Provider value={readyValue(wren)}>
        <Probe />
      </WrenContext.Provider>,
    );
    await waitFor(() => expect(documentsApi.documents).toHaveLength(1));

    await act(async () => {
      await ingest({ type: 'text', title: 'B', content: 'x' });
    });

    expect(documentsApi.documents.map((d) => d.id)).toEqual(['a', 'b']);
  });
});
