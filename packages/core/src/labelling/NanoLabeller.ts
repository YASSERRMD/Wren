import type { NanoAdapterLike } from '../nano/NanoAdapter.js';
import type { WrenSection } from '../types.js';
import type { LabelGenerator } from './LabelGenerator.js';

const MAX_BATCH_CHARS = 1500;
const MAX_SECTION_CHARS_FOR_BATCHING = 500;
const MAX_LABEL_WORDS = 20;

/** Groups short sections together up to a char budget; long sections get their own single-section batch. */
function groupIntoBatches(sections: readonly WrenSection[]): WrenSection[][] {
  const batches: WrenSection[][] = [];
  let current: WrenSection[] = [];
  let currentChars = 0;

  const flush = (): void => {
    if (current.length > 0) batches.push(current);
    current = [];
    currentChars = 0;
  };

  for (const section of sections) {
    const size = section.heading.length + section.content.length;
    if (size > MAX_SECTION_CHARS_FOR_BATCHING) {
      flush();
      batches.push([section]);
      continue;
    }
    if (current.length > 0 && currentChars + size > MAX_BATCH_CHARS) {
      flush();
    }
    current.push(section);
    currentChars += size;
  }
  flush();

  return batches;
}

/** One promptStructured call per section, or per batch of several short sections. */
export class NanoLabeller implements LabelGenerator {
  constructor(private readonly nano: NanoAdapterLike) {}

  async generateLabels(sections: readonly WrenSection[]): Promise<WrenSection[]> {
    const results: WrenSection[] = [];

    for (const batch of groupIntoBatches(sections)) {
      if (batch.length === 1) {
        const label = await this.labelOne(batch[0]);
        results.push({ ...batch[0], label });
      } else {
        const labels = await this.labelBatch(batch);
        batch.forEach((section, index) => {
          results.push({ ...section, label: labels[index] ?? '' });
        });
      }
    }

    return results;
  }

  private async labelOne(section: WrenSection): Promise<string> {
    const prompt =
      `Summarise this document section in under ${MAX_LABEL_WORDS} words, for use as a ` +
      `navigation label.\nHeading: "${section.heading}"\nContent: "${section.content}"`;
    const result = await this.nano.promptStructured<{ label: string }>(prompt, {
      type: 'object',
      required: ['label'],
      properties: { label: { type: 'string' } },
    });
    return result.label;
  }

  private async labelBatch(sections: readonly WrenSection[]): Promise<string[]> {
    const items = sections
      .map((s, i) => `${i + 1}. Heading: "${s.heading}"\nContent: "${s.content}"`)
      .join('\n\n');
    const prompt =
      `Summarise each of these ${sections.length} document sections in under ${MAX_LABEL_WORDS} ` +
      `words each, for use as navigation labels. Return one label per section, in the same order.` +
      `\n\n${items}`;
    const result = await this.nano.promptStructured<{ labels: string[] }>(prompt, {
      type: 'object',
      required: ['labels'],
      properties: {
        labels: {
          type: 'array',
          items: { type: 'string' },
          minItems: sections.length,
          maxItems: sections.length,
        },
      },
    });
    return result.labels;
  }
}
