import { describe, expect, it } from 'vitest';
import { parseText } from './textParser.js';

describe('parseText', () => {
  it('produces a sensible flat list with no headings', () => {
    const text = 'Para one.\n\nPara two.\n\nPara three.';
    const { sections, warnings } = parseText('doc-1', text, 'My Notes', 1000);

    expect(warnings).toEqual([]);
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      heading: 'My Notes',
      content: 'Para one.\n\nPara two.\n\nPara three.',
      depth: 0,
      parentId: null,
      ordinal: 0,
    });
  });

  it('groups into multiple flat sections once the target size is exceeded', () => {
    const text = ['a'.repeat(60), 'b'.repeat(60), 'c'.repeat(60)].join('\n\n');
    const { sections } = parseText('doc-1', text, 'My Notes', 100);

    expect(sections.length).toBeGreaterThan(1);
    expect(sections.every((s) => s.parentId === null && s.depth === 0)).toBe(true);
    expect(sections.map((s) => s.ordinal)).toEqual(sections.map((_, i) => i));
    expect(sections.map((s) => s.heading)).toEqual(sections.map((_, i) => `Section ${i + 1}`));
  });

  it('ignores blank-line runs of any length as paragraph separators', () => {
    const text = 'One.\n\n\n\nTwo.';
    const { sections } = parseText('doc-1', text, 'Notes', 1000);
    expect(sections[0].content).toBe('One.\n\nTwo.');
  });
});
