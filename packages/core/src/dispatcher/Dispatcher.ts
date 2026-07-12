import type { DocumentRepository } from '../documents/DocumentRepository.js';
import type { NanoAdapterLike } from '../nano/NanoAdapter.js';
import type { Candidate, LexicalRetriever } from '../retrieval/LexicalRetriever.js';
import { compressSchema } from '../tools/compressSchema.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import type { WrenSection } from '../types.js';
import { DECISION_SCHEMA, type Citation, type DispatcherDecision, type WrenResponse, type WrenWarning } from './types.js';

export interface DispatcherOptions {
  /** Fraction of inputQuota a prompt may use before truncation kicks in, leaving headroom for output. */
  budgetRatio?: number;
}

const DEFAULT_BUDGET_RATIO = 0.7;
/** Rough chars-per-token used only to size a last-resort content truncation; never trusted for the go/no-go budget decision itself, which always calls estimateTokens. */
const APPROX_CHARS_PER_TOKEN = 4;

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

  async run(query: string, opts: DispatcherOptions = {}): Promise<WrenResponse> {
    const start = Date.now();
    const warnings: WrenWarning[] = [];
    const { decision, hops } = await this.resolveDecision(query, warnings, opts);

    if (decision.action === 'answer') {
      return this.actAnswer(decision, query, hops, start, warnings, opts);
    }
    if (decision.action === 'tool') {
      return this.actTool(decision, query, hops, start, warnings);
    }
    return {
      answer: `No answer found: ${decision.reason}`,
      citations: [],
      action: 'none',
      hops,
      durationMs: Date.now() - start,
      warnings,
    };
  }

  /**
   * Only the final answer-generation call streams: the decision call does
   * not, because it is structured output and the whole thing is needed at
   * once to act on it. Each yielded value carries the answer accumulated
   * so far; every other field is already final by the first yield.
   */
  async *runStreaming(query: string, opts: DispatcherOptions = {}): AsyncGenerator<Partial<WrenResponse>> {
    const start = Date.now();
    const warnings: WrenWarning[] = [];
    const { decision, hops } = await this.resolveDecision(query, warnings, opts);

    if (decision.action === 'none') {
      yield {
        answer: `No answer found: ${decision.reason}`,
        citations: [],
        action: 'none',
        hops,
        durationMs: Date.now() - start,
        warnings,
      };
      return;
    }

    if (decision.action === 'tool') {
      const result = await this.registry.invoke(decision.tool, decision.args);
      const prompt = buildToolFollowupPrompt(query, decision.tool, decision.args, result.content);
      yield* this.streamAnswer(prompt, (answer) => ({
        answer,
        citations: [],
        action: 'tool',
        toolCall: { name: decision.tool, args: decision.args, result: result.content },
        hops,
        durationMs: Date.now() - start,
        warnings,
      }));
      return;
    }

    const sections = await this.loadAndBudgetSections(decision.sectionIds, query, warnings, opts);
    if (sections.length === 0) {
      yield {
        answer: 'No answer found: the chosen sections could not be located.',
        citations: [],
        action: 'none',
        hops,
        durationMs: Date.now() - start,
        warnings,
      };
      return;
    }
    const citations = sectionsToCitations(sections);
    yield* this.streamAnswer(buildAnswerPrompt(query, sections), (answer) => ({
      answer,
      citations,
      action: 'answer',
      hops,
      durationMs: Date.now() - start,
      warnings,
    }));
  }

  /** Steps 1 and 2: prefilter, decide, and the hard-capped navigate loop. Shared by run() and runStreaming(). */
  private async resolveDecision(
    query: string,
    warnings: WrenWarning[],
    opts: DispatcherOptions,
  ): Promise<{
    decision: Exclude<DispatcherDecision, { action: 'navigate' }>;
    candidates: Candidate[];
    hops: number;
  }> {
    let candidates = await this.retriever.search(query);

    let hops = 0;
    let decision = await this.decide(query, candidates, warnings, opts);

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
      decision = await this.decide(query, candidates, warnings, opts);
    }

    // The while condition above guarantees decision.action !== 'navigate'
    // here; TypeScript cannot see that across the loop's own reassignments,
    // so this is a narrow, deliberate assertion of that runtime invariant.
    return { decision: decision as Exclude<DispatcherDecision, { action: 'navigate' }>, candidates, hops };
  }

  private async decide(
    query: string,
    candidates: readonly Candidate[],
    warnings: WrenWarning[],
    opts: DispatcherOptions,
  ): Promise<DispatcherDecision> {
    const toolsText = this.registry
      .list()
      .map((tool) => compressSchema(tool))
      .join('\n');
    const budget = this.nano.quota.inputQuota * (opts.budgetRatio ?? DEFAULT_BUDGET_RATIO);

    let current = [...candidates];
    let prompt = buildDecisionPrompt(query, toolsText, current);
    while (current.length > 1 && (await this.nano.estimateTokens(prompt)) > budget) {
      current = current.slice(0, -1);
      prompt = buildDecisionPrompt(query, toolsText, current);
      warnings.push({
        kind: 'budget-truncated',
        detail: `Dropped a decision candidate to fit the token budget; ${current.length} remain.`,
      });
    }

    return this.nano.promptStructured<DispatcherDecision>(prompt, DECISION_SCHEMA);
  }

  /** Ordered truncation: drop whole sections first, then, only if a single remaining section is still too big, shorten its content. */
  private async loadAndBudgetSections(
    sectionIds: readonly string[],
    query: string,
    warnings: WrenWarning[],
    opts: DispatcherOptions,
  ): Promise<WrenSection[]> {
    let sections = await this.repo.getSections(sectionIds);
    if (sections.length === 0) return [];

    const budget = this.nano.quota.inputQuota * (opts.budgetRatio ?? DEFAULT_BUDGET_RATIO);

    while (sections.length > 1 && (await this.nano.estimateTokens(buildAnswerPrompt(query, sections))) > budget) {
      sections = sections.slice(0, -1);
      warnings.push({
        kind: 'budget-truncated',
        detail: `Dropped an answer section to fit the token budget; ${sections.length} remain.`,
      });
    }
    if ((await this.nano.estimateTokens(buildAnswerPrompt(query, sections))) > budget) {
      const maxChars = Math.max(200, Math.floor(budget * APPROX_CHARS_PER_TOKEN));
      sections = [{ ...sections[0], content: truncateText(sections[0].content, maxChars) }];
      warnings.push({
        kind: 'budget-truncated',
        detail: 'Truncated the answer section content to fit the token budget.',
      });
    }
    return sections;
  }

  private async actAnswer(
    decision: { action: 'answer'; sectionIds: string[] },
    query: string,
    hops: number,
    start: number,
    warnings: WrenWarning[],
    opts: DispatcherOptions,
  ): Promise<WrenResponse> {
    const sections = await this.loadAndBudgetSections(decision.sectionIds, query, warnings, opts);
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

  private async actTool(
    decision: { action: 'tool'; tool: string; args: Record<string, unknown> },
    query: string,
    hops: number,
    start: number,
    warnings: WrenWarning[],
  ): Promise<WrenResponse> {
    const result = await this.registry.invoke(decision.tool, decision.args);
    const prompt = buildToolFollowupPrompt(query, decision.tool, decision.args, result.content);
    const answer = await this.nano.prompt(prompt);

    return {
      answer,
      citations: [],
      action: 'tool',
      toolCall: { name: decision.tool, args: decision.args, result: result.content },
      hops,
      durationMs: Date.now() - start,
      warnings,
    };
  }

  private async *streamAnswer(
    prompt: string,
    buildPartial: (accumulated: string) => Partial<WrenResponse>,
  ): AsyncGenerator<Partial<WrenResponse>> {
    let accumulated = '';
    for await (const delta of this.nano.promptStreaming(prompt)) {
      accumulated += delta;
      yield buildPartial(accumulated);
    }
  }
}
