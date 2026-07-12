import type { NanoAdapterLike } from '../nano/NanoAdapter.js';
import type { Candidate, LexicalRetriever } from '../retrieval/LexicalRetriever.js';
import { compressSchema } from '../tools/compressSchema.js';
import type { ToolRegistry } from '../tools/ToolRegistry.js';
import { DECISION_SCHEMA, type DispatcherDecision, type WrenResponse, type WrenWarning } from './types.js';

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

/**
 * The heart of Wren: BM25 prefilter, one constrained Nano call to decide,
 * execute, answer. Every query goes through here. See DECISION_SCHEMA for
 * the four actions Nano can choose between.
 */
export class Dispatcher {
  constructor(
    private readonly nano: NanoAdapterLike,
    private readonly retriever: LexicalRetriever,
    private readonly registry: ToolRegistry,
  ) {}

  async run(query: string): Promise<WrenResponse> {
    const start = Date.now();
    const warnings: WrenWarning[] = [];
    const candidates = await this.retriever.search(query);
    const decision = await this.decide(query, candidates);

    if (decision.action === 'none') {
      return {
        answer: `No answer found: ${decision.reason}`,
        citations: [],
        action: 'none',
        hops: 0,
        durationMs: Date.now() - start,
        warnings,
      };
    }

    throw new Error(`Dispatcher action "${decision.action}" is not yet implemented`);
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
