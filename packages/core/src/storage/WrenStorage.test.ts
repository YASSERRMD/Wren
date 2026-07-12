import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WrenStorageClosedError, WrenStorageUnsupportedError } from './errors.js';
import { WrenStorage } from './WrenStorage.js';

interface MockRequest {
  id: number;
  method: string;
  params: unknown;
}

type Listener = (event: { data: unknown }) => void;

/**
 * Stands in for the real storage Worker. Each test supplies a `handler`
 * that decides how to respond to a given RPC method, so these tests verify
 * WrenStorage's call sequencing and error handling rather than real SQL.
 * Real persistence is verified separately against an actual browser.
 */
class MockWorker {
  static handler: (method: string, params: unknown) => unknown = () => undefined;
  static instances: MockWorker[] = [];

  terminated = false;
  private readonly messageListeners = new Set<Listener>();

  constructor(
    readonly url: URL,
    readonly options?: { type?: string },
  ) {
    MockWorker.instances.push(this);
  }

  addEventListener(type: string, listener: Listener): void {
    if (type === 'message') this.messageListeners.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    if (type === 'message') this.messageListeners.delete(listener);
  }

  postMessage(message: MockRequest): void {
    queueMicrotask(() => {
      try {
        const result = MockWorker.handler(message.method, message.params);
        this.emit({ id: message.id, ok: true, result });
      } catch (error) {
        this.emit({
          id: message.id,
          ok: false,
          error: {
            name: error instanceof Error ? error.name : 'Error',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    });
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(data: unknown): void {
    for (const listener of this.messageListeners) {
      listener({ data });
    }
  }
}

function stubSupportedEnvironment(): void {
  vi.stubGlobal('Worker', MockWorker);
  vi.stubGlobal('navigator', { storage: { getDirectory: async () => ({}) } });
}

/**
 * Sensible defaults for the calls WrenStorage.open() always makes (open,
 * plus the migration runner's bookkeeping query/exec), so tests only need
 * to override the method they actually care about.
 */
function defaultHandler(
  overrides: Partial<Record<string, (params: unknown) => unknown>> = {},
): (method: string, params: unknown) => unknown {
  return (method, params) => {
    if (overrides[method]) return overrides[method](params);
    if (method === 'open') return { persisted: true };
    if (method === 'query') return [];
    return undefined;
  };
}

describe('WrenStorage', () => {
  beforeEach(() => {
    MockWorker.instances.length = 0;
    MockWorker.handler = () => undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('isSupported', () => {
    it('returns false when Worker and OPFS are both stubbed out', () => {
      vi.stubGlobal('Worker', undefined);
      vi.stubGlobal('navigator', {});
      expect(WrenStorage.isSupported()).toBe(false);
    });

    it('returns false when Worker exists but OPFS does not', () => {
      vi.stubGlobal('Worker', MockWorker);
      vi.stubGlobal('navigator', {});
      expect(WrenStorage.isSupported()).toBe(false);
    });

    it('returns true when both Worker and OPFS root access are present', () => {
      stubSupportedEnvironment();
      expect(WrenStorage.isSupported()).toBe(true);
    });
  });

  describe('open', () => {
    it('throws WrenStorageUnsupportedError instead of touching Worker when unsupported', async () => {
      vi.stubGlobal('Worker', undefined);
      vi.stubGlobal('navigator', {});
      await expect(WrenStorage.open('unsupported.sqlite3')).rejects.toBeInstanceOf(
        WrenStorageUnsupportedError,
      );
    });

    it('sends an open call and applies migrations before resolving', async () => {
      stubSupportedEnvironment();
      const calls: Array<{ method: string; params: unknown }> = [];
      MockWorker.handler = (method, params) => {
        calls.push({ method, params });
        if (method === 'open') return { persisted: true };
        if (method === 'query') return [];
        return undefined;
      };

      await WrenStorage.open('db.sqlite3', [{ version: 1, up: 'SELECT 1;' }]);

      expect(calls[0]).toEqual({ method: 'open', params: { dbName: 'db.sqlite3' } });
      const migrationExec = calls.find(
        (c) => c.method === 'exec' && (c.params as { sql: string }).sql.includes('SELECT 1;'),
      );
      expect(migrationExec).toBeDefined();
    });
  });

  describe('exec and query', () => {
    it('round-trips write then read through the rpc bridge', async () => {
      stubSupportedEnvironment();
      const rows: Record<string, unknown>[] = [];
      MockWorker.handler = (method, params) => {
        if (method === 'open') return { persisted: true };
        if (method === 'exec') {
          const p = params as { sql: string; params?: unknown[] };
          if (p.sql.startsWith('INSERT')) {
            rows.push({ id: rows.length + 1, body: p.params?.[0] });
          }
          return undefined;
        }
        if (method === 'query') return rows;
        return undefined;
      };

      const storage = await WrenStorage.open('db.sqlite3');
      await storage.exec('INSERT INTO notes (body) VALUES (?)', ['hello']);
      const result = await storage.query<{ id: number; body: string }>('SELECT * FROM notes');

      expect(result).toEqual([{ id: 1, body: 'hello' }]);
    });

    it('rejects with the underlying error message on SQL failure', async () => {
      stubSupportedEnvironment();
      MockWorker.handler = defaultHandler({
        exec: (params) => {
          const { sql } = params as { sql: string };
          if (sql.includes('GARBAGE')) {
            throw new Error('SQLITE_ERROR: near "GARBAGE": syntax error');
          }
          return undefined;
        },
      });

      const storage = await WrenStorage.open('db.sqlite3');
      await expect(storage.exec('GARBAGE SQL')).rejects.toThrow(/syntax error/);
    });
  });

  describe('close and destroy', () => {
    it('rejects further calls after close with WrenStorageClosedError', async () => {
      stubSupportedEnvironment();
      MockWorker.handler = defaultHandler();

      const storage = await WrenStorage.open('db.sqlite3');
      await storage.close();

      await expect(storage.exec('SELECT 1')).rejects.toBeInstanceOf(WrenStorageClosedError);
    });

    it('terminates the worker on close', async () => {
      stubSupportedEnvironment();
      MockWorker.handler = defaultHandler();

      const storage = await WrenStorage.open('db.sqlite3');
      const worker = MockWorker.instances.at(-1)!;
      expect(worker.terminated).toBe(false);

      await storage.close();
      expect(worker.terminated).toBe(true);
    });

    it('terminates the worker on destroy', async () => {
      stubSupportedEnvironment();
      MockWorker.handler = defaultHandler();

      const storage = await WrenStorage.open('db.sqlite3');
      const worker = MockWorker.instances.at(-1)!;

      await storage.destroy();
      expect(worker.terminated).toBe(true);
    });
  });
});
