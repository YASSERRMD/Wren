import { beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, type SqlEngine } from '../storage/migrations.js';
import { createNodeSqlEngine } from '../test-support/node-sql-engine.js';
import type { WrenDocument, WrenSection } from '../types.js';
import { DocumentRepository, SectionDepthError } from './DocumentRepository.js';
import { ADD_CONTENT_HASH_MIGRATION, INITIAL_MIGRATION } from './migrations.js';

function doc(overrides: Partial<WrenDocument> = {}): WrenDocument {
  return {
    id: 'doc-1',
    title: 'Test document',
    sourceType: 'markdown',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function section(overrides: Partial<WrenSection> = {}): WrenSection {
  return {
    id: 's-1',
    docId: 'doc-1',
    parentId: null,
    ordinal: 0,
    depth: 0,
    heading: 'Heading',
    content: 'Body text.',
    label: 'A short label',
    ...overrides,
  };
}

describe('DocumentRepository', () => {
  let engine: SqlEngine;
  let repo: DocumentRepository;

  beforeEach(async () => {
    engine = await createNodeSqlEngine();
    await applyMigrations(engine, [INITIAL_MIGRATION, ADD_CONTENT_HASH_MIGRATION]);
    repo = new DocumentRepository(engine);
  });

  it('inserts a document with nested sections and reads the tree back', async () => {
    await repo.insertDocument(doc());
    await repo.insertSections([
      section({ id: 'a', parentId: null, ordinal: 0, depth: 0, heading: 'A' }),
      section({ id: 'a-1', parentId: 'a', ordinal: 0, depth: 1, heading: 'A.1' }),
      section({ id: 'a-2', parentId: 'a', ordinal: 1, depth: 1, heading: 'A.2' }),
      section({ id: 'b', parentId: null, ordinal: 1, depth: 0, heading: 'B' }),
    ]);

    const tree = await repo.getTree('doc-1');

    expect(tree.sectionId).toBe('doc-1');
    expect(tree.children.map((c) => c.sectionId)).toEqual(['a', 'b']);
    const nodeA = tree.children[0];
    expect(nodeA.children.map((c) => c.sectionId)).toEqual(['a-1', 'a-2']);
    expect(tree.children[1].children).toEqual([]);
  });

  it('rejects a depth-4 insert without writing any of the batch', async () => {
    await repo.insertDocument(doc());
    const sections = [
      section({ id: 'ok', depth: 0 }),
      section({ id: 'too-deep', depth: 4, parentId: 'ok' }),
    ];

    await expect(repo.insertSections(sections)).rejects.toBeInstanceOf(SectionDepthError);

    const tree = await repo.getTree('doc-1');
    expect(tree.children).toEqual([]);
  });

  it('lists and fetches documents', async () => {
    await repo.insertDocument(doc({ id: 'doc-1', title: 'First' }));
    await repo.insertDocument(doc({ id: 'doc-2', title: 'Second', createdAt: '2026-01-02T00:00:00.000Z' }));

    expect(await repo.getDocument('doc-2')).toMatchObject({ title: 'Second' });
    expect(await repo.getDocument('missing')).toBeUndefined();
    const all = await repo.listDocuments();
    expect(all.map((d) => d.id)).toEqual(['doc-1', 'doc-2']);
  });

  it('round-trips meta as JSON', async () => {
    await repo.insertDocument(doc({ meta: { labelStrategy: 'heuristic' } }));
    const read = await repo.getDocument('doc-1');
    expect(read?.meta).toEqual({ labelStrategy: 'heuristic' });
  });

  describe('sections_fts sync', () => {
    it('indexes a section on insert', async () => {
      await repo.insertDocument(doc());
      await repo.insertSections([section({ id: 's-1', heading: 'Photosynthesis', content: 'Plants and light' })]);

      const hits = await engine.query<{ id: string }>(
        `SELECT s.id FROM sections_fts f JOIN sections s ON s.rowid = f.rowid WHERE sections_fts MATCH 'photosynthesis'`,
      );
      expect(hits.map((h) => h.id)).toEqual(['s-1']);
    });

    it('updates the index when a section is updated', async () => {
      await repo.insertDocument(doc());
      await repo.insertSections([section({ id: 's-1', heading: 'First heading', content: 'walrus content' })]);

      await engine.exec('UPDATE sections SET content = ? WHERE id = ?', ['zebra migration patterns', 's-1']);

      const oldHits = await engine.query<{ id: string }>(
        `SELECT s.id FROM sections_fts f JOIN sections s ON s.rowid = f.rowid WHERE sections_fts MATCH 'walrus'`,
      );
      expect(oldHits).toEqual([]);

      const newHits = await engine.query<{ id: string }>(
        `SELECT s.id FROM sections_fts f JOIN sections s ON s.rowid = f.rowid WHERE sections_fts MATCH 'zebra'`,
      );
      expect(newHits.map((h) => h.id)).toEqual(['s-1']);
    });

    it('removes the index entry when a section is deleted directly', async () => {
      await repo.insertDocument(doc());
      await repo.insertSections([section({ id: 's-1', heading: 'Removable', content: 'gone soon' })]);
      await engine.exec('DELETE FROM sections WHERE id = ?', ['s-1']);

      const hits = await engine.query('SELECT * FROM sections_fts WHERE sections_fts MATCH \'removable\'');
      expect(hits).toEqual([]);
    });

    it('cascades from deleteDocument through sections into the fts index', async () => {
      await repo.insertDocument(doc());
      await repo.insertSections([section({ id: 's-1', heading: 'Cascade me', content: 'body' })]);

      await repo.deleteDocument('doc-1');

      const sectionRows = await engine.query('SELECT * FROM sections');
      expect(sectionRows).toEqual([]);
      const hits = await engine.query('SELECT * FROM sections_fts WHERE sections_fts MATCH \'cascade\'');
      expect(hits).toEqual([]);
    });
  });
});
