import type { NanoAdapterLike } from '../nano/NanoAdapter.js';
import type { WrenSection } from '../types.js';
import type { LabelGenerator } from './LabelGenerator.js';
import type { ProgressCallback } from './progress.js';

const MAX_LABEL_WORDS = 20;
/** Fraction of the live quota a labelling prompt may use. Conservative: labelling runs unattended during ingest and should never be what exhausts the budget. */
const DEFAULT_BUDGET_RATIO = 0.5;
/** Rough chars-per-token used only to size a last-resort content truncation; never trusted for the go/no-go budget decision itself, which always calls estimateTokens. */
const APPROX_CHARS_PER_TOKEN = 4;

function truncateText(text: string, maxChars: number): string {
  const trimmed = text.trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars).trim()}...`;
}

function buildSoloPrompt(section: Pick<WrenSection, 'heading' | 'content'>): string {
  return (
    `Summarise this document section in under ${MAX_LABEL_WORDS} words, for use as a ` +
    `navigation label.\nHeading: "${section.heading}"\nContent: "${section.content}"`
  );
}

function buildBatchPrompt(sections: readonly WrenSection[]): string {
  const items = sections.map((s, i) => `${i + 1}. Heading: "${s.heading}"\nContent: "${s.content}"`).join('\n\n');
  return (
    `Summarise each of these ${sections.length} document sections in under ${MAX_LABEL_WORDS} ` +
    `words each, for use as navigation labels. Return one label per section, in the same order.` +
    `\n\n${items}`
  );
}

/** One promptStructured call per section, or per batch of several short sections, sized against Nano's live quota rather than a fixed character guess. */
export class NanoLabeller implements LabelGenerator {
  constructor(
    private readonly nano: NanoAdapterLike,
    private readonly budgetRatio = DEFAULT_BUDGET_RATIO,
  ) {}

  async generateLabels(sections: readonly WrenSection[], onProgress?: ProgressCallback): Promise<WrenSection[]> {
    const total = sections.length;
    const results: WrenSection[] = [];
    let done = 0;
    const budget = this.nano.quota.inputQuota * this.budgetRatio;

    for (const batch of await this.groupIntoBatches(sections, budget)) {
      if (batch.length === 1) {
        const label = await this.labelOne(batch[0], budget);
        results.push({ ...batch[0], label });
        done += 1;
      } else {
        const labels = await this.labelBatch(batch);
        batch.forEach((section, index) => {
          results.push({ ...section, label: labels[index] ?? '' });
        });
        done += batch.length;
      }
      onProgress?.({ phase: 'labelling', current: done, total });
    }

    return results;
  }

  /**
   * Groups sections up to the live token budget. Never mutates a section:
   * a section whose own solo prompt already exceeds the budget still gets
   * grouped alone (a multi-section batch could only be larger), and
   * labelOne() truncates the prompt it actually sends for that case.
   */
  private async groupIntoBatches(sections: readonly WrenSection[], budget: number): Promise<WrenSection[][]> {
    const batches: WrenSection[][] = [];
    let current: WrenSection[] = [];

    const flush = (): void => {
      if (current.length > 0) batches.push(current);
      current = [];
    };

    for (const section of sections) {
      const soloTokens = await this.nano.estimateTokens(buildSoloPrompt(section));
      if (soloTokens > budget) {
        flush();
        batches.push([section]);
        continue;
      }

      if (current.length > 0) {
        const candidateTokens = await this.nano.estimateTokens(buildBatchPrompt([...current, section]));
        if (candidateTokens > budget) flush();
      }
      current.push(section);
    }
    flush();

    return batches;
  }

  private async labelOne(section: WrenSection, budget: number): Promise<string> {
    const prompt = await this.buildFittingSoloPrompt(section, budget);
    const result = await this.nano.promptStructured<{ label: string }>(prompt, {
      type: 'object',
      required: ['label'],
      properties: { label: { type: 'string' } },
    });
    return result.label;
  }

  /**
   * Builds the solo prompt, truncating the content (for this prompt only;
   * the section returned to the caller keeps its original content) if
   * needed to fit the live budget. Floors at 100 chars of content rather
   * than shrinking to nothing for sections so large no reasonable prompt
   * would fit.
   */
  private async buildFittingSoloPrompt(section: WrenSection, budget: number): Promise<string> {
    const full = buildSoloPrompt(section);
    if ((await this.nano.estimateTokens(full)) <= budget) {
      return full;
    }

    let maxChars = Math.max(100, Math.floor(budget * APPROX_CHARS_PER_TOKEN) - section.heading.length);
    let prompt = buildSoloPrompt({ ...section, content: truncateText(section.content, maxChars) });
    while (maxChars > 100 && (await this.nano.estimateTokens(prompt)) > budget) {
      maxChars = Math.floor(maxChars * 0.75);
      prompt = buildSoloPrompt({ ...section, content: truncateText(section.content, maxChars) });
    }
    return prompt;
  }

  private async labelBatch(sections: readonly WrenSection[]): Promise<string[]> {
    const result = await this.nano.promptStructured<{ labels: string[] }>(buildBatchPrompt(sections), {
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
