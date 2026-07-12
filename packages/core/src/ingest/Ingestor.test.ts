import { describe, expect, it, vi } from 'vitest';
import { DocumentRepository } from '../documents/DocumentRepository.js';
import { ADD_CONTENT_HASH_MIGRATION, INITIAL_MIGRATION } from '../documents/migrations.js';
import { applyMigrations, type SqlEngine } from '../storage/migrations.js';
import { createNodeSqlEngine } from '../test-support/node-sql-engine.js';
import { Ingestor } from './Ingestor.js';

async function makeRepo(): Promise<{ engine: SqlEngine; repo: DocumentRepository }> {
  const engine = await createNodeSqlEngine();
  await applyMigrations(engine, [INITIAL_MIGRATION, ADD_CONTENT_HASH_MIGRATION]);
  return { engine, repo: new DocumentRepository(engine) };
}

describe('Ingestor', () => {
  it('full ingest produces queryable FTS rows', async () => {
    const { engine, repo } = await makeRepo();
    const ingestor = new Ingestor(repo);

    const result = await ingestor.ingest(
      { type: 'markdown', content: '# Zebras\n\nStripes are neat.', title: 'Doc' },
      { labeller: 'heuristic' },
    );

    expect(result.sectionCount).toBe(1);
    expect(result.labelStrategy).toBe('heuristic');
    expect(typeof result.durationMs).toBe('number');

    const hits = await engine.query(
      `SELECT s.id FROM sections_fts f JOIN sections s ON s.rowid = f.rowid WHERE sections_fts MATCH 'zebras'`,
    );
    expect(hits).toHaveLength(1);

    const doc = await repo.getDocument(result.docId);
    expect(doc?.meta).toEqual({ labelStrategy: 'heuristic' });
  });

  it('second ingest of identical source replaces, does not duplicate', async () => {
    const { repo } = await makeRepo();
    const ingestor = new Ingestor(repo);
    const source = { type: 'text' as const, content: 'Same content every time.', title: 'Notes' };

    const first = await ingestor.ingest(source, { labeller: 'heuristic' });
    const second = await ingestor.ingest(source, { labeller: 'heuristic' });

    expect(second.docId).toBe(first.docId);
    expect(await repo.listDocuments()).toHaveLength(1);
  });

  it('two different sources ingest as two separate documents', async () => {
    const { repo } = await makeRepo();
    const ingestor = new Ingestor(repo);

    await ingestor.ingest({ type: 'text', content: 'First.', title: 'A' }, { labeller: 'heuristic' });
    await ingestor.ingest({ type: 'text', content: 'Second.', title: 'B' }, { labeller: 'heuristic' });

    expect(await repo.listDocuments()).toHaveLength(2);
  });

  it('an explicit docId overrides the derived stable id', async () => {
    const { repo } = await makeRepo();
    const ingestor = new Ingestor(repo);

    const result = await ingestor.ingest(
      { type: 'text', content: 'Anything.', title: 'Notes' },
      { labeller: 'heuristic', docId: 'my-custom-id' },
    );

    expect(result.docId).toBe('my-custom-id');
  });

  it('abort mid-ingest leaves no partial document', async () => {
    const { repo } = await makeRepo();
    const ingestor = new Ingestor(repo);
    const controller = new AbortController();

    const promise = ingestor.ingest(
      { type: 'text', content: 'One.\n\nTwo.\n\nThree.', title: 'Notes' },
      {
        labeller: 'heuristic',
        signal: controller.signal,
        onProgress: (p) => {
          if (p.phase === 'labelling' && p.current === 1) controller.abort();
        },
      },
    );

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(await repo.listDocuments()).toEqual([]);
  });

  it('respects a custom abort reason', async () => {
    const { repo } = await makeRepo();
    const ingestor = new Ingestor(repo);
    const controller = new AbortController();
    const reason = new Error('custom reason');

    const promise = ingestor.ingest(
      { type: 'text', content: 'One.\n\nTwo.', title: 'Notes' },
      {
        labeller: 'heuristic',
        signal: controller.signal,
        onProgress: () => controller.abort(reason),
      },
    );

    await expect(promise).rejects.toBe(reason);
  });

  it('progress callback fires for each phase', async () => {
    const { repo } = await makeRepo();
    const ingestor = new Ingestor(repo);
    const onProgress = vi.fn();

    await ingestor.ingest(
      { type: 'text', content: 'Only paragraph.', title: 'Notes' },
      { labeller: 'heuristic', onProgress },
    );

    const phases = onProgress.mock.calls.map((c) => c[0].phase);
    expect(phases).toContain('parsing');
    expect(phases).toContain('labelling');
    expect(phases).toContain('indexing');
  });

  describe('reindex', () => {
    it('repopulates FTS without re-parsing or re-labelling', async () => {
      const { engine, repo } = await makeRepo();
      const ingestor = new Ingestor(repo);
      const result = await ingestor.ingest(
        { type: 'text', content: 'Giraffes have long necks.', title: 'Doc' },
        { labeller: 'heuristic' },
      );

      await engine.exec('DELETE FROM sections_fts');
      let hits = await engine.query("SELECT * FROM sections_fts WHERE sections_fts MATCH 'giraffes'");
      expect(hits).toEqual([]);

      await ingestor.reindex(result.docId);

      hits = await engine.query("SELECT * FROM sections_fts WHERE sections_fts MATCH 'giraffes'");
      expect(hits).toHaveLength(1);
    });
  });
});
