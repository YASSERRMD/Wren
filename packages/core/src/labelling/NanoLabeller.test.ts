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

  it('falls back to one call per section when a section is long', async () => {
    const mock = new MockNanoAdapter([
      JSON.stringify({ label: 'long one label' }),
      JSON.stringify({ label: 'short two label' }),
    ]);
    const labeller = new NanoLabeller(mock);
    const sections = [
      section({ id: 'long', content: 'x'.repeat(600) }),
      section({ id: 'short', content: 'y' }),
    ];

    const results = await labeller.generateLabels(sections);

    expect(mock.callLog).toHaveLength(2);
    expect(results.map((r) => r.label)).toEqual(['long one label', 'short two label']);
  });

  it('reports progress once per batch, reaching total', async () => {
    const mock = new MockNanoAdapter([
      JSON.stringify({ label: 'a' }),
      JSON.stringify({ labels: ['b', 'c'] }),
    ]);
    const labeller = new NanoLabeller(mock);
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
