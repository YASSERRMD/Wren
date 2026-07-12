import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IngestProgress, IngestResult, ProgressCallback, WrenSource } from '@wren/core';
import { readyValue, wrapperFor } from './test-support/contextWrapper.js';
import { useIngest } from './useIngest.js';

describe('useIngest', () => {
  it('tracks progress events and resolves with the ingest result', async () => {
    const wren = {
      ingest: vi.fn(async (_source: WrenSource, opts: { onProgress?: ProgressCallback }) => {
        const steps: IngestProgress[] = [
          { phase: 'parsing', current: 1, total: 1 },
          { phase: 'labelling', current: 1, total: 1 },
          { phase: 'indexing', current: 1, total: 1 },
        ];
        for (const step of steps) opts.onProgress?.(step);
        const result: IngestResult = { docId: 'd1', sectionCount: 1, warnings: [], labelStrategy: 'heuristic', durationMs: 1 };
        return result;
      }),
    } as never;

    const { result } = renderHook(() => useIngest(), { wrapper: wrapperFor(readyValue(wren)) });

    let ingestResult: IngestResult | undefined;
    await act(async () => {
      ingestResult = await result.current.ingest({ type: 'text', title: 'Doc', content: 'x' });
    });

    expect(ingestResult?.docId).toBe('d1');
    expect(result.current.progress).toEqual({ phase: 'indexing', current: 1, total: 1 });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('surfaces a thrown error', async () => {
    const wren = { ingest: vi.fn(async () => { throw new Error('parse failed'); }) } as never;
    const { result } = renderHook(() => useIngest(), { wrapper: wrapperFor(readyValue(wren)) });

    await act(async () => {
      await result.current.ingest({ type: 'text', title: 'Doc', content: 'x' });
    });

    expect(result.current.error?.message).toBe('parse failed');
    expect(result.current.loading).toBe(false);
  });
});
