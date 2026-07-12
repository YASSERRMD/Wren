import { buildSectionTree, type ParseEvent } from './sectionTree.js';
import type { ParsedDocument, ParseWarning } from './types.js';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NAV', 'FOOTER']);
const BLOCK_TAGS = new Set(['P', 'LI', 'TD', 'TH', 'TR', 'TABLE', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'DIV']);
const HEADING_RANKS: Record<string, number> = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function* walk(node: Node, warnings: ParseWarning[]): Generator<ParseEvent> {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = normalizeWhitespace(node.textContent ?? '');
    if (text) yield { kind: 'text', text };
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as Element;

  if (SKIP_TAGS.has(element.tagName)) {
    if ((element.textContent ?? '').trim()) {
      warnings.push({ kind: 'content-stripped', reason: `stripped <${element.tagName.toLowerCase()}> content` });
    }
    return;
  }

  const rank = HEADING_RANKS[element.tagName];
  if (rank) {
    yield { kind: 'heading', rank, text: normalizeWhitespace(element.textContent ?? '') };
    return;
  }

  for (const child of Array.from(node.childNodes)) {
    yield* walk(child, warnings);
  }

  if (BLOCK_TAGS.has(element.tagName)) {
    yield { kind: 'paragraph-break' };
  }
}

export function parseDomElement(
  docId: string,
  element: HTMLElement,
  title: string,
): { warnings: ParseWarning[] } & Pick<ParsedDocument, 'sections'> {
  const warnings: ParseWarning[] = [];
  const events = walk(element, warnings);
  const sections = buildSectionTree(docId, title, events);
  return { sections, warnings };
}

export function parseHtmlString(
  docId: string,
  html: string,
  title: string,
): { warnings: ParseWarning[] } & Pick<ParsedDocument, 'sections'> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return parseDomElement(docId, doc.body, title);
}
