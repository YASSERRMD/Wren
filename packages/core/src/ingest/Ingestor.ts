import { DocumentRepository } from '../documents/DocumentRepository.js';
import { CachingLabelGenerator } from '../labelling/CachingLabelGenerator.js';
import { createLabelGenerator, type LabelStrategy } from '../labelling/createLabelGenerator.js';
import type { ProgressCallback } from '../labelling/progress.js';
import type { WrenDocument } from '../types.js';
import { parse } from './parse.js';
import type { ParseWarning, WrenSource } from './types.js';

export interface IngestOptions {
  onProgress?: ProgressCallback;
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

    const parsed = parse(source);
    opts.onProgress?.({ phase: 'parsing', current: 1, total: 1 });

    const { generator, strategy } = await createLabelGenerator('auto');
    const cachingGenerator = new CachingLabelGenerator(generator, this.repo);
    const labelled = await cachingGenerator.generateLabels(parsed.sections, opts.onProgress);

    const doc: WrenDocument = {
      id: parsed.docId,
      title: parsed.title,
      sourceType: parsed.sourceType,
      createdAt: new Date().toISOString(),
      meta: { labelStrategy: strategy },
    };

    await this.repo.insertDocumentAndSections(doc, labelled);
    opts.onProgress?.({ phase: 'indexing', current: 1, total: 1 });

    return {
      docId: parsed.docId,
      sectionCount: labelled.length,
      warnings: parsed.warnings,
      labelStrategy: strategy,
      durationMs: Date.now() - start,
    };
  }
}
