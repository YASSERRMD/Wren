import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isSupported, create, fakeWren } = vi.hoisted(() => {
  return {
    isSupported: vi.fn(),
    create: vi.fn(),
    fakeWren: {
      destroy: vi.fn(async () => undefined),
      registerTool: vi.fn(() => vi.fn()),
      listDocuments: vi.fn(async () => [{ id: 'a', title: 'A', sourceType: 'text' as const, createdAt: '2026-01-01T00:00:00.000Z' }]),
      ingest: vi.fn(),
      deleteDocument: vi.fn(async () => undefined),
    },
  };
});

vi.mock('@wren/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wren/core')>();
  return { ...actual, Wren: { isSupported, create } };
});

import type { WrenTool } from '@wren/core';
import { WrenService } from './WrenService.js';

function tool(name = 'my_tool'): WrenTool {
  return { name, description: 'x', inputSchema: { type: 'object' }, execute: async () => ({ content: 'ok' }) };
}

describe('WrenService', () => {
  beforeEach(() => {
    isSupported.mockReset().mockResolvedValue({ storage: true, nano: 'available', webmcp: false });
    create.mockReset().mockResolvedValue(fakeWren);
    fakeWren.registerTool.mockClear();
    fakeWren.destroy.mockClear();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  describe('initialisation', () => {
    it('goes from initialising to ready and populates documents', async () => {
      const service = TestBed.inject(WrenService);
      expect(service.status()).toBe('initialising');

      await vi.waitFor(() => expect(service.status()).toBe('ready'));
      expect(service.documents()).toHaveLength(1);
      expect(service.error()).toBeNull();
    });

    it('goes to unsupported without calling Wren.create() when storage is unsupported', async () => {
      isSupported.mockResolvedValue({ storage: false, nano: 'unavailable', webmcp: false });
      const service = TestBed.inject(WrenService);

      await vi.waitFor(() => expect(service.status()).toBe('unsupported'));
      expect(create).not.toHaveBeenCalled();
    });

    it('goes to error when Wren.create() rejects', async () => {
      create.mockRejectedValue(new Error('nano unavailable'));
      const service = TestBed.inject(WrenService);

      await vi.waitFor(() => expect(service.status()).toBe('error'));
      expect(service.error()?.message).toBe('nano unavailable');
    });
  });

  describe('registerTool', () => {
    it('registers immediately once ready', async () => {
      const service = TestBed.inject(WrenService);
      await vi.waitFor(() => expect(service.status()).toBe('ready'));

      const myTool = tool();
      service.registerTool(myTool);
      expect(fakeWren.registerTool).toHaveBeenCalledWith(myTool);
    });

    it('queues a tool registered before ready and flushes it once ready', async () => {
      const service = TestBed.inject(WrenService);
      const myTool = tool();
      service.registerTool(myTool);
      expect(fakeWren.registerTool).not.toHaveBeenCalled();

      await vi.waitFor(() => expect(service.status()).toBe('ready'));
      expect(fakeWren.registerTool).toHaveBeenCalledWith(myTool);
    });

    it('unregistering a still-pending tool never registers it once ready', async () => {
      const service = TestBed.inject(WrenService);
      const unregister = service.registerTool(tool());
      unregister();

      await vi.waitFor(() => expect(service.status()).toBe('ready'));
      expect(fakeWren.registerTool).not.toHaveBeenCalled();
    });
  });

  describe('ingest, refreshDocuments, deleteDocument', () => {
    it('ingest() tracks progress and refreshes documents on success', async () => {
      fakeWren.ingest.mockImplementation(async (_source: unknown, opts: { onProgress?: (p: unknown) => void }) => {
        opts.onProgress?.({ phase: 'indexing', current: 1, total: 1 });
        return { docId: 'b', sectionCount: 1, warnings: [], labelStrategy: 'heuristic', durationMs: 1 };
      });
      const service = TestBed.inject(WrenService);
      await vi.waitFor(() => expect(service.status()).toBe('ready'));

      const result = await service.ingest({ type: 'text', title: 'B', content: 'x' });

      expect(result?.docId).toBe('b');
      expect(service.ingestProgress()).toBeUndefined();
    });

    it('deleteDocument() deletes and refreshes', async () => {
      const service = TestBed.inject(WrenService);
      await vi.waitFor(() => expect(service.status()).toBe('ready'));

      await service.deleteDocument('a');
      expect(fakeWren.deleteDocument).toHaveBeenCalledWith('a');
      expect(fakeWren.listDocuments).toHaveBeenCalled();
    });
  });

  it('destroys the Wren instance when the service is destroyed', async () => {
    const service = TestBed.inject(WrenService);
    await vi.waitFor(() => expect(service.status()).toBe('ready'));

    TestBed.resetTestingModule();
    await vi.waitFor(() => expect(fakeWren.destroy).toHaveBeenCalledTimes(1));
  });
});
