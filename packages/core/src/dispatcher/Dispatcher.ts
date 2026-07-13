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
  signal?: AbortSignal;
}

/** Fraction of inputQuota a prompt may use before truncation kicks in. Exported so Wren.create() can reuse it as WrenOptions.budgetRatio's own default. */
export const DEFAULT_BUDGET_RATIO = 0.7;
/** Rough chars-per-token used only to size a last-resort content truncation; never trusted for the go/no-go budget decision itself, which always calls estimateTokens. */
const APPROX_CHARS_PER_TOKEN = 4;

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('Dispatcher run aborted', 'AbortError');
  }
}

function truncateText(text: string, maxChars: number): string {
  const trimmed = text.trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars).trim()}...`;
}

/**
 * Per-action criteria, not just a one-line list of the four action names:
 * an eval run against real Gemini Nano found a bidirectional ~56% action
 * accuracy (queries expecting answer/tool often resolving to none, and
 * vice versa), which reads like too little signal to discriminate
 * reliably rather than random noise. The explicit "prefer X over none
 * when..." / "do not choose X just to avoid none" framing targets both
 * failure directions at once; unverified against real Nano from here (see
 * the linked issue), so evals/ should be re-run to confirm this actually
 * moves the accuracy number.
 */
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
    'Decide the single best action for this query:',
    '- answer: a candidate section is topically relevant to the query, even if not a perfect or complete match. Prefer this over none whenever a candidate genuinely relates to what is being asked.',
    '- tool: a tool description matches an action the query is asking to perform, rather than a question about existing content.',
    '- navigate: a candidate is clearly a broad overview and a more specific child section (not shown here) likely holds the real answer.',
    '- none: only when nothing among the candidate sections or tools actually relates to the query. Do not choose answer or tool just to avoid saying none.',
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

/**
 * The tool name/args JSON just above the instruction is grounding context
 * for the model, not an example of the expected reply shape; without an
 * explicit steer, small models tend to echo that JSON back as their
 * "answer" instead of writing prose (see the linked issue).
 */
function buildToolFollowupPrompt(
  query: string,
  toolName: string,
  args: Record<string, unknown>,
  result: string,
): string {
  return (
    `Query: "${query}"\n\nTool "${toolName}" was called with ${JSON.stringify(args)} and returned:\n${result}` +
    '\n\nWrite one short, natural-language sentence that answers the query using this result. ' +
    'Do not repeat the tool name, its arguments, or any JSON in your answer.'
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
      return this.actTool(decision, query, hops, start, warnings, opts);
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
      checkAborted(opts.signal);
      const prompt = buildToolFollowupPrompt(query, decision.tool, decision.args, result.content);
      yield* this.streamAnswer(prompt, opts, (answer) => ({
        answer,
        citations: [],
        action: 'tool',
        toolCall: { name: decision.tool, args: decision.args, result: result.content, isError: result.isError },
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
    yield* this.streamAnswer(buildAnswerPrompt(query, sections), opts, (answer) => ({
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
    checkAborted(opts.signal);
    let candidates = await this.retriever.search(query);
    checkAborted(opts.signal);

    let hops = 0;
    let decision = await this.decide(query, candidates, warnings, opts);
    checkAborted(opts.signal);

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
      checkAborted(opts.signal);
      decision = await this.decide(query, candidates, warnings, opts);
      checkAborted(opts.signal);
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

    const decision = await this.nano.promptStructured<DispatcherDecision>(prompt, DECISION_SCHEMA, { signal: opts.signal });

    // Distinguishes "Nano returned an id it was never shown" (a hallucination)
    // from an id that was valid at decide-time but is missing by answer-time
    // (which loadAndBudgetSections()'s own sections.length === 0 check covers).
    if (decision.action === 'answer') {
      const candidateIds = new Set(current.map((c) => c.sectionId));
      const unknownIds = decision.sectionIds.filter((id) => !candidateIds.has(id));
      if (unknownIds.length > 0) {
        const detail = `decide() returned sectionIds not present in the candidates it was shown: ${unknownIds.join(', ')}`;
        console.warn(`Wren: ${detail}`);
        warnings.push({ kind: 'decision-id-mismatch', detail });
      }
    }

    return decision;
  }

  /** Ordered truncation: drop whole sections first, then, only if a single remaining section is still too big, shorten its content. */
  private async loadAndBudgetSections(
    sectionIds: readonly string[],
    query: string,
    warnings: WrenWarning[],
    opts: DispatcherOptions,
  ): Promise<WrenSection[]> {
    let sections = await this.repo.getSections(sectionIds);
    checkAborted(opts.signal);
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
    checkAborted(opts.signal);
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

    const answer = await this.nano.prompt(buildAnswerPrompt(query, sections), { signal: opts.signal });

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
    opts: DispatcherOptions,
  ): Promise<WrenResponse> {
    const result = await this.registry.invoke(decision.tool, decision.args);
    checkAborted(opts.signal);

    const prompt = buildToolFollowupPrompt(query, decision.tool, decision.args, result.content);
    const answer = await this.nano.prompt(prompt, { signal: opts.signal });

    return {
      answer,
      citations: [],
      action: 'tool',
      toolCall: { name: decision.tool, args: decision.args, result: result.content, isError: result.isError },
      hops,
      durationMs: Date.now() - start,
      warnings,
    };
  }

  private async *streamAnswer(
    prompt: string,
    opts: DispatcherOptions,
    buildPartial: (accumulated: string) => Partial<WrenResponse>,
  ): AsyncGenerator<Partial<WrenResponse>> {
    let accumulated = '';
    for await (const delta of this.nano.promptStreaming(prompt, { signal: opts.signal })) {
      accumulated += delta;
      yield buildPartial(accumulated);
    }
  }
}
