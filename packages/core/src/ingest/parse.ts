import { parseDomElement, parseHtmlString } from './htmlParser.js';
import { parseMarkdown } from './markdownParser.js';
import type { ParseOptions, ParsedDocument, WrenSource } from './types.js';

export function parse(source: WrenSource, opts: ParseOptions = {}): ParsedDocument {
  void opts;
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
    case 'text':
      throw new Error('text parsing is not yet implemented');
  }
}
