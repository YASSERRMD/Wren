import { useContext } from 'react';
import { WrenContext, type WrenContextValue } from './WrenContext.js';

/** Reads the current Wren instance and its creation status. Must be called under a WrenProvider. */
export function useWren(): WrenContextValue {
  const value = useContext(WrenContext);
  if (!value) {
    throw new Error('useWren must be called within a <WrenProvider>');
  }
  return value;
}
