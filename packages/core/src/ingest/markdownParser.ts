import { buildSectionTree, type ParseEvent } from './sectionTree.js';
import type { ParsedDocument } from './types.js';

const ATX_HEADING = /^(#{1,6})\s+(.*?)\s*#*$/;

function* tokenize(content: string): Generator<ParseEvent> {
  const lines = content.split('\n');
  let sawBlankSinceContent = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === '') {
      sawBlankSinceContent = true;
      continue;
    }

    const match = ATX_HEADING.exec(line);
    if (match) {
      yield { kind: 'heading', rank: match[1].length, text: match[2].trim() };
      sawBlankSinceContent = false;
      continue;
    }

    if (sawBlankSinceContent) {
      yield { kind: 'paragraph-break' };
    }
    yield { kind: 'text', text: line.trim() };
    sawBlankSinceContent = false;
  }
}

/**
 * A focused heading splitter, not a full markdown parser: it recognises
 * ATX-style (#) headings and treats everything else as content, kept in
 * its raw markdown form rather than rendered or stripped. Deliberately
 * does not pull in a markdown library, to keep the bundle small.
 */
export function parseMarkdown(
  docId: string,
  content: string,
  title: string,
): Pick<ParsedDocument, 'sections' | 'warnings'> {
  const sections = buildSectionTree(docId, title, tokenize(content));
  return { sections, warnings: [] };
}
