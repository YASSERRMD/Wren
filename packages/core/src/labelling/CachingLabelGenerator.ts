import type { WrenSection } from '../types.js';
import { hashContent } from './contentHash.js';
import type { LabelGenerator } from './LabelGenerator.js';
import type { ProgressCallback } from './progress.js';

export interface LabelCache {
  findCachedLabel(contentHash: string): Promise<string | undefined>;
}

/**
 * Wraps any LabelGenerator with content-hash caching: a section whose
 * content hashes the same as one already in storage reuses that label and
 * never reaches the wrapped generator, so re-ingesting unchanged content
 * makes zero LLM calls. Only sections that miss the cache go to `inner`,
 * still batched together as `inner` sees fit.
 */
export class CachingLabelGenerator implements LabelGenerator {
  constructor(
    private readonly inner: LabelGenerator,
    private readonly cache: LabelCache,
  ) {}

  async generateLabels(sections: readonly WrenSection[], onProgress?: ProgressCallback): Promise<WrenSection[]> {
    const total = sections.length;
    const hashes = await Promise.all(sections.map((s) => hashContent(s.content)));
    const cachedLabels = await Promise.all(hashes.map((hash) => this.cache.findCachedLabel(hash)));

    const results: WrenSection[] = new Array(sections.length);
    const toGenerate: WrenSection[] = [];
    const toGenerateIndices: number[] = [];
    let done = 0;

    sections.forEach((section, index) => {
      const cached = cachedLabels[index];
      if (cached !== undefined) {
        results[index] = { ...section, label: cached };
        done += 1;
        onProgress?.({ phase: 'labelling', current: done, total });
      } else {
        toGenerate.push(section);
        toGenerateIndices.push(index);
      }
    });

    if (toGenerate.length > 0) {
      const doneBeforeGeneration = done;
      const generated = await this.inner.generateLabels(toGenerate, (progress) => {
        onProgress?.({ phase: 'labelling', current: doneBeforeGeneration + progress.current, total });
      });
      generated.forEach((section, i) => {
        results[toGenerateIndices[i]] = section;
      });
    }

    return results;
  }
}
