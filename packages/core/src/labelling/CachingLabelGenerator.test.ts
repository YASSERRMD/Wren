import { beforeEach, describe, expect, it } from 'vitest';
import { DocumentRepository } from '../documents/DocumentRepository.js';
import { ADD_CONTENT_HASH_MIGRATION, INITIAL_MIGRATION } from '../documents/migrations.js';
import { MockNanoAdapter } from '../nano/MockNanoAdapter.js';
import { applyMigrations, type SqlEngine } from '../storage/migrations.js';
import { createNodeSqlEngine } from '../test-support/node-sql-engine.js';
import type { WrenSection } from '../types.js';
import { CachingLabelGenerator, type LabelCache } from './CachingLabelGenerator.js';
import { hashContent } from './contentHash.js';
import { NanoLabeller } from './NanoLabeller.js';
import type { IngestProgress } from './progress.js';

function section(overrides: Partial<WrenSection> = {}): WrenSection {
  return {
    id: 's1',
    docId: 'doc-1',
    parentId: null,
    ordinal: 0,
    depth: 0,
    heading: 'H',
    content: 'unique content here',
    label: '',
    ...overrides,
  };
}

describe('CachingLabelGenerator', () => {
  describe('against a real DocumentRepository', () => {
    let engine: SqlEngine;
    let repo: DocumentRepository;

    beforeEach(async () => {
      engine = await createNodeSqlEngine();
      await applyMigrations(engine, [INITIAL_MIGRATION, ADD_CONTENT_HASH_MIGRATION]);
      repo = new DocumentRepository(engine);
      await repo.insertDocument({
        id: 'doc-1',
        title: 'Doc',
        sourceType: 'markdown',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    });

    it('skips the LLM entirely on re-ingest of unchanged content', async () => {
      const mock = new MockNanoAdapter([JSON.stringify({ label: 'generated label' })]);
      const caching = new CachingLabelGenerator(new NanoLabeller(mock), repo);

      const firstIngest = await caching.generateLabels([section({ id: 's1' })]);
      expect(firstIngest[0].label).toBe('generated label');
      expect(mock.callLog).toHaveLength(1);
      await repo.insertSections(firstIngest);

      // Same content, a fresh section id, as parse() would produce on
      // re-parse: no more queued mock responses at all.
      const secondIngest = await caching.generateLabels([
        section({ id: 'a-completely-different-id', content: 'unique content here' }),
      ]);

      expect(secondIngest[0].label).toBe('generated label');
      expect(mock.callLog).toHaveLength(1);
    });

    it('still calls the LLM for genuinely new content', async () => {
      const mock = new MockNanoAdapter([
        JSON.stringify({ label: 'label one' }),
        JSON.stringify({ label: 'label two' }),
      ]);
      const caching = new CachingLabelGenerator(new NanoLabeller(mock), repo);

      await repo.insertSections(await caching.generateLabels([section({ id: 's1', content: 'first content' })]));
      const results = await caching.generateLabels([section({ id: 's2', content: 'second content' })]);

      expect(results[0].label).toBe('label two');
      expect(mock.callLog).toHaveLength(2);
    });
  });

  it('offsets the wrapped generator progress by the cache-hit count', async () => {
    const events: IngestProgress[] = [];
    const cachedHash = await hashContent('unique content here');
    const cache: LabelCache = {
      findCachedLabel: async (hash) => (hash === cachedHash ? 'cached label' : undefined),
    };
    // Tight enough that the two 600-char sections below (177 tokens solo
    // each, 351 batched together) can't share a call, so each becomes its
    // own single-label response as the queue below expects.
    const mock = new MockNanoAdapter([JSON.stringify({ label: 'a' }), JSON.stringify({ label: 'b' })], {
      inputQuota: 250,
      contextWindow: 250,
      usage: 0,
    });
    const caching = new CachingLabelGenerator(new NanoLabeller(mock, 1), cache);

    const results = await caching.generateLabels(
      [
        section({ id: 'x', content: 'x'.repeat(600) }),
        section({ id: 'y', content: 'y'.repeat(600) }),
        section({ id: 'z' }),
      ],
      (p) => events.push(p),
    );

    expect(results.map((r) => r.label)).toEqual(['a', 'b', 'cached label']);
    expect(events.at(-1)).toEqual({ phase: 'labelling', current: 3, total: 3 });
    for (const e of events) {
      expect(e.current).toBeLessThanOrEqual(e.total);
    }
  });
});
