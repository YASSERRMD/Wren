import type { ReactNode } from 'react';
import { WrenContext, type WrenContextValue } from '../WrenContext.js';

/** A React Testing Library `wrapper` that puts a fixed WrenContext value in scope, bypassing WrenProvider's own async creation. */
export function wrapperFor(value: WrenContextValue) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <WrenContext.Provider value={value}>{children}</WrenContext.Provider>;
  };
}

export function readyValue(wren: WrenContextValue['wren']): WrenContextValue {
  return { wren, status: 'ready', error: null };
}
