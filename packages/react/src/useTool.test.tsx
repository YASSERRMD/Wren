import { render } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '@wren/core';
import { WrenContext } from './WrenContext.js';
import { readyValue } from './test-support/contextWrapper.js';
import { useTool } from './useTool.js';

function makeTool(overrides: Partial<{ name: string; description: string }> = {}) {
  return {
    name: 'my_tool',
    description: 'does a thing',
    inputSchema: { type: 'object' as const },
    execute: async () => ({ content: 'ok' }),
    ...overrides,
  };
}

describe('useTool', () => {
  it('registers on mount and unregisters on unmount', () => {
    const registry = new ToolRegistry();
    const wren = { registerTool: registry.register.bind(registry) } as never;

    function Consumer() {
      useTool(makeTool());
      return null;
    }

    const { unmount } = render(
      <WrenContext.Provider value={readyValue(wren)}>
        <Consumer />
      </WrenContext.Provider>,
    );

    expect(registry.list().map((t) => t.name)).toEqual(['my_tool']);

    unmount();

    expect(registry.list()).toEqual([]);
  });

  it('leaves exactly one registration after React Strict Mode double-invocation', () => {
    const registry = new ToolRegistry();
    const wren = { registerTool: registry.register.bind(registry) } as never;

    function Consumer() {
      useTool(makeTool());
      return null;
    }

    expect(() => {
      render(
        <StrictMode>
          <WrenContext.Provider value={readyValue(wren)}>
            <Consumer />
          </WrenContext.Provider>
        </StrictMode>,
      );
    }).not.toThrow();

    expect(registry.list().map((t) => t.name)).toEqual(['my_tool']);
  });

  it('re-registers when deps changes', () => {
    const registry = new ToolRegistry();
    const wren = { registerTool: registry.register.bind(registry) } as never;

    function Consumer({ description }: { description: string }) {
      useTool(makeTool({ description }), [description]);
      return null;
    }

    const { rerender } = render(
      <WrenContext.Provider value={readyValue(wren)}>
        <Consumer description="first" />
      </WrenContext.Provider>,
    );
    expect(registry.get('my_tool')?.description).toBe('first');

    rerender(
      <WrenContext.Provider value={readyValue(wren)}>
        <Consumer description="second" />
      </WrenContext.Provider>,
    );
    expect(registry.get('my_tool')?.description).toBe('second');
    expect(registry.list()).toHaveLength(1);
  });
});
