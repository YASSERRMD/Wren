import { useEffect, useState, type PropsWithChildren } from 'react';
import { Wren, type WrenOptions } from '@wren/core';
import { WrenContext, type WrenContextValue } from './WrenContext.js';

export type WrenProviderProps = PropsWithChildren<WrenOptions>;

/**
 * Creates one `Wren` instance for its subtree, exposing it (and the
 * loading/error state around its async creation) via context. Destroys
 * the instance on unmount.
 *
 * `nanoOptions` is captured once, at the effect that creates the
 * instance, and is not itself part of the recreate-on-change dependency
 * set: it configures the underlying model session, not something a
 * consumer is expected to change on every render.
 */
export function WrenProvider({ children, nanoOptions, ...options }: WrenProviderProps): React.JSX.Element {
  const [state, setState] = useState<WrenContextValue>({ wren: null, status: 'initialising', error: null });
  const { dbName, labeller, maxSectionChars, budgetRatio, toolCap } = options;

  useEffect(() => {
    let cancelled = false;
    let instance: Wren | null = null;

    setState({ wren: null, status: 'initialising', error: null });

    Wren.isSupported()
      .then((support) => {
        if (cancelled) return undefined;
        if (!support.storage) {
          setState({ wren: null, status: 'unsupported', error: null });
          return undefined;
        }
        return Wren.create({ dbName, labeller, maxSectionChars, budgetRatio, toolCap, nanoOptions });
      })
      .then((wren) => {
        if (!wren) return;
        if (cancelled) {
          void wren.destroy();
          return;
        }
        instance = wren;
        setState({ wren, status: 'ready', error: null });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ wren: null, status: 'error', error: error instanceof Error ? error : new Error(String(error)) });
        }
      });

    return () => {
      cancelled = true;
      void instance?.destroy();
    };
    // nanoOptions is deliberately excluded; see the doc comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbName, labeller, maxSectionChars, budgetRatio, toolCap]);

  return <WrenContext.Provider value={state}>{children}</WrenContext.Provider>;
}
