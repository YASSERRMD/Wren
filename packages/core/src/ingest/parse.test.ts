import { describe, expect, it } from 'vitest';
import { parse } from './parse.js';

describe('parse', () => {
  it('flattens a depth-6 HTML document (h1..h6) to depth 3, with a warning per too-deep level', () => {
    const html = `
      <h1>L1</h1><p>l1 content</p>
      <h2>L2</h2><p>l2 content</p>
      <h3>L3</h3><p>l3 content</p>
      <h4>L4</h4><p>l4 content</p>
      <h5>L5</h5><p>l5 content</p>
      <h6>L6</h6><p>l6 content</p>
    `;
    const result = parse({ type: 'html', content: html, title: 'Deep Doc' });

    const maxDepth = Math.max(...result.sections.map((s) => s.depth));
    expect(maxDepth).toBe(3);
    // h5 (depth 4) and h6 (depth 5) both exceed the max: two too-deep levels.
    expect(result.warnings.filter((w) => w.kind === 'depth-flattened')).toHaveLength(2);

    // h4 sits exactly at depth 3, the correct absorption target, and stays
    // as a section rather than being merged further up into L3.
    const l4 = result.sections.find((s) => s.heading === 'L4');
    expect(l4?.depth).toBe(3);
    expect(l4?.content).toContain('l4 content');
    expect(l4?.content).toContain('L5');
    expect(l4?.content).toContain('l5 content');
    expect(l4?.content).toContain('L6');
    expect(l4?.content).toContain('l6 content');

    const l3 = result.sections.find((s) => s.heading === 'L3');
    expect(l3?.content).toBe('l3 content');

    expect(result.sections.find((s) => s.heading === 'L5')).toBeUndefined();
    expect(result.sections.find((s) => s.heading === 'L6')).toBeUndefined();
  });

  it('splits an oversized section on paragraph boundaries, never mid-sentence', () => {
    const paragraphs = Array.from(
      { length: 10 },
      (_, i) => `This is paragraph number ${i}. It has two sentences.`,
    );
    const html = `<h1>Big</h1>${paragraphs.map((p) => `<p>${p}</p>`).join('')}`;
    const result = parse({ type: 'html', content: html, title: 'Doc' }, { maxSectionChars: 150 });

    expect(result.sections.length).toBeGreaterThan(1);
    expect(result.warnings.some((w) => w.kind === 'section-split')).toBe(true);

    for (const section of result.sections) {
      expect(section.content.length).toBeLessThanOrEqual(150);
      expect(section.content.trim()).toMatch(/[.!?]$/);
    }

    const reassembled = result.sections.map((s) => s.content).join(' ');
    for (const p of paragraphs) {
      expect(reassembled).toContain(p);
    }

    const topLevel = result.sections.filter((s) => s.parentId === null);
    expect(topLevel.map((s) => s.ordinal)).toEqual(topLevel.map((_, i) => i));
  });

  it('produces a sensible flat list for plain text with no headings', () => {
    const result = parse({ type: 'text', content: 'One.\n\nTwo.\n\nThree.', title: 'Notes' });
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].heading).toBe('Notes');
    expect(result.warnings).toEqual([]);
  });

  it('parses a dom source using the same walker as html', () => {
    const container = document.createElement('div');
    container.innerHTML = '<h1>From DOM</h1><p>dom content</p>';
    const result = parse({ type: 'dom', element: container, title: 'DOM Doc' });
    expect(result.sections).toEqual([
      expect.objectContaining({ heading: 'From DOM', content: 'dom content' }),
    ]);
  });

  it('stamps every section with a consistent docId and sourceType', () => {
    const result = parse({ type: 'markdown', content: '# A\n\nbody', title: 'M' });
    expect(result.sourceType).toBe('markdown');
    expect(result.sections.every((s) => s.docId === result.docId)).toBe(true);
  });

  it('defaults the title to Untitled for html/dom/markdown sources without one', () => {
    const result = parse({ type: 'html', content: '<p>x</p>' });
    expect(result.title).toBe('Untitled');
  });
});
