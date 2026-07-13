import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { readyValue, wrapperFor } from './test-support/contextWrapper.js';
import { useStreamingQuery } from './useStreamingQuery.js';

async function* chunks(parts: string[]) {
  let accumulated = '';
  for (const part of parts) {
    accumulated += part;
    yield { answer: accumulated, action: 'answer' as const, citations: [], hops: 0, durationMs: 1, warnings: [] };
  }
}

describe('useStreamingQuery', () => {
  it('accumulates response.answer across streamed chunks', async () => {
    const wren = { queryStreaming: vi.fn(() => chunks(['Hello', ' world', '!'])) } as never;
    const { result } = renderHook(() => useStreamingQuery(), { wrapper: wrapperFor(readyValue(wren)) });

    await act(async () => {
      await result.current.query('hi');
    });

    expect(result.current.response?.answer).toBe('Hello world!');
    expect(result.current.loading).toBe(false);
  });

  it('cancels the previous stream when a new query starts', async () => {
    const wren = {
      queryStreaming: vi.fn((text: string) => (text === 'first' ? chunks(['never', ' seen']) : chunks(['second']))),
    } as never;
    const { result } = renderHook(() => useStreamingQuery(), { wrapper: wrapperFor(readyValue(wren)) });

    await act(async () => {
      void result.current.query('first');
      await result.current.query('second');
    });

    expect(result.current.response?.answer).toBe('second');
  });
});
