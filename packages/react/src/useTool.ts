import { useEffect, useMemo, useRef, type DependencyList } from 'react';
import type { WrenTool } from '@wren/core';
import { useWren } from './useWren.js';

/**
 * Registers a tool on mount, unregisters on unmount, and re-registers
 * whenever `deps` changes. The tool object itself is memoised internally
 * (keyed on `deps`) so passing a fresh inline object literal every render
 * does not thrash the registry.
 */
export function useTool(tool: WrenTool, deps: DependencyList = []): void {
  const { wren } = useWren();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoisedTool = useMemo(() => tool, deps);
  const hasRegisteredRef = useRef(false);

  useEffect(() => {
    if (!wren || hasRegisteredRef.current) return undefined;
    hasRegisteredRef.current = true;
    const unregister = wren.registerTool(memoisedTool);
    return () => {
      unregister();
    };
  }, [wren, memoisedTool]);
}
