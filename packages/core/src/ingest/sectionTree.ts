import type { WrenSection } from '../types.js';

export interface HeadingEvent {
  kind: 'heading';
  /** 1-6, lower is more significant (h1 = 1). Content between a heading and the next of equal or lower rank number belongs to it. */
  rank: number;
  text: string;
}

export interface TextEvent {
  kind: 'text';
  text: string;
}

export interface ParagraphBreakEvent {
  kind: 'paragraph-break';
}

export type ParseEvent = HeadingEvent | TextEvent | ParagraphBreakEvent;

/**
 * Consumes a flat event stream (from either the DOM walker or the markdown
 * line splitter) and builds a section tree via a rank stack: a heading
 * pops any open heading of equal or lower rank number before becoming a
 * child of whatever remains open, so content always attaches to the most
 * specific currently-open section.
 *
 * Content appearing before the first heading (or an entire document with
 * no headings at all) is not dropped: it lazily opens a section titled
 * with the document title, treated as rank 1 so real top-level headings
 * that follow become its siblings rather than its children.
 */
export function buildSectionTree(docId: string, title: string, events: Iterable<ParseEvent>): WrenSection[] {
  const sectionsById = new Map<string, WrenSection>();
  const order: string[] = [];
  const stack: string[] = [];
  const rankById = new Map<string, number>();
  const ordinalCounters = new Map<string | null, number>();

  const nextOrdinal = (parentId: string | null): number => {
    const current = ordinalCounters.get(parentId) ?? 0;
    ordinalCounters.set(parentId, current + 1);
    return current;
  };

  const pushSection = (heading: string, rank: number): string => {
    while (stack.length > 0 && (rankById.get(stack.at(-1) as string) ?? 0) >= rank) {
      stack.pop();
    }
    const parentId = stack.at(-1) ?? null;
    const id = crypto.randomUUID();
    const section: WrenSection = {
      id,
      docId,
      parentId,
      ordinal: nextOrdinal(parentId),
      depth: stack.length,
      heading,
      content: '',
      label: '',
    };
    sectionsById.set(id, section);
    order.push(id);
    rankById.set(id, rank);
    stack.push(id);
    return id;
  };

  const ensureOpenSection = (): string => {
    if (stack.length === 0) {
      return pushSection(title, 1);
    }
    return stack.at(-1) as string;
  };

  const appendContent = (text: string): void => {
    if (!text) return;
    const section = sectionsById.get(ensureOpenSection()) as WrenSection;
    section.content += (section.content && !/\s$/.test(section.content) ? ' ' : '') + text;
  };

  const markParagraphBreak = (): void => {
    if (stack.length === 0) return;
    const section = sectionsById.get(stack.at(-1) as string) as WrenSection;
    if (section.content && !section.content.endsWith('\n\n')) {
      section.content = section.content.replace(/\s+$/, '') + '\n\n';
    }
  };

  for (const event of events) {
    if (event.kind === 'text') {
      appendContent(event.text);
    } else if (event.kind === 'paragraph-break') {
      markParagraphBreak();
    } else {
      pushSection(event.text, event.rank);
    }
  }

  for (const id of order) {
    const section = sectionsById.get(id) as WrenSection;
    section.content = section.content.replace(/\n{3,}/g, '\n\n').trim();
  }

  return order.map((id) => sectionsById.get(id) as WrenSection);
}
