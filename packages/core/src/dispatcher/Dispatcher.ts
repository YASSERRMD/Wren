import type { DocumentRepository } from '../documents/DocumentRepository.js';
import type { NanoAdapterLike } from '../nano/NanoAdapter.js';
import type { Candidate, LexicalRetriever } from '../retrieval/LexicalRetriever.js';
import { compressSchema } from '../tools/compressSchema.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { WrenSection } from '../types.js';
import { DECISION_SCHEMA, type Citation, type DispatcherDecision, type WrenResponse, type WrenWarning } from './types.js';

function truncateText(text: string, maxChars: number): string {
  const trimmed = text.trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars).trim()}...`;
}

function buildDecisionPrompt(query: string, toolsText: string, candidates: readonly Candidate[]): string {
  const candidateLines = candidates.map((c) => `${c.sectionId}: ${c.heading} - ${c.label}`).join('\n');
  return [
    `Query: "${query}"`,
    '',
    'Available tools:',
    toolsText || '(none)',
    '',
    'Candidate sections:',
    candidateLines || '(none)',
    '',
    'Decide the best action: answer directly using one or more candidate sections, ' +
      'call a tool, navigate into a candidate section for more detail, or report none found.',
  ].join('\n');
}

function buildAnswerPrompt(query: string, sections: readonly WrenSection[]): string {
  const body = sections.map((s) => `### ${s.heading}\n${s.content}`).join('\n\n');
  return `Query: "${query}"\n\nAnswer using only the following sections. Be concise and grounded in this content.\n\n${body}`;
}

function sectionsToCitations(sections: readonly WrenSection[]): Citation[] {
  return sections.map((section) => ({
    sectionId: section.id,
    heading: section.heading,
    snippet: truncateText(section.content, 200),
  }));
}

function buildToolFollowupPrompt(
  query: string,
  toolName: string,
  args: Record<string, unknown>,
  result: string,
): string {
  return (
    `Query: "${query}"\n\nTool "${toolName}" was called with ${JSON.stringify(args)} and returned:\n${result}` +
    '\n\nAnswer the query using this result.'
  );
}

/**
 * The heart of Wren: BM25 prefilter, one constrained Nano call to decide,
 * execute, answer. Every query goes through here. See DECISION_SCHEMA for
 * the four actions Nano can choose between.
 */
export class Dispatcher {
  constructor(
    private readonly nano: NanoAdapterLike,
    private readonly retriever: LexicalRetriever,
    private readonly repo: DocumentRepository,
    private readonly registry: ToolRegistry,
  ) {}

  async run(query: string): Promise<WrenResponse> {
    const start = Date.now();
    const warnings: WrenWarning[] = [];
    let candidates = await this.retriever.search(query);

    let hops = 0;
    let decision = await this.decide(query, candidates);

    // Hop cap is a hard invariant, not a suggestion: a 3B model cannot be
    // trusted with open-ended multi-hop navigation. A first navigate is
    // allowed; a second is a model failure, logged and forced to answer.
    while (decision.action === 'navigate') {
      if (hops >= 1) {
        console.warn('Wren: Nano attempted a second navigate hop; forcing an answer instead.');
        warnings.push({
          kind: 'hop-cap-forced',
          detail: 'A second navigate hop was attempted and forced to answer on the best candidate instead.',
        });
        decision =
          candidates.length > 0
            ? { action: 'answer', sectionIds: [candidates[0].sectionId] }
            : { action: 'none', reason: 'Navigation was exhausted with no candidates left to answer from.' };
        break;
      }
      hops += 1;
      candidates = await this.retriever.getChildren(decision.sectionId);
      decision = await this.decide(query, candidates);
    }

    // The while condition above guarantees decision.action !== 'navigate'
    // here; TypeScript cannot see that across the loop's own reassignments,
    // so this is a narrow, deliberate assertion of that runtime invariant.
    const resolved = decision as Exclude<DispatcherDecision, { action: 'navigate' }>;

    if (resolved.action === 'none') {
      return {
        answer: `No answer found: ${resolved.reason}`,
        citations: [],
        action: 'none',
        hops,
        durationMs: Date.now() - start,
        warnings,
      };
    }

    if (resolved.action === 'answer') {
      const sections = await this.repo.getSections(resolved.sectionIds);
      if (sections.length === 0) {
        return {
          answer: 'No answer found: the chosen sections could not be located.',
          citations: [],
          action: 'none',
          hops,
          durationMs: Date.now() - start,
          warnings,
        };
      }

      const answer = await this.nano.prompt(buildAnswerPrompt(query, sections));

      return {
        answer,
        citations: sectionsToCitations(sections),
        action: 'answer',
        hops,
        durationMs: Date.now() - start,
        warnings,
      };
    }

    const result = await this.registry.invoke(resolved.tool, resolved.args);
    const prompt = buildToolFollowupPrompt(query, resolved.tool, resolved.args, result.content);
    const answer = await this.nano.prompt(prompt);

    return {
      answer,
      citations: [],
      action: 'tool',
      toolCall: { name: resolved.tool, args: resolved.args, result: result.content },
      hops,
      durationMs: Date.now() - start,
      warnings,
    };
  }

  private async decide(query: string, candidates: readonly Candidate[]): Promise<DispatcherDecision> {
    const toolsText = this.registry
      .list()
      .map((tool) => compressSchema(tool))
      .join('\n');
    const prompt = buildDecisionPrompt(query, toolsText, candidates);
    return this.nano.promptStructured<DispatcherDecision>(prompt, DECISION_SCHEMA);
  }
}
