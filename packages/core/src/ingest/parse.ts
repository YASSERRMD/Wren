import type { ParseOptions, ParsedDocument, WrenSource } from './types.js';

export function parse(source: WrenSource, opts: ParseOptions = {}): ParsedDocument {
  void opts;
  switch (source.type) {
    case 'html':
    case 'dom':
      throw new Error(`${source.type} parsing is not yet implemented`);
    case 'markdown':
      throw new Error('markdown parsing is not yet implemented');
    case 'text':
      throw new Error('text parsing is not yet implemented');
  }
}
