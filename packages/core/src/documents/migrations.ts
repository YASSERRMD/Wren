import type { Migration } from '../storage/migrations.js';

export const INITIAL_MIGRATION: Migration = {
  version: 1,
  up: `
    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      meta TEXT
    );

    CREATE TABLE sections (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      depth INTEGER NOT NULL,
      heading TEXT NOT NULL,
      content TEXT NOT NULL,
      label TEXT NOT NULL
    );

    CREATE INDEX idx_sections_doc_parent_ordinal ON sections (doc_id, parent_id, ordinal);
  `,
};
