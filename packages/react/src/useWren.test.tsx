import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readyValue, wrapperFor } from './test-support/contextWrapper.js';
import { useWren } from './useWren.js';

describe('useWren', () => {
  it('throws when called outside a WrenProvider', () => {
    expect(() => renderHook(() => useWren())).toThrow('useWren must be called within a <WrenProvider>');
  });

  it('returns the current context value inside a provider', () => {
    const fakeWren = {} as never;
    const { result } = renderHook(() => useWren(), { wrapper: wrapperFor(readyValue(fakeWren)) });

    expect(result.current).toEqual({ wren: fakeWren, status: 'ready', error: null });
  });
});
