import type { WrenSection } from '../types.js';
import { DEFAULT_MAX_SECTION_CHARS, type ParsedDocument } from './types.js';

/**
 * No headings available, so paragraphs are greedily grouped up to
 * maxSectionChars and ordinals are synthesised (0, 1, 2, ...) rather than
 * derived from document structure. A single paragraph larger than
 * maxSectionChars becomes its own oversized group; the generic chunker
 * (chunk.ts) is what actually enforces the limit on such a group.
 */
export function parseText(
  docId: string,
  content: string,
  title: string,
  maxSectionChars: number = DEFAULT_MAX_SECTION_CHARS,
): Pick<ParsedDocument, 'sections' | 'warnings'> {
  const paragraphs = content
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const groups: string[][] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const paragraph of paragraphs) {
    if (current.length > 0 && currentLen + paragraph.length > maxSectionChars) {
      groups.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(paragraph);
    currentLen += paragraph.length;
  }
  if (current.length > 0) groups.push(current);

  const sections: WrenSection[] = groups.map((group, index) => ({
    id: crypto.randomUUID(),
    docId,
    parentId: null,
    ordinal: index,
    depth: 0,
    heading: groups.length === 1 ? title : `Section ${index + 1}`,
    content: group.join('\n\n'),
    label: '',
  }));

  return { sections, warnings: [] };
}
