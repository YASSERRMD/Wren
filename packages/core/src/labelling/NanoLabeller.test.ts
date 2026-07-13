import { describe, expect, it } from 'vitest';
import { MockNanoAdapter } from '../nano/MockNanoAdapter.js';
import type { WrenSection } from '../types.js';
import { NanoLabeller } from './NanoLabeller.js';
import type { IngestProgress } from './progress.js';

function section(overrides: Partial<WrenSection> = {}): WrenSection {
  return {
    id: 's1',
    docId: 'd1',
    parentId: null,
    ordinal: 0,
    depth: 0,
    heading: 'H',
    content: 'short content',
    label: '',
    ...overrides,
  };
}

/**
 * Tight enough that a lone 600-char section's solo prompt (177 tokens) just
 * fits, but that same section combined with a second one in a batch prompt
 * (205 tokens) does not; a pair of "short content" sections batches
 * together fine (58 tokens). Paired with budgetRatio 1 so budget ==
 * inputQuota directly, avoiding a second layer of arithmetic in the test.
 */
const TIGHT_QUOTA = { inputQuota: 190, contextWindow: 190, usage: 0 };

describe('NanoLabeller', () => {
  it('batches several short sections into one call', async () => {
    const mock = new MockNanoAdapter([JSON.stringify({ labels: ['label A', 'label B', 'label C'] })]);
    const labeller = new NanoLabeller(mock);
    const sections = [
      section({ id: 'a', heading: 'A' }),
      section({ id: 'b', heading: 'B' }),
      section({ id: 'c', heading: 'C' }),
    ];

    const results = await labeller.generateLabels(sections);

    expect(mock.callLog).toHaveLength(1);
    expect(results.map((r) => r.label)).toEqual(['label A', 'label B', 'label C']);
    expect(results.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('sends a response schema constraining the array length to the batch size', async () => {
    const mock = new MockNanoAdapter([JSON.stringify({ labels: ['x', 'y'] })]);
    const labeller = new NanoLabeller(mock);
    await labeller.generateLabels([section({ id: 'a' }), section({ id: 'b' })]);

    const schema = mock.callLog[0].opts?.responseConstraint as {
      properties: { labels: { minItems: number; maxItems: number } };
    };
    expect(schema.properties.labels.minItems).toBe(2);
    expect(schema.properties.labels.maxItems).toBe(2);
  });

  it('falls back to one call per section when a batch would exceed the live quota', async () => {
    const mock = new MockNanoAdapter(
      [JSON.stringify({ label: 'long one label' }), JSON.stringify({ label: 'short two label' })],
      TIGHT_QUOTA,
    );
    const labeller = new NanoLabeller(mock, 1);
    const sections = [
      section({ id: 'long', content: 'x'.repeat(600) }),
      section({ id: 'short', content: 'y' }),
    ];

    const results = await labeller.generateLabels(sections);

    expect(mock.callLog).toHaveLength(2);
    expect(results.map((r) => r.label)).toEqual(['long one label', 'short two label']);
    // The section that fit its own budget solo is sent whole, unlike the oversized case below.
    expect(mock.callLog[0].input).toContain('x'.repeat(600));
  });

  it('truncates a single section that does not fit the live quota even alone', async () => {
    const mock = new MockNanoAdapter([JSON.stringify({ label: 'trimmed label' })], {
      inputQuota: 50,
      contextWindow: 50,
      usage: 0,
    });
    const labeller = new NanoLabeller(mock, 1);
    const original = section({ id: 'huge', content: 'x'.repeat(600) });

    const results = await labeller.generateLabels([original]);

    expect(mock.callLog).toHaveLength(1);
    expect(mock.callLog[0].input).toContain('...');
    expect(mock.callLog[0].input.length).toBeLessThan(200);
    // Truncation is scoped to the outgoing prompt; the returned section keeps its full content.
    expect(results[0].content).toBe(original.content);
    expect(results[0].label).toBe('trimmed label');
  });

  it('reports progress once per batch, reaching total', async () => {
    const mock = new MockNanoAdapter(
      [JSON.stringify({ label: 'a' }), JSON.stringify({ labels: ['b', 'c'] })],
      TIGHT_QUOTA,
    );
    const labeller = new NanoLabeller(mock, 1);
    const events: IngestProgress[] = [];

    await labeller.generateLabels(
      [
        section({ id: 'long', content: 'x'.repeat(600) }),
        section({ id: 'b' }),
        section({ id: 'c' }),
      ],
      (p) => events.push(p),
    );

    expect(events).toEqual([
      { phase: 'labelling', current: 1, total: 3 },
      { phase: 'labelling', current: 3, total: 3 },
    ]);
  });
});
