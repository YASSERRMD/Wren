export interface Migration {
  version: number;
  up: string;
}

/** Minimal shape a migration runner needs. {@link WrenStorage} satisfies this. */
export interface SqlEngine {
  exec(sql: string, params?: unknown[]): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
}

const MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )
`;

interface AppliedVersionRow {
  version: number;
}

/**
 * Applies pending migrations in ascending version order and records each as
 * applied. Safe to call repeatedly: already-applied versions are skipped, so
 * calling this again with the same migrations list makes no changes.
 */
export async function applyMigrations(
  engine: SqlEngine,
  migrations: readonly Migration[],
): Promise<void> {
  await engine.exec(MIGRATIONS_TABLE_SQL);
  const appliedRows = await engine.query<AppliedVersionRow>('SELECT version FROM migrations');
  const applied = new Set(appliedRows.map((row) => row.version));

  const pending = migrations
    .filter((migration) => !applied.has(migration.version))
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    await engine.exec(migration.up);
    await engine.exec('INSERT INTO migrations (version, applied_at) VALUES (?, ?)', [
      migration.version,
      new Date().toISOString(),
    ]);
  }
}
