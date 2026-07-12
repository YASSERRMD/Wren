import type { WrenResponse } from '@wren/core';
import type { EvalCase, EvalCategory } from './cases.js';

export interface CaseOutcome {
  evalCase: EvalCase;
  response: WrenResponse;
  routingCorrect: boolean;
  /** undefined when the case has no expectedSectionHeadings (not applicable, not a failure). */
  retrievalCorrect: boolean | undefined;
  /** undefined when the case has no expectedTool. */
  toolCorrect: boolean | undefined;
}

function checkRetrieval(evalCase: EvalCase, response: WrenResponse): boolean | undefined {
  if (!evalCase.expectedSectionHeadings) return undefined;
  const actualHeadings = response.citations.map((c) => c.heading);
  return evalCase.expectedSectionHeadings.some((expected) => actualHeadings.includes(expected));
}

/** Args are compared per key, case-insensitive substring, not exact equality: natural-language extraction varies in phrasing even when the tool call is functionally correct. */
function checkToolSelection(evalCase: EvalCase, response: WrenResponse): boolean | undefined {
  if (!evalCase.expectedTool) return undefined;
  if (response.toolCall?.name !== evalCase.expectedTool) return false;
  if (!evalCase.expectedArgs) return true;
  return Object.entries(evalCase.expectedArgs).every(([key, expectedValue]) => {
    const actualValue = response.toolCall?.args[key];
    return typeof actualValue === 'string' && actualValue.toLowerCase().includes(expectedValue.toLowerCase());
  });
}

export function scoreCase(evalCase: EvalCase, response: WrenResponse): CaseOutcome {
  return {
    evalCase,
    response,
    routingCorrect: response.action === evalCase.expectedAction,
    retrievalCorrect: checkRetrieval(evalCase, response),
    toolCorrect: checkToolSelection(evalCase, response),
  };
}

export interface CategoryBreakdown {
  total: number;
  routingCorrect: number;
}

export interface LatencyStats {
  p50: number;
  p95: number;
  count: number;
}

/** Nearest-rank percentile: no interpolation, so the reported value is always a duration that was actually observed. */
function percentile(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) return NaN;
  const index = Math.min(sortedAscending.length - 1, Math.floor(p * sortedAscending.length));
  return sortedAscending[index];
}

export function computeLatencyStats(durationsMs: readonly number[]): LatencyStats {
  const sorted = [...durationsMs].sort((a, b) => a - b);
  return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), count: sorted.length };
}

export interface MetricsSummary {
  totalCases: number;
  routingAccuracy: number;
  /** Fraction correct among cases that specify expectedSectionHeadings; NaN if none do. */
  retrievalAccuracy: number;
  /** Fraction correct among cases that specify expectedTool; NaN if none do. */
  toolSelectionAccuracy: number;
  /** Fraction of cases where the dispatcher reported at least one budget-truncated warning. */
  budgetTruncationRate: number;
  hopCounts: Record<number, number>;
  byCategory: Record<EvalCategory, CategoryBreakdown>;
  queryLatency: LatencyStats;
  ingestLatency: LatencyStats;
}

function fraction(correct: number, total: number): number {
  return total === 0 ? NaN : correct / total;
}

export function summarise(outcomes: readonly CaseOutcome[], ingestDurationsMs: readonly number[] = []): MetricsSummary {
  const routingCorrectCount = outcomes.filter((o) => o.routingCorrect).length;

  const retrievalApplicable = outcomes.filter((o) => o.retrievalCorrect !== undefined);
  const retrievalCorrectCount = retrievalApplicable.filter((o) => o.retrievalCorrect).length;

  const toolApplicable = outcomes.filter((o) => o.toolCorrect !== undefined);
  const toolCorrectCount = toolApplicable.filter((o) => o.toolCorrect).length;

  const truncatedCount = outcomes.filter((o) => o.response.warnings.some((w) => w.kind === 'budget-truncated')).length;

  const hopCounts: Record<number, number> = {};
  for (const { response } of outcomes) {
    hopCounts[response.hops] = (hopCounts[response.hops] ?? 0) + 1;
  }

  const byCategory = {} as Record<EvalCategory, CategoryBreakdown>;
  for (const outcome of outcomes) {
    const bucket = (byCategory[outcome.evalCase.category] ??= { total: 0, routingCorrect: 0 });
    bucket.total += 1;
    if (outcome.routingCorrect) bucket.routingCorrect += 1;
  }

  return {
    totalCases: outcomes.length,
    routingAccuracy: fraction(routingCorrectCount, outcomes.length),
    retrievalAccuracy: fraction(retrievalCorrectCount, retrievalApplicable.length),
    toolSelectionAccuracy: fraction(toolCorrectCount, toolApplicable.length),
    budgetTruncationRate: fraction(truncatedCount, outcomes.length),
    hopCounts,
    byCategory,
    queryLatency: computeLatencyStats(outcomes.map((o) => o.response.durationMs)),
    ingestLatency: computeLatencyStats(ingestDurationsMs),
  };
}
