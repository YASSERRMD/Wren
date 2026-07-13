import { WrenStorageClosedError, WrenStorageUnsupportedError } from './errors.js';
import { applyMigrations, type Migration, type SqlEngine } from './migrations.js';
import { WorkerRpcClient } from './worker-rpc-client.js';
import StorageWorker from './worker/storage.worker.ts?worker&inline';

/**
 * Async wrapper around a SQLite database persisted to OPFS via the SAHPool
 * VFS, running inside a Web Worker.
 *
 * SAHPool does not require Cross-Origin-Opener-Policy or
 * Cross-Origin-Embedder-Policy headers, unlike the default `opfs` VFS: it
 * does not use SharedArrayBuffer or Atomics.wait. It does require a Worker,
 * because `FileSystemFileHandle.createSyncAccessHandle()` is only available
 * in Worker threads, not the main UI thread. Verified against the SQLite
 * Wasm project documentation as of the 3.53.0 release.
 */
export class WrenStorage implements SqlEngine {
  private readonly rpc: WorkerRpcClient;
  private readonly dbName: string;
  private closed = false;

  private constructor(rpc: WorkerRpcClient, dbName: string) {
    this.rpc = rpc;
    this.dbName = dbName;
  }

  static async open(dbName: string, migrations: readonly Migration[] = []): Promise<WrenStorage> {
    const reason = WrenStorage.unsupportedReason();
    if (reason) {
      throw new WrenStorageUnsupportedError(reason);
    }
    // Built via Vite's ?worker&inline suffix, which embeds the worker's own
    // compiled output directly into this package's bundle rather than
    // referencing it by a build-time-resolved file path. A plain
    // `new Worker(new URL(...))` bakes in a path relative to @wren/core's
    // own dist/ output; that path does not resolve correctly once this
    // package is consumed as a pre-built dependency by another app's own
    // bundler; the app has no way to know it needs to also serve a chunk
    // that only appears inside a dependency's compiled internals.
    const worker = new StorageWorker();
    const rpc = new WorkerRpcClient(worker);
    await rpc.call<{ dbName: string }, { persisted: boolean }>('open', { dbName });
    const storage = new WrenStorage(rpc, dbName);
    await applyMigrations(storage, migrations);
    return storage;
  }

  /**
   * Checks for Worker support and OPFS root access
   * (`navigator.storage.getDirectory`). Deliberately does not check for
   * SharedArrayBuffer or cross-origin isolation: the SAHPool VFS this class
   * uses does not need them, unlike the default `opfs` VFS. Verified against
   * the SQLite Wasm project documentation as of the 3.53.0 release.
   */
  static isSupported(): boolean {
    return WrenStorage.unsupportedReason() === undefined;
  }

  private static unsupportedReason(): string | undefined {
    if (typeof Worker === 'undefined') {
      return 'Worker is not available';
    }
    if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
      return 'the Origin Private File System (navigator.storage.getDirectory) is not available';
    }
    return undefined;
  }

  async exec(sql: string, params?: unknown[]): Promise<void> {
    this.assertOpen();
    await this.rpc.call<{ sql: string; params?: unknown[] }, void>('exec', { sql, params });
  }

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    this.assertOpen();
    return this.rpc.call<{ sql: string; params?: unknown[] }, T[]>('query', { sql, params });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.rpc.call<Record<string, never>, void>('close', {});
    this.rpc.terminate();
    this.closed = true;
  }

  /** Drops the OPFS-backed file for this database. For tests and reset. */
  async destroy(): Promise<void> {
    await this.rpc.call<Record<string, never>, void>('destroy', {});
    this.rpc.terminate();
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new WrenStorageClosedError(this.dbName);
    }
  }
}
