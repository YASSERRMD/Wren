import type { WrenSection } from '../types.js';
import { hashContent } from './contentHash.js';
import type { LabelGenerator } from './LabelGenerator.js';

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

  async generateLabels(sections: readonly WrenSection[]): Promise<WrenSection[]> {
    const hashes = await Promise.all(sections.map((s) => hashContent(s.content)));
    const cachedLabels = await Promise.all(hashes.map((hash) => this.cache.findCachedLabel(hash)));

    const results: WrenSection[] = new Array(sections.length);
    const toGenerate: WrenSection[] = [];
    const toGenerateIndices: number[] = [];

    sections.forEach((section, index) => {
      const cached = cachedLabels[index];
      if (cached !== undefined) {
        results[index] = { ...section, label: cached };
      } else {
        toGenerate.push(section);
        toGenerateIndices.push(index);
      }
    });

    if (toGenerate.length > 0) {
      const generated = await this.inner.generateLabels(toGenerate);
      generated.forEach((section, i) => {
        results[toGenerateIndices[i]] = section;
      });
    }

    return results;
  }
}
