import { MAX_SECTION_DEPTH } from '../documents/DocumentRepository.js';
import type { WrenSection } from '../types.js';
import type { ParseWarning } from './types.js';

/**
 * Flattens anything deeper than MAX_SECTION_DEPTH into its depth-3
 * ancestor: the too-deep section's heading and content are appended into
 * the ancestor's content and the section itself is removed, rather than
 * kept as a separate (still too-deep) node. Processes deepest-first so a
 * chain more than one level too deep cascades correctly: a depth-5
 * section merges into its depth-4 parent before that parent (now carrying
 * the depth-5 content too) merges into the depth-3 ancestor.
 *
 * By construction (see sectionTree.ts) depth always increases by exactly
 * one from parent to child, so every section's immediate parent is
 * unambiguous and this never needs to search past the direct parent.
 */
export function clampDepth(sections: readonly WrenSection[], warnings: ParseWarning[]): WrenSection[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const removed = new Set<string>();

  const deepestFirst = [...sections].sort((a, b) => b.depth - a.depth);

  for (const section of deepestFirst) {
    if (section.depth <= MAX_SECTION_DEPTH) continue;
    const parent = section.parentId ? byId.get(section.parentId) : undefined;
    if (!parent) continue;

    warnings.push({ kind: 'depth-flattened', sectionId: section.id, originalDepth: section.depth });
    const heading = section.heading ? `${section.heading}\n\n` : '';
    parent.content = [parent.content, `${heading}${section.content}`.trim()].filter(Boolean).join('\n\n');
    removed.add(section.id);
  }

  return sections.filter((s) => !removed.has(s.id));
}
