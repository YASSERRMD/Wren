import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WrenResponse } from '@wren/core';
import { readyValue, wrapperFor } from './test-support/contextWrapper.js';
import { useQuery } from './useQuery.js';

function response(answer: string): WrenResponse {
  return { answer, action: 'answer', citations: [], hops: 0, durationMs: 1, warnings: [] };
}

describe('useQuery', () => {
  it('runs a query and returns the response', async () => {
    const wren = { query: vi.fn(async () => response('hi there')) } as never;
    const { result } = renderHook(() => useQuery(), { wrapper: wrapperFor(readyValue(wren)) });

    await act(async () => {
      await result.current.query('hello');
    });

    expect(result.current.response?.answer).toBe('hi there');
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('cancels the previous query when a new one starts', async () => {
    let resolveFirst!: (value: WrenResponse) => void;
    const first = new Promise<WrenResponse>((resolve) => {
      resolveFirst = resolve;
    });
    const wren = {
      query: vi.fn((text: string) => (text === 'first' ? first : Promise.resolve(response('second')))),
    } as never;

    const { result } = renderHook(() => useQuery(), { wrapper: wrapperFor(readyValue(wren)) });

    let firstPromise!: Promise<WrenResponse | undefined>;
    act(() => {
      firstPromise = result.current.query('first');
    });
    await act(async () => {
      await result.current.query('second');
    });

    expect(result.current.response?.answer).toBe('second');
    const firstCallOpts = (wren as { query: ReturnType<typeof vi.fn> }).query.mock.calls[0][1];
    expect(firstCallOpts.signal.aborted).toBe(true);

    resolveFirst(response('first'));
    await firstPromise;
    expect(result.current.response?.answer).toBe('second');
  });

  it('cancels the in-flight query on unmount', async () => {
    let capturedSignal!: AbortSignal;
    const wren = {
      query: vi.fn((_text: string, opts: { signal: AbortSignal }) => {
        capturedSignal = opts.signal;
        return new Promise<WrenResponse>(() => {});
      }),
    } as never;

    const { result, unmount } = renderHook(() => useQuery(), { wrapper: wrapperFor(readyValue(wren)) });

    act(() => {
      void result.current.query('anything');
    });
    await waitFor(() => expect(capturedSignal).toBeDefined());

    unmount();

    expect(capturedSignal.aborted).toBe(true);
  });
});
