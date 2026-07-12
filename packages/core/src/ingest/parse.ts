import { parseDomElement, parseHtmlString } from './htmlParser.js';
import { parseMarkdown } from './markdownParser.js';
import { parseText } from './textParser.js';
import { DEFAULT_MAX_SECTION_CHARS, type ParseOptions, type ParsedDocument, type WrenSource } from './types.js';

export function parse(source: WrenSource, opts: ParseOptions = {}): ParsedDocument {
  const maxSectionChars = opts.maxSectionChars ?? DEFAULT_MAX_SECTION_CHARS;
  const docId = crypto.randomUUID();

  switch (source.type) {
    case 'html': {
      const title = source.title ?? 'Untitled';
      const { sections, warnings } = parseHtmlString(docId, source.content, title);
      return { docId, title, sourceType: 'html', sections, warnings };
    }
    case 'dom': {
      const title = source.title ?? 'Untitled';
      const { sections, warnings } = parseDomElement(docId, source.element, title);
      return { docId, title, sourceType: 'dom', sections, warnings };
    }
    case 'markdown': {
      const title = source.title ?? 'Untitled';
      const { sections, warnings } = parseMarkdown(docId, source.content, title);
      return { docId, title, sourceType: 'markdown', sections, warnings };
    }
    case 'text': {
      const { sections, warnings } = parseText(docId, source.content, source.title, maxSectionChars);
      return { docId, title: source.title, sourceType: 'text', sections, warnings };
    }
  }
}
