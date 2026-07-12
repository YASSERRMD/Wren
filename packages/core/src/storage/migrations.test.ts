import { beforeEach, describe, expect, it } from 'vitest';
import { createNodeSqlEngine } from '../test-support/node-sql-engine.js';
import { applyMigrations, type Migration, type SqlEngine } from './migrations.js';

describe('applyMigrations', () => {
  let engine: SqlEngine;

  beforeEach(async () => {
    engine = await createNodeSqlEngine();
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
