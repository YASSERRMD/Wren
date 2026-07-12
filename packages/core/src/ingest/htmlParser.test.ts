import { describe, expect, it } from 'vitest';
import { parseHtmlString } from './htmlParser.js';

describe('parseHtmlString', () => {
  it('produces the correct parent/child structure from nested headings', () => {
    const html = `
      <h1>Chapter One</h1>
      <p>Intro paragraph.</p>
      <h2>Section A</h2>
      <p>Content of A.</p>
      <h3>Subsection A.1</h3>
      <p>Deep content.</p>
      <h2>Section B</h2>
      <p>Content of B.</p>
      <h1>Chapter Two</h1>
      <p>Second chapter content.</p>
    `;
    const { sections, warnings } = parseHtmlString('doc-1', html, 'Test Doc');

    expect(warnings).toEqual([]);
    expect(sections.map((s) => s.heading)).toEqual([
      'Chapter One',
      'Section A',
      'Subsection A.1',
      'Section B',
      'Chapter Two',
    ]);

    const [chapterOne, sectionA, subA1, sectionB, chapterTwo] = sections;

    expect(chapterOne).toMatchObject({ depth: 0, parentId: null, content: 'Intro paragraph.' });
    expect(sectionA).toMatchObject({ depth: 1, parentId: chapterOne.id, content: 'Content of A.' });
    expect(subA1).toMatchObject({ depth: 2, parentId: sectionA.id, content: 'Deep content.' });
    expect(sectionB).toMatchObject({ depth: 1, parentId: chapterOne.id, content: 'Content of B.' });
    expect(chapterTwo).toMatchObject({ depth: 0, parentId: null, content: 'Second chapter content.' });

    expect(sectionA.ordinal).toBe(0);
    expect(subA1.ordinal).toBe(0);
    expect(sectionB.ordinal).toBe(1);
  });

  it('strips script, style, nav, and footer but keeps list and table text', () => {
    const html = `
      <h1>Doc</h1>
      <script>alert('x')</script>
      <style>.a{color:red}</style>
      <nav>Home | About</nav>
      <ul><li>Item one</li><li>Item two</li></ul>
      <table><tr><td>Cell A</td><td>Cell B</td></tr></table>
      <footer>copyright</footer>
    `;
    const { sections, warnings } = parseHtmlString('doc-1', html, 'Doc');
    const content = sections[0].content;

    expect(content).not.toContain('alert');
    expect(content).not.toContain('color:red');
    expect(content).not.toContain('Home');
    expect(content).not.toContain('copyright');
    expect(content).toContain('Item one');
    expect(content).toContain('Item two');
    expect(content).toContain('Cell A');
    expect(content).toContain('Cell B');

    expect(warnings.some((w) => w.kind === 'content-stripped')).toBe(true);
  });

  it('joins multiple paragraphs within one section on a paragraph boundary', () => {
    const html = '<h1>Doc</h1><p>First para.</p><p>Second para.</p>';
    const { sections } = parseHtmlString('doc-1', html, 'Doc');
    expect(sections[0].content).toBe('First para.\n\nSecond para.');
  });

  it('does not drop content that appears before the first heading', () => {
    const html = '<p>Preamble text.</p><h1>Real Heading</h1><p>Body.</p>';
    const { sections } = parseHtmlString('doc-1', html, 'My Title');
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ heading: 'My Title', content: 'Preamble text.' });
    expect(sections[1]).toMatchObject({ heading: 'Real Heading', content: 'Body.', parentId: null });
  });

  it('produces one section when there are no headings at all', () => {
    const html = '<p>Just some text.</p>';
    const { sections } = parseHtmlString('doc-1', html, 'Untitled Page');
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ heading: 'Untitled Page', content: 'Just some text.', depth: 0 });
  });
});
