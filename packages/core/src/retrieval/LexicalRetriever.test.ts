import { beforeEach, describe, expect, it } from 'vitest';
import { DocumentRepository } from '../documents/DocumentRepository.js';
import { ADD_CONTENT_HASH_MIGRATION, INITIAL_MIGRATION } from '../documents/migrations.js';
import { applyMigrations, type SqlEngine } from '../storage/migrations.js';
import { createNodeSqlEngine } from '../test-support/node-sql-engine.js';
import type { WrenSection } from '../types.js';
import { LexicalRetriever } from './LexicalRetriever.js';

function section(overrides: Partial<WrenSection> = {}): WrenSection {
  return {
    id: 's1',
    docId: 'd1',
    parentId: null,
    ordinal: 0,
    depth: 0,
    heading: 'H',
    content: 'content',
    label: 'L',
    ...overrides,
  };
}

describe('LexicalRetriever', () => {
  let engine: SqlEngine;
  let repo: DocumentRepository;
  let retriever: LexicalRetriever;

  beforeEach(async () => {
    engine = await createNodeSqlEngine();
    await applyMigrations(engine, [INITIAL_MIGRATION, ADD_CONTENT_HASH_MIGRATION]);
    repo = new DocumentRepository(engine);
    retriever = new LexicalRetriever(engine);
    await repo.insertDocument({ id: 'd1', title: 'Doc', sourceType: 'markdown', createdAt: '2026-01-01T00:00:00.000Z' });
  });

  describe('search', () => {
    it('ranks a heading match above a body-text match', async () => {
      await repo.insertSections([
        section({ id: 'a', heading: 'Photosynthesis', content: 'Plants use light.', label: 'About plants' }),
        section({
          id: 'b',
          heading: 'Weather Patterns',
          content: 'This mentions photosynthesis in passing, deep in the body text, only once.',
          label: 'About weather',
        }),
      ]);

      const results = await retriever.search('photosynthesis');

      expect(results[0].sectionId).toBe('a');
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('ranks a label match above a body-text match', async () => {
      await repo.insertSections([
        section({ id: 'a', heading: 'Section One', content: 'unrelated body copy here', label: 'Discusses giraffes' }),
        section({
          id: 'b',
          heading: 'Section Two',
          content: 'This one talks about giraffes deep in the paragraph, just once, in passing.',
          label: 'Something else entirely',
        }),
      ]);

      const results = await retriever.search('giraffes');

      expect(results[0].sectionId).toBe('a');
    });

    it('neutralises FTS5 operators in a user query rather than throwing', async () => {
      await repo.insertSections([section({ id: 'a', content: 'cats and dogs' })]);

      const results = await retriever.search('cats dogs "*" (');

      expect(results).toHaveLength(1);
    });

    it('treats stopword-shaped operator keywords as harmless, dropped words', async () => {
      await repo.insertSections([section({ id: 'a', content: 'cats and dogs' })]);

      const results = await retriever.search('cats NOT dogs OR');

      expect(results).toHaveLength(1);
    });

    it('applies the limit option', async () => {
      await repo.insertSections([
        section({ id: 'a', heading: 'apple one', content: 'apple' }),
        section({ id: 'b', ordinal: 1, heading: 'apple two', content: 'apple' }),
      ]);

      expect(await retriever.search('apple', { limit: 1 })).toHaveLength(1);
    });

    it('applies the docIds filter', async () => {
      await repo.insertDocument({ id: 'd2', title: 'Doc2', sourceType: 'markdown', createdAt: '2026-01-01T00:00:00.000Z' });
      await repo.insertSections([section({ id: 'a', docId: 'd1', heading: 'apple one', content: 'apple' })]);
      await repo.insertSections([section({ id: 'c', docId: 'd2', heading: 'apple three', content: 'apple' })]);

      const results = await retriever.search('apple', { docIds: ['d2'] });

      expect(results.map((r) => r.sectionId)).toEqual(['c']);
    });

    it('returns an empty array for zero results, does not throw', async () => {
      await repo.insertSections([section({ id: 'a', content: 'something else entirely' })]);

      expect(await retriever.search('nonexistentterm')).toEqual([]);
    });

    it('returns an empty array for a query that tokenises to nothing', async () => {
      expect(await retriever.search('')).toEqual([]);
      expect(await retriever.search('*** "" (')).toEqual([]);
    });
  });

  describe('getChildren and getSiblings', () => {
    beforeEach(async () => {
      await repo.insertSections([
        section({ id: 'a', heading: 'A' }),
        section({ id: 'a1', parentId: 'a', depth: 1, heading: 'A1' }),
        section({ id: 'a2', parentId: 'a', ordinal: 1, depth: 1, heading: 'A2' }),
        section({ id: 'b', ordinal: 1, heading: 'B' }),
      ]);
    });

    it('getChildren returns direct children in ordinal order', async () => {
      const children = await retriever.getChildren('a');
      expect(children.map((c) => c.sectionId)).toEqual(['a1', 'a2']);
    });

    it('getSiblings excludes the section itself and returns others at the same level', async () => {
      expect((await retriever.getSiblings('a1')).map((c) => c.sectionId)).toEqual(['a2']);
    });

    it('getSiblings handles top-level (NULL parent_id) sections correctly', async () => {
      expect((await retriever.getSiblings('a')).map((c) => c.sectionId)).toEqual(['b']);
    });

    it('getChildren and getSiblings return an empty array rather than throwing for an unknown id', async () => {
      expect(await retriever.getChildren('does-not-exist')).toEqual([]);
      expect(await retriever.getSiblings('does-not-exist')).toEqual([]);
    });
  });
});
