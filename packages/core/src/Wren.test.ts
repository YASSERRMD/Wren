import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentRepository } from './documents/DocumentRepository.js';
import { ADD_CONTENT_HASH_MIGRATION, INITIAL_MIGRATION } from './documents/migrations.js';
import { MockNanoAdapter } from './nano/MockNanoAdapter.js';
import { applyMigrations, type SqlEngine } from './storage/migrations.js';
import { createNodeSqlEngine } from './test-support/node-sql-engine.js';
import type { WrenTool } from './tools/WrenTool.js';
import { Wren } from './Wren.js';

async function freshEngine(): Promise<SqlEngine & { close(): Promise<void> }> {
  const engine = await createNodeSqlEngine();
  await applyMigrations(engine, [INITIAL_MIGRATION, ADD_CONTENT_HASH_MIGRATION]);
  return engine;
}

function tool(overrides: Partial<WrenTool> = {}): WrenTool {
  return {
    name: 'get_time',
    description: 'returns the current time',
    inputSchema: { type: 'object' },
    execute: async () => ({ content: 'noon' }),
    ...overrides,
  };
}

describe('Wren', () => {
  describe('full lifecycle', () => {
    it('creates, ingests, registers a tool, queries, and destroys cleanly', async () => {
      const engine = await freshEngine();
      const nano = new MockNanoAdapter([
        JSON.stringify({ action: 'tool', tool: 'get_time', args: {} }),
        'It is noon.',
      ]);
      const wren = Wren.assemble(engine, nano);

      const ingestResult = await wren.ingest({
        type: 'markdown',
        title: 'Doc',
        content: '# Heading\n\nSome content about widgets.',
      });
      expect(ingestResult.sectionCount).toBeGreaterThan(0);
      expect(await wren.listDocuments()).toHaveLength(1);

      const unregister = wren.registerTool(tool());
      const response = await wren.query('what time is it?');

      expect(response.action).toBe('tool');
      expect(response.answer).toBe('It is noon.');
      expect(response.toolCall).toEqual({ name: 'get_time', args: {}, result: 'noon' });

      unregister();
      await expect(wren.destroy()).resolves.toBeUndefined();
    });

    it('deleteDocument and clear remove ingested documents', async () => {
      const engine = await freshEngine();
      const nano = new MockNanoAdapter([]);
      const wren = Wren.assemble(engine, nano);

      const a = await wren.ingest({ type: 'text', title: 'A', content: 'first document' });
      const b = await wren.ingest({ type: 'text', title: 'B', content: 'second document' });
      expect(await wren.listDocuments()).toHaveLength(2);

      await wren.deleteDocument(a.docId);
      expect((await wren.listDocuments()).map((d) => d.id)).toEqual([b.docId]);

      await wren.clear();
      expect(await wren.listDocuments()).toEqual([]);
    });
  });

  describe('isSupported', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('reports every subsystem as available when the underlying browser APIs are present', async () => {
      vi.stubGlobal('Worker', class {});
      vi.stubGlobal('navigator', {
        ...navigator,
        storage: { getDirectory: async () => ({}) },
        modelContext: { registerTool: async () => undefined },
      });
      vi.stubGlobal('LanguageModel', { availability: async () => 'available' });

      expect(await Wren.isSupported()).toEqual({ storage: true, nano: 'available', webmcp: true });
    });

    it('reports every subsystem as unavailable when the underlying browser APIs are absent', async () => {
      vi.stubGlobal('Worker', undefined);
      vi.stubGlobal('navigator', { ...navigator, storage: undefined, modelContext: undefined });
      vi.stubGlobal('LanguageModel', undefined);

      expect(await Wren.isSupported()).toEqual({ storage: false, nano: 'unavailable', webmcp: false });
    });
  });

  describe('options override defaults', () => {
    it('applies a configured toolCap instead of the built-in default of 7', async () => {
      const engine = await freshEngine();
      const wren = Wren.assemble(engine, new MockNanoAdapter([]), { toolCap: 2 });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      wren.registerTool(tool({ name: 'tool_a' }));
      wren.registerTool(tool({ name: 'tool_b' }));
      expect(warnSpy).not.toHaveBeenCalled();

      wren.registerTool(tool({ name: 'tool_c' }));
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('exceeding the recommended cap of 2');

      warnSpy.mockRestore();
    });

    it('applies a configured budgetRatio so a section that the default would truncate is not', async () => {
      const engine = await freshEngine();
      const hugeContent = 'x'.repeat(2000);
      const nano = new MockNanoAdapter([], { inputQuota: 100, contextWindow: 100, usage: 0 });
      const wren = Wren.assemble(engine, nano, { budgetRatio: 1000 });

      const ingestResult = await wren.ingest({ type: 'markdown', title: 'Doc', content: `# Heading\n\n${hugeContent}` });
      const repo = new DocumentRepository(engine);
      const tree = await repo.getTree(ingestResult.docId);
      const sectionId = tree.children[0].sectionId;

      nano.enqueue(JSON.stringify({ action: 'answer', sectionIds: [sectionId] }), 'Short answer.');
      const response = await wren.query('heading');

      expect(response.answer).toBe('Short answer.');
      expect(response.warnings).toEqual([]);
      // The default budgetRatio (0.7) against this tiny quota would have
      // truncated hugeContent well below its full length (see Dispatcher's
      // own budget truncation tests); the override raises the budget high
      // enough that the full, untruncated content reaches the answer call.
      expect(nano.callLog[1].input).toContain(hugeContent);
    });
  });
});
