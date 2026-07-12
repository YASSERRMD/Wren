import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { BindingSpec, Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { SqlEngine } from '../storage/migrations.js';

/**
 * Wraps an in-memory Node sqlite3 database (no OPFS, no persistence, per
 * the package's own Node support caveat) as a {@link SqlEngine}, so SQL
 * logic can be exercised against real SQLite in tests without the
 * Worker/OPFS machinery that only works in a browser.
 */
class NodeSqlEngine implements SqlEngine {
  constructor(private readonly db: Database) {}

  async exec(sql: string, params?: unknown[]): Promise<void> {
    this.db.exec(sql, { bind: params as BindingSpec | undefined });
  }

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.db.exec(sql, {
      bind: params as BindingSpec | undefined,
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as T[];
  }

  /** So this can stand in for WrenStorage wherever a test needs something Wren.destroy() can call close() on. */
  async close(): Promise<void> {
    this.db.close();
  }
}

let sqlite3: Sqlite3Static | undefined;

export async function createNodeSqlEngine(): Promise<SqlEngine & { close(): Promise<void> }> {
  sqlite3 ??= await sqlite3InitModule();
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  db.exec('PRAGMA foreign_keys = ON');
  return new NodeSqlEngine(db);
}
