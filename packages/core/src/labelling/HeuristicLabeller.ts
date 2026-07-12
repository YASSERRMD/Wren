import type { WrenSection } from '../types.js';
import type { LabelGenerator } from './LabelGenerator.js';
import type { ProgressCallback } from './progress.js';

const GENERIC_HEADING = /^(introduction|overview|summary|notes?|untitled|(section|chapter|part)\s*\d*)$/i;
const MAX_LABEL_WORDS = 20;

function truncateWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(' ');
  return words.slice(0, maxWords).join(' ');
}

function firstSentence(text: string): string {
  const match = /^[^.!?]*[.!?]/.exec(text.trim());
  return (match ? match[0] : text.slice(0, 120)).trim();
}

function isShortOrGeneric(heading: string): boolean {
  const trimmed = heading.trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  return wordCount <= 2 || GENERIC_HEADING.test(trimmed);
}

/** Zero LLM calls. The default and the fallback when Nano is unavailable. */
export class HeuristicLabeller implements LabelGenerator {
  async generateLabels(sections: readonly WrenSection[], onProgress?: ProgressCallback): Promise<WrenSection[]> {
    const total = sections.length;
    return sections.map((section, index) => {
      const labelled = { ...section, label: this.buildLabel(section) };
      onProgress?.({ phase: 'labelling', current: index + 1, total });
      return labelled;
    });
  }

  private buildLabel(section: WrenSection): string {
    const heading = section.heading.trim();
    const content = section.content.trim();

    if (!heading) {
      return truncateWords(content ? firstSentence(content) : 'Untitled section', MAX_LABEL_WORDS);
    }
    if (isShortOrGeneric(heading) && content) {
      return truncateWords(`${heading}: ${firstSentence(content)}`, MAX_LABEL_WORDS);
    }
    return truncateWords(heading, MAX_LABEL_WORDS);
  }
}
