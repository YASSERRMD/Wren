import { chunkOversizedSections } from './chunk.js';
import { parseDomElement, parseHtmlString } from './htmlParser.js';
import { parseMarkdown } from './markdownParser.js';
import { clampDepth } from './normalize.js';
import { parseText } from './textParser.js';
import {
  DEFAULT_MAX_SECTION_CHARS,
  type ParseOptions,
  type ParsedDocument,
  type ParseWarning,
  type WrenSource,
} from './types.js';

function parseRaw(
  docId: string,
  source: WrenSource,
  maxSectionChars: number,
): { title: string } & Pick<ParsedDocument, 'sections' | 'warnings' | 'sourceType'> {
  switch (source.type) {
    case 'html': {
      const title = source.title ?? 'Untitled';
      const { sections, warnings } = parseHtmlString(docId, source.content, title);
      return { title, sourceType: 'html', sections, warnings };
    }
    case 'dom': {
      const title = source.title ?? 'Untitled';
      const { sections, warnings } = parseDomElement(docId, source.element, title);
      return { title, sourceType: 'dom', sections, warnings };
    }
    case 'markdown': {
      const title = source.title ?? 'Untitled';
      const { sections, warnings } = parseMarkdown(docId, source.content, title);
      return { title, sourceType: 'markdown', sections, warnings };
    }
    case 'text': {
      const { sections, warnings } = parseText(docId, source.content, source.title, maxSectionChars);
      return { title: source.title, sourceType: 'text', sections, warnings };
    }
  }
}

/** Turns a source into a flat, depth-clamped, size-clamped list of sections. No LLM involved: purely structural. */
export function parse(source: WrenSource, opts: ParseOptions = {}): ParsedDocument {
  const maxSectionChars = opts.maxSectionChars ?? DEFAULT_MAX_SECTION_CHARS;
  const docId = crypto.randomUUID();

  const { title, sourceType, sections: rawSections, warnings } = parseRaw(docId, source, maxSectionChars);

  const allWarnings: ParseWarning[] = [...warnings];
  const depthClamped = clampDepth(rawSections, allWarnings);
  const sections = chunkOversizedSections(depthClamped, maxSectionChars, allWarnings);

  return { docId, title, sourceType, sections, warnings: allWarnings };
}
