import { describe, expect, it } from 'vitest';
import type { WrenSection } from '../types.js';
import { HeuristicLabeller } from './HeuristicLabeller.js';
import type { IngestProgress } from './progress.js';

function section(overrides: Partial<WrenSection> = {}): WrenSection {
  return {
    id: 's1',
    docId: 'd1',
    parentId: null,
    ordinal: 0,
    depth: 0,
    heading: '',
    content: '',
    label: '',
    ...overrides,
  };
}

describe('HeuristicLabeller', () => {
  it('produces a label from a descriptive heading', async () => {
    const labeller = new HeuristicLabeller();
    const [result] = await labeller.generateLabels([
      section({ heading: 'Eligibility Requirements for First-Time Applicants', content: 'x' }),
    ]);
    expect(result.label).toBe('Eligibility Requirements for First-Time Applicants');
  });

  it('augments a short or generic heading with the first sentence', async () => {
    const labeller = new HeuristicLabeller();
    const [result] = await labeller.generateLabels([
      section({ heading: 'Overview', content: 'This form covers annual leave requests. More detail follows.' }),
    ]);
    expect(result.label).toContain('Overview');
    expect(result.label).toContain('This form covers annual leave requests');
  });

  it('falls back to the first sentence when there is no heading', async () => {
    const labeller = new HeuristicLabeller();
    const [result] = await labeller.generateLabels([
      section({ heading: '', content: 'Untitled content starts here. And continues.' }),
    ]);
    expect(result.label).toBe('Untitled content starts here.');
  });

  it('never produces a label longer than 20 words', async () => {
    const labeller = new HeuristicLabeller();
    const longHeading = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const [result] = await labeller.generateLabels([section({ heading: longHeading })]);
    expect(result.label.split(/\s+/)).toHaveLength(20);
  });

  it('reports progress reaching total across multiple sections', async () => {
    const events: IngestProgress[] = [];
    const labeller = new HeuristicLabeller();
    await labeller.generateLabels(
      [section({ id: 'a' }), section({ id: 'b' }), section({ id: 'c' })],
      (p) => events.push(p),
    );
    expect(events).toEqual([
      { phase: 'labelling', current: 1, total: 3 },
      { phase: 'labelling', current: 2, total: 3 },
      { phase: 'labelling', current: 3, total: 3 },
    ]);
  });
});
