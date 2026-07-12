import { describe, expect, it } from 'vitest';
import { parseMarkdown } from './markdownParser.js';

describe('parseMarkdown', () => {
  it('produces the correct parent/child structure from ATX headings', () => {
    const md = [
      '# Chapter One',
      '',
      'Intro paragraph.',
      '',
      'Second line of intro, same paragraph.',
      '',
      '## Section A',
      '',
      'Content of A.',
      '',
      '### Subsection A.1',
      '',
      'Deep content.',
      '',
      '## Section B',
      '',
      'Content of B.',
      '',
      '# Chapter Two',
      '',
      'Second chapter content.',
      '',
    ].join('\n');

    const { sections, warnings } = parseMarkdown('doc-1', md, 'Test Doc');

    expect(warnings).toEqual([]);
    expect(sections.map((s) => s.heading)).toEqual([
      'Chapter One',
      'Section A',
      'Subsection A.1',
      'Section B',
      'Chapter Two',
    ]);
    expect(sections[0].content).toBe('Intro paragraph.\n\nSecond line of intro, same paragraph.');
    expect(sections[0].depth).toBe(0);
    expect(sections[1].depth).toBe(1);
    expect(sections[1].parentId).toBe(sections[0].id);
    expect(sections[2].depth).toBe(2);
    expect(sections[2].parentId).toBe(sections[1].id);
  });

  it('keeps raw markdown syntax rather than rendering it', () => {
    const md = '# Doc\n\nSome **bold** and a [link](https://example.com).';
    const { sections } = parseMarkdown('doc-1', md, 'Doc');
    expect(sections[0].content).toContain('**bold**');
    expect(sections[0].content).toContain('[link](https://example.com)');
  });

  it('produces one section titled with the document title when there are no headings', () => {
    const md = 'Just one paragraph.\n\nAnd another.';
    const { sections } = parseMarkdown('doc-1', md, 'Fallback Title');
    expect(sections).toHaveLength(1);
    expect(sections[0].heading).toBe('Fallback Title');
    expect(sections[0].content).toBe('Just one paragraph.\n\nAnd another.');
  });

  it('recognises all six ATX heading levels', () => {
    const md = '# h1\n\n## h2\n\n### h3\n\n#### h4\n\n##### h5\n\n###### h6';
    const { sections } = parseMarkdown('doc-1', md, 'Doc');
    expect(sections.map((s) => s.depth)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
