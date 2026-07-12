import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { Database, Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, type Migration, type SqlEngine } from './migrations.js';

/**
 * Wraps an in-memory Node sqlite3 database (no OPFS, no persistence) as a
 * {@link SqlEngine} so the migration runner's SQL logic can be exercised
 * against real SQLite in Node, without the Worker/OPFS machinery that only
 * works in a browser.
 */
class NodeSqlEngine implements SqlEngine {
  constructor(private readonly db: Database) {}

  async exec(sql: string, params?: unknown[]): Promise<void> {
    this.db.exec(sql, { bind: params as never });
  }

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.db.exec(sql, {
      bind: params as never,
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as T[];
  }
}

let sqlite3: Sqlite3Static;

async function createEngine(): Promise<NodeSqlEngine> {
  sqlite3 ??= await sqlite3InitModule();
  return new NodeSqlEngine(new sqlite3.oo1.DB(':memory:', 'c'));
}

describe('applyMigrations', () => {
  let engine: NodeSqlEngine;

  beforeEach(async () => {
    engine = await createEngine();
  });

  it('applies a no-op migration and records it', async () => {
    const migrations: Migration[] = [{ version: 1, up: 'SELECT 1;' }];
    await applyMigrations(engine, migrations);

    const rows = await engine.query<{ version: number }>('SELECT version FROM migrations');
    expect(rows).toEqual([{ version: 1 }]);
  });

  it('applies migrations in ascending version order regardless of input order', async () => {
    const migrations: Migration[] = [
      { version: 2, up: 'CREATE TABLE b (id INTEGER PRIMARY KEY);' },
      { version: 1, up: 'CREATE TABLE a (id INTEGER PRIMARY KEY);' },
    ];
    await applyMigrations(engine, migrations);

    const rows = await engine.query<{ version: number }>(
      'SELECT version FROM migrations ORDER BY version',
    );
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
  });

  it('is idempotent: a second call with the same migrations applies nothing new', async () => {
    const migrations: Migration[] = [
      { version: 1, up: 'CREATE TABLE counter (n INTEGER);' },
      { version: 2, up: "INSERT INTO counter (n) VALUES (1);" },
    ];
    await applyMigrations(engine, migrations);
    await applyMigrations(engine, migrations);

    const rows = await engine.query<{ n: number }>('SELECT n FROM counter');
    expect(rows).toHaveLength(1);
  });

  it('applies only the new migration when the list grows between calls', async () => {
    await applyMigrations(engine, [{ version: 1, up: 'CREATE TABLE t (id INTEGER);' }]);
    await applyMigrations(engine, [
      { version: 1, up: 'CREATE TABLE t (id INTEGER);' },
      { version: 2, up: 'ALTER TABLE t ADD COLUMN label TEXT;' },
    ]);

    const rows = await engine.query<{ version: number }>(
      'SELECT version FROM migrations ORDER BY version',
    );
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
  });
});
