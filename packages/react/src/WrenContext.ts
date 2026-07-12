import { createContext } from 'react';
import type { Wren } from '@wren/core';

/**
 * `'initialising'` while Wren.create() is in flight, `'unsupported'` when
 * this browser lacks OPFS/Worker storage support, `'error'` when creation
 * itself threw (for example, Nano is genuinely unavailable), `'ready'`
 * once `wren` is safe to use.
 */
export type WrenStatus = 'initialising' | 'ready' | 'unsupported' | 'error';

export interface WrenContextValue {
  wren: Wren | null;
  status: WrenStatus;
  error: Error | null;
}

export const WrenContext = createContext<WrenContextValue | undefined>(undefined);
