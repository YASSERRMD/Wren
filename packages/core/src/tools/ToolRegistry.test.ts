import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolNameError, ToolRegistry } from './ToolRegistry.js';
import type { WrenTool } from './WrenTool.js';

function tool(overrides: Partial<WrenTool> = {}): WrenTool {
  return {
    name: 'my_tool',
    description: 'does a thing',
    inputSchema: { type: 'object' },
    execute: async () => ({ content: 'ok' }),
    ...overrides,
  };
}

describe('ToolRegistry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('register / unregister / list / get', () => {
    it('register returns a working unregister function', () => {
      const registry = new ToolRegistry();
      const unregister = registry.register(tool());

      expect(registry.get('my_tool')).toBeDefined();
      expect(registry.list()).toHaveLength(1);

      unregister();

      expect(registry.get('my_tool')).toBeUndefined();
      expect(registry.list()).toEqual([]);
    });

    it('unregister by name is equivalent to calling the returned handle', () => {
      const registry = new ToolRegistry();
      registry.register(tool());
      registry.unregister('my_tool');
      expect(registry.get('my_tool')).toBeUndefined();
    });
  });

  describe('invoke', () => {
    it('validates args and returns a structured error on mismatch', async () => {
      const registry = new ToolRegistry();
      registry.register(
        tool({
          name: 'fill_field',
          inputSchema: {
            type: 'object',
            required: ['field', 'value'],
            properties: { field: { type: 'string' }, value: { type: 'string' } },
          },
          execute: async (args) => ({ content: `filled ${String(args.field)}` }),
        }),
      );

      expect(await registry.invoke('fill_field', { field: 'name', value: 'x' })).toEqual({
        content: 'filled name',
      });

      const badArgs = await registry.invoke('fill_field', { field: 'name' });
      expect(badArgs.isError).toBe(true);

      const unknownTool = await registry.invoke('nope', {});
      expect(unknownTool.isError).toBe(true);
    });

    it('catches a throw from execute and returns a structured error instead', async () => {
      const registry = new ToolRegistry();
      registry.register(
        tool({
          name: 'boom',
          execute: async () => {
            throw new Error('kaboom');
          },
        }),
      );

      const result = await registry.invoke('boom', {});
      expect(result.isError).toBe(true);
      expect(result.content).toContain('kaboom');
    });
  });

  describe('name validation', () => {
    it('rejects an invalid name pattern', () => {
      const registry = new ToolRegistry();
      expect(() => registry.register(tool({ name: 'MyTool' }))).toThrow(ToolNameError);
      expect(() => registry.register(tool({ name: '1tool' }))).toThrow(ToolNameError);
      expect(() => registry.register(tool({ name: 'my-tool' }))).toThrow(ToolNameError);
    });

    it('rejects a name over 40 characters', () => {
      const registry = new ToolRegistry();
      expect(() => registry.register(tool({ name: 'a'.repeat(41) }))).toThrow(ToolNameError);
    });

    it('rejects a duplicate name but allows reuse after unregister', () => {
      const registry = new ToolRegistry();
      const unregister = registry.register(tool({ name: 'fill_field' }));
      expect(() => registry.register(tool({ name: 'fill_field' }))).toThrow(ToolNameError);

      unregister();
      expect(() => registry.register(tool({ name: 'fill_field' }))).not.toThrow();
    });
  });

  describe('tool count cap', () => {
    it('warns when registering an eighth tool, but does not throw', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const registry = new ToolRegistry();
      for (let i = 1; i <= 7; i++) {
        registry.register(tool({ name: `tool_${i}` }));
      }
      expect(warnSpy).not.toHaveBeenCalled();

      expect(() => registry.register(tool({ name: 'tool_8' }))).not.toThrow();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('8 tools registered');
      warnSpy.mockRestore();
    });
  });

  describe('WebMCP bridge', () => {
    it('no-ops cleanly when navigator.modelContext is undefined', () => {
      expect(navigator.modelContext).toBeUndefined();
      const registry = new ToolRegistry();
      expect(() => registry.register(tool())).not.toThrow();
    });

    it('mirrors a registered tool into navigator.modelContext when present, and aborts its signal on unregister', () => {
      const registerTool = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('navigator', { ...navigator, modelContext: { registerTool } });

      const registry = new ToolRegistry();
      const unregister = registry.register(tool({ name: 'fill_field' }));

      expect(registerTool).toHaveBeenCalledTimes(1);
      const [mirroredTool, opts] = registerTool.mock.calls[0];
      expect(mirroredTool.name).toBe('fill_field');
      expect(opts.signal.aborted).toBe(false);

      unregister();
      expect(opts.signal.aborted).toBe(true);
    });

    it('swallows a rejection from registerTool rather than throwing or affecting registry state', async () => {
      const registerTool = vi.fn().mockRejectedValue(new Error('nope'));
      vi.stubGlobal('navigator', { ...navigator, modelContext: { registerTool } });

      const registry = new ToolRegistry();
      expect(() => registry.register(tool())).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(registry.get('my_tool')).toBeDefined();
    });

    it("the mirrored tool's execute translates isError into a thrown error", async () => {
      let mirroredExecute: ((input: Record<string, unknown>) => Promise<unknown>) | undefined;
      const registerTool = vi.fn().mockImplementation((t) => {
        mirroredExecute = t.execute;
        return Promise.resolve(undefined);
      });
      vi.stubGlobal('navigator', { ...navigator, modelContext: { registerTool } });

      const registry = new ToolRegistry();
      registry.register(tool({ execute: async () => ({ content: 'failed', isError: true }) }));

      await expect(mirroredExecute?.({})).rejects.toThrow('failed');
    });
  });
});
