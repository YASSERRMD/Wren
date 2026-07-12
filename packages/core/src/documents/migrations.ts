import type { Migration } from '../storage/migrations.js';

/**
 * documents/sections schema plus an external-content FTS5 index over
 * heading, content, and label, kept in sync by triggers so the indexed
 * text is never duplicated outside the sections table itself.
 */
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

    CREATE VIRTUAL TABLE sections_fts USING fts5(
      heading,
      content,
      label,
      content='sections',
      content_rowid='rowid',
      tokenize='porter'
    );

    CREATE TRIGGER sections_ai AFTER INSERT ON sections BEGIN
      INSERT INTO sections_fts(rowid, heading, content, label)
      VALUES (new.rowid, new.heading, new.content, new.label);
    END;

    CREATE TRIGGER sections_ad AFTER DELETE ON sections BEGIN
      INSERT INTO sections_fts(sections_fts, rowid, heading, content, label)
      VALUES ('delete', old.rowid, old.heading, old.content, old.label);
    END;

    CREATE TRIGGER sections_au AFTER UPDATE ON sections BEGIN
      INSERT INTO sections_fts(sections_fts, rowid, heading, content, label)
      VALUES ('delete', old.rowid, old.heading, old.content, old.label);
      INSERT INTO sections_fts(rowid, heading, content, label)
      VALUES (new.rowid, new.heading, new.content, new.label);
    END;
  `,
};

/**
 * Content-addressed label caching (Phase 6): any section, past or present,
 * whose content hashes the same as a new section's can donate its label,
 * so re-ingesting unchanged content makes zero LLM calls. Deliberately a
 * new migration rather than editing INITIAL_MIGRATION's already-shipped
 * SQL, which would not re-run for anyone who already applied it.
 */
export const ADD_CONTENT_HASH_MIGRATION: Migration = {
  version: 2,
  up: `
    ALTER TABLE sections ADD COLUMN content_hash TEXT;
    CREATE INDEX idx_sections_content_hash ON sections (content_hash);
  `,
};
