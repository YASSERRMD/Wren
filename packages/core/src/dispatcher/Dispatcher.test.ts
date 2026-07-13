import { beforeEach, describe, expect, it } from 'vitest';
import { DocumentRepository } from '../documents/DocumentRepository.js';
import { ADD_CONTENT_HASH_MIGRATION, INITIAL_MIGRATION } from '../documents/migrations.js';
import { MockNanoAdapter } from '../nano/MockNanoAdapter.js';
import { LexicalRetriever } from '../retrieval/LexicalRetriever.js';
import { applyMigrations, type SqlEngine } from '../storage/migrations.js';
import { createNodeSqlEngine } from '../test-support/node-sql-engine.js';
import { ToolRegistry } from '../tools/ToolRegistry.js';
import type { WrenSection } from '../types.js';
import { Dispatcher } from './Dispatcher.js';

function section(overrides: Partial<WrenSection> = {}): WrenSection {
  return {
    id: 's1',
    docId: 'd1',
    parentId: null,
    ordinal: 0,
    depth: 0,
    heading: 'Heading',
    content: 'Section content',
    label: 'A short label',
    ...overrides,
  };
}

describe('Dispatcher', () => {
  let engine: SqlEngine;
  let repo: DocumentRepository;
  let retriever: LexicalRetriever;
  let registry: ToolRegistry;

  beforeEach(async () => {
    engine = await createNodeSqlEngine();
    await applyMigrations(engine, [INITIAL_MIGRATION, ADD_CONTENT_HASH_MIGRATION]);
    repo = new DocumentRepository(engine);
    retriever = new LexicalRetriever(engine);
    registry = new ToolRegistry();
    await repo.insertDocument({ id: 'd1', title: 'Doc', sourceType: 'markdown', createdAt: '2026-01-01T00:00:00.000Z' });
  });

  describe('answer action', () => {
    it('answers using the chosen section and assembles a citation from it', async () => {
      await repo.insertSections([
        section({ id: 's1', heading: 'Photosynthesis', content: 'Plants convert light into energy.', label: 'About plants' }),
      ]);
      const nano = new MockNanoAdapter([
        JSON.stringify({ action: 'answer', sectionIds: ['s1'] }),
        'Plants use light to make energy.',
      ]);
      const dispatcher = new Dispatcher(nano, retriever, repo, registry);

      const response = await dispatcher.run('how do plants get energy?');

      expect(response.action).toBe('answer');
      expect(response.answer).toBe('Plants use light to make energy.');
      expect(response.hops).toBe(0);
      expect(response.citations).toEqual([
        { sectionId: 's1', heading: 'Photosynthesis', snippet: 'Plants convert light into energy.' },
      ]);
    });
  });

  describe('tool action', () => {
    it('invokes the chosen tool and answers using its result', async () => {
      registry.register({
        name: 'get_weather',
        description: 'looks up the weather',
        inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
        execute: async (args) => ({ content: `Sunny in ${String(args.city)}` }),
      });
      const nano = new MockNanoAdapter([
        JSON.stringify({ action: 'tool', tool: 'get_weather', args: { city: 'Lagos' } }),
        'It is sunny in Lagos.',
      ]);
      const dispatcher = new Dispatcher(nano, retriever, repo, registry);

      const response = await dispatcher.run('what is the weather in Lagos?');

      expect(response.action).toBe('tool');
      expect(response.answer).toBe('It is sunny in Lagos.');
      expect(response.toolCall).toEqual({
        name: 'get_weather',
        args: { city: 'Lagos' },
        result: 'Sunny in Lagos',
      });
      expect(response.citations).toEqual([]);
    });

    it('steers the follow-up prompt toward prose instead of echoing the tool call JSON', async () => {
      registry.register({
        name: 'get_weather',
        description: 'looks up the weather',
        inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
        execute: async (args) => ({ content: `Sunny in ${String(args.city)}` }),
      });
      const nano = new MockNanoAdapter([
        JSON.stringify({ action: 'tool', tool: 'get_weather', args: { city: 'Lagos' } }),
        'It is sunny in Lagos.',
      ]);
      const dispatcher = new Dispatcher(nano, retriever, repo, registry);

      await dispatcher.run('what is the weather in Lagos?');

      const followupPrompt = nano.callLog[1].input;
      expect(followupPrompt).toContain('Sunny in Lagos');
      expect(followupPrompt).toContain('Write one short, natural-language sentence');
      expect(followupPrompt).toContain('Do not repeat the tool name, its arguments, or any JSON');
    });

    it('surfaces isError on the toolCall when the tool rejects its arguments', async () => {
      registry.register({
        name: 'select_option',
        description: 'chooses an option',
        inputSchema: { type: 'object', properties: { option: { type: 'string' } }, required: ['option'] },
        execute: async (args) => ({ content: `"${String(args.option)}" is not a valid option`, isError: true }),
      });
      const nano = new MockNanoAdapter([
        JSON.stringify({ action: 'tool', tool: 'select_option', args: { option: 'bogus' } }),
        'select_option {"option":"bogus"}',
      ]);
      const dispatcher = new Dispatcher(nano, retriever, repo, registry);

      const response = await dispatcher.run('pick an option');

      expect(response.toolCall).toEqual({
        name: 'select_option',
        args: { option: 'bogus' },
        result: '"bogus" is not a valid option',
        isError: true,
      });
    });
  });

  describe('decision id mismatch', () => {
    it('warns when decide() returns a sectionId absent from the candidates it was shown', async () => {
      await repo.insertSections([
        section({ id: 's1', heading: 'Photosynthesis', content: 'Plants convert light into energy.', label: 'About plants' }),
      ]);
      const nano = new MockNanoAdapter([
        JSON.stringify({ action: 'answer', sectionIds: ['s1', 'ghost'] }),
        'Plants use light to make energy.',
      ]);
      const dispatcher = new Dispatcher(nano, retriever, repo, registry);

      const response = await dispatcher.run('how do plants get energy?');

      expect(response.action).toBe('answer');
      expect(response.citations).toEqual([
        { sectionId: 's1', heading: 'Photosynthesis', snippet: 'Plants convert light into energy.' },
      ]);
      expect(response.warnings).toContainEqual({
        kind: 'decision-id-mismatch',
        detail: 'decide() returned sectionIds not present in the candidates it was shown: ghost',
      });
    });
  });

  describe('navigate action', () => {
    it('follows a single navigate hop into a child section and then answers', async () => {
      await repo.insertSections([
        section({ id: 'parent', heading: 'Parent', content: 'overview', label: 'Overview section' }),
        section({ id: 'child', parentId: 'parent', depth: 1, heading: 'Child', content: 'the real detail', label: 'Detail section' }),
      ]);
      const nano = new MockNanoAdapter([
        JSON.stringify({ action: 'navigate', sectionId: 'parent' }),
        JSON.stringify({ action: 'answer', sectionIds: ['child'] }),
        'Here is the detail.',
      ]);
      const dispatcher = new Dispatcher(nano, retriever, repo, registry);

      const response = await dispatcher.run('tell me the detail');

      expect(response.action).toBe('answer');
      expect(response.hops).toBe(1);
      expect(response.answer).toBe('Here is the detail.');
      expect(response.warnings).toEqual([]);
    });
  });

  describe('none action', () => {
    it('reports no answer found, with zero hops and no citations', async () => {
      const nano = new MockNanoAdapter([JSON.stringify({ action: 'none', reason: 'nothing in the corpus matches' })]);
      const dispatcher = new Dispatcher(nano, retriever, repo, registry);

      const response = await dispatcher.run('something totally unrelated');

      expect(response.action).toBe('none');
      expect(response.answer).toBe('No answer found: nothing in the corpus matches');
      expect(response.hops).toBe(0);
      expect(response.citations).toEqual([]);
    });
  });

  describe('hop cap', () => {
    beforeEach(async () => {
      await repo.insertSections([
        section({ id: 'parent', heading: 'Parent', content: 'find the detail here', label: 'Overview section' }),
        section({ id: 'child', parentId: 'parent', depth: 1, heading: 'Child', content: 'the actual detail content', label: 'Detail section' }),
      ]);
    });

    it('forces an answer on the best remaining candidate when a second navigate is attempted', async () => {
      const nano = new MockNanoAdapter([
        JSON.stringify({ action: 'navigate', sectionId: 'parent' }),
        JSON.stringify({ action: 'navigate', sectionId: 'child' }),
        'Here is the detail.',
      ]);
      const dispatcher = new Dispatcher(nano, retriever, repo, registry);

      const response = await dispatcher.run('detail');

      expect(response.hops).toBe(1);
      expect(response.action).toBe('answer');
      expect(response.answer).toBe('Here is the detail.');
      expect(response.citations).toEqual([{ sectionId: 'child', heading: 'Child', snippet: 'the actual detail content' }]);
      expect(response.warnings).toContainEqual(
        expect.objectContaining({ kind: 'hop-cap-forced' }),
      );
      expect(nano.callLog).toHaveLength(3);
    });

    it('coerces to a none action when a second navigate is attempted with no candidates to fall back on', async () => {
      const nano = new MockNanoAdapter([
        JSON.stringify({ action: 'navigate', sectionId: 'child' }),
        JSON.stringify({ action: 'navigate', sectionId: 'does-not-exist' }),
      ]);
      const dispatcher = new Dispatcher(nano, retriever, repo, registry);

      // 'child' has no children of its own, so the second navigate hop's
      // candidate list is empty and there is nothing left to fall back on.
      const response = await dispatcher.run('detail');

      expect(response.hops).toBe(1);
      expect(response.action).toBe('none');
      expect(response.answer).toBe('No answer found: Navigation was exhausted with no candidates left to answer from.');
      expect(response.warnings).toContainEqual(
        expect.objectContaining({ kind: 'hop-cap-forced' }),
      );
    });
  });

  describe('budget truncation', () => {
    it('drops decision candidates from the end until the prompt fits the budget', async () => {
      await repo.insertSections([
        section({ id: 'a', heading: 'Widget A', content: 'a widget', label: 'First widget' }),
        section({ id: 'b', ordinal: 1, heading: 'Widget B', content: 'a widget', label: 'Second widget' }),
        section({ id: 'c', ordinal: 2, heading: 'Widget C', content: 'a widget', label: 'Third widget' }),
      ]);
      const nano = new MockNanoAdapter([JSON.stringify({ action: 'none', reason: 'stop here' })]);
      nano.setQuota({ inputQuota: 50, contextWindow: 50, usage: 0 });
      const dispatcher = new Dispatcher(nano, retriever, repo, registry);

      const response = await dispatcher.run('widget');

      expect(response.warnings).toContainEqual(
        expect.objectContaining({ kind: 'budget-truncated' }),
      );
      const decisionPrompt = nano.callLog[0].input;
      const idsPresent = ['a', 'b', 'c'].filter((id) => decisionPrompt.includes(`${id}:`));
      expect(idsPresent).toHaveLength(1);
    });

    it('truncates a single remaining section content when it alone still exceeds the budget', async () => {
      const hugeContent = 'x'.repeat(5000);
      await repo.insertSections([section({ id: 's1', heading: 'Huge', content: hugeContent, label: 'A very long section' })]);
      const nano = new MockNanoAdapter([
        JSON.stringify({ action: 'answer', sectionIds: ['s1'] }),
        'Short answer.',
      ]);
      nano.setQuota({ inputQuota: 100, contextWindow: 100, usage: 0 });
      const dispatcher = new Dispatcher(nano, retriever, repo, registry);

      const response = await dispatcher.run('huge');

      expect(response.answer).toBe('Short answer.');
      expect(response.warnings).toContainEqual(
        expect.objectContaining({ detail: 'Truncated the answer section content to fit the token budget.' }),
      );
      const answerPrompt = nano.callLog[1].input;
      expect(answerPrompt.length).toBeLessThan(hugeContent.length);
    });
  });
});
