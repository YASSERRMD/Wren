import type { WrenSection } from '../types.js';
import type { ParseWarning } from './types.js';

function splitOnSentences(text: string, maxChars: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (!current || candidate.length <= maxChars) {
      current = candidate;
    } else {
      chunks.push(current.trim());
      current = sentence;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

/** Splits on paragraph boundaries; falls back to sentence boundaries only if a single paragraph itself is too big. Never mid-sentence. */
function splitOnBoundaries(content: string, maxChars: number): string[] {
  const paragraphs = content.split(/\n\n+/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';

  const flush = (): void => {
    if (current) chunks.push(current.trim());
    current = '';
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      flush();
      chunks.push(...splitOnSentences(paragraph, maxChars));
      continue;
    }
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (!current || candidate.length <= maxChars) {
      current = candidate;
    } else {
      flush();
      current = paragraph;
    }
  }
  flush();

  return chunks;
}

/**
 * Splits any section whose content exceeds maxSectionChars into sibling
 * sub-sections, then renumbers ordinals within each parent group so the
 * new siblings do not collide with (or leave gaps against) their original
 * neighbours.
 */
export function chunkOversizedSections(
  sections: readonly WrenSection[],
  maxSectionChars: number,
  warnings: ParseWarning[],
): WrenSection[] {
  const expanded: WrenSection[] = [];

  for (const section of sections) {
    if (section.content.length <= maxSectionChars) {
      expanded.push(section);
      continue;
    }
    const parts = splitOnBoundaries(section.content, maxSectionChars);
    if (parts.length <= 1) {
      expanded.push(section);
      continue;
    }
    warnings.push({ kind: 'section-split', sectionId: section.id, partCount: parts.length });
    parts.forEach((part, index) => {
      expanded.push({
        ...section,
        id: index === 0 ? section.id : crypto.randomUUID(),
        content: part,
        heading: `${section.heading} (${index + 1}/${parts.length})`,
      });
    });
  }

  const ordinalCounters = new Map<string | null, number>();
  for (const section of expanded) {
    const next = ordinalCounters.get(section.parentId) ?? 0;
    section.ordinal = next;
    ordinalCounters.set(section.parentId, next + 1);
  }

  return expanded;
}
