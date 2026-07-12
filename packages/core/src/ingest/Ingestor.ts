import { DocumentRepository } from '../documents/DocumentRepository.js';
import { CachingLabelGenerator } from '../labelling/CachingLabelGenerator.js';
import { hashContent } from '../labelling/contentHash.js';
import { createLabelGenerator, type LabelStrategy } from '../labelling/createLabelGenerator.js';
import type { IngestProgress, ProgressCallback } from '../labelling/progress.js';
import type { WrenDocument } from '../types.js';
import { parse } from './parse.js';
import { DEFAULT_MAX_SECTION_CHARS, type ParseWarning, type WrenSource } from './types.js';

export interface IngestOptions {
  /** Default 'auto': Nano if available, heuristic otherwise. See createLabelGenerator. */
  labeller?: LabelStrategy | 'auto';
  maxSectionChars?: number;
  onProgress?: ProgressCallback;
  /** Overrides the stable id derived from the source; see deriveSourceId. */
  docId?: string;
  signal?: AbortSignal;
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Ingest aborted', 'AbortError');
  }
}

/**
 * A stable id derived from the source's own type, title, and content, so
 * ingesting the identical source twice resolves to the same docId without
 * the caller having to track one. Pass IngestOptions.docId to override.
 */
async function deriveSourceId(source: WrenSource): Promise<string> {
  switch (source.type) {
    case 'text':
      return hashContent(`text:${source.title}:${source.content}`);
    case 'html':
      return hashContent(`html:${source.title ?? ''}:${source.content}`);
    case 'markdown':
      return hashContent(`markdown:${source.title ?? ''}:${source.content}`);
    case 'dom':
      return hashContent(`dom:${source.title ?? ''}:${source.element.outerHTML}`);
  }
}

export interface IngestResult {
  docId: string;
  sectionCount: number;
  warnings: ParseWarning[];
  labelStrategy: LabelStrategy;
  durationMs: number;
}

/** The only ingest API consumers touch: parse, label, and index in one call. */
export class Ingestor {
  constructor(private readonly repo: DocumentRepository) {}

  async ingest(source: WrenSource, opts: IngestOptions = {}): Promise<IngestResult> {
    const start = Date.now();
    checkAborted(opts.signal);

    const docId = opts.docId ?? (await deriveSourceId(source));
    const maxSectionChars = opts.maxSectionChars ?? DEFAULT_MAX_SECTION_CHARS;
    const parsed = parse(source, { maxSectionChars });
    opts.onProgress?.({ phase: 'parsing', current: 1, total: 1 });
    checkAborted(opts.signal);

    // parse() generates its own random docId; the stable one just derived
    // (or the caller's explicit override) replaces it on every section.
    const sections = parsed.sections.map((section) => ({ ...section, docId }));

    const { generator, strategy } = await createLabelGenerator(opts.labeller ?? 'auto');
    const cachingGenerator = new CachingLabelGenerator(generator, this.repo);
    // Checking the signal from inside onProgress, which the labeller calls
    // synchronously after each section or batch, is what makes cancellation
    // land between sections rather than only at the next big phase boundary.
    const wrappedOnProgress = (progress: IngestProgress): void => {
      checkAborted(opts.signal);
      opts.onProgress?.(progress);
    };
    const labelled = await cachingGenerator.generateLabels(sections, wrappedOnProgress);
    checkAborted(opts.signal);

    const existing = await this.repo.getDocument(docId);
    if (existing) {
      await this.repo.deleteDocument(docId);
    }

    const doc: WrenDocument = {
      id: docId,
      title: parsed.title,
      sourceType: parsed.sourceType,
      createdAt: new Date().toISOString(),
      meta: { labelStrategy: strategy },
    };

    await this.repo.insertDocumentAndSections(doc, labelled);
    opts.onProgress?.({ phase: 'indexing', current: 1, total: 1 });

    return {
      docId,
      sectionCount: labelled.length,
      warnings: parsed.warnings,
      labelStrategy: strategy,
      durationMs: Date.now() - start,
    };
  }
}
