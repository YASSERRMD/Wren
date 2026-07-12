import type { EvalEnvironment } from './environment.js';
import type { CaseOutcome, MetricsSummary } from './metrics.js';
import type { SweepStep } from './sweep.js';

export interface EvalReport {
  environment: EvalEnvironment;
  summary: MetricsSummary;
  toolCountSweep: SweepStep[];
  cases: Array<{
    id: string;
    category: string;
    query: string;
    expectedAction: string;
    actualAction: string;
    routingCorrect: boolean;
    retrievalCorrect: boolean | null;
    toolCorrect: boolean | null;
    hops: number;
    durationMs: number;
    warnings: readonly string[];
  }>;
}

export function buildReport(
  environment: EvalEnvironment,
  summary: MetricsSummary,
  toolCountSweep: SweepStep[],
  outcomes: readonly CaseOutcome[],
): EvalReport {
  return {
    environment,
    summary,
    toolCountSweep,
    cases: outcomes.map(({ evalCase, response, routingCorrect, retrievalCorrect, toolCorrect }) => ({
      id: evalCase.id,
      category: evalCase.category,
      query: evalCase.query,
      expectedAction: evalCase.expectedAction,
      actualAction: response.action,
      routingCorrect,
      retrievalCorrect: retrievalCorrect ?? null,
      toolCorrect: toolCorrect ?? null,
      hops: response.hops,
      durationMs: response.durationMs,
      warnings: response.warnings.map((w) => w.kind),
    })),
  };
}

/**
 * The harness cannot write into the repo itself (it is a browser page);
 * this triggers a normal download, and committing the file to
 * evals/results/ is a manual step, per evals/README.md.
 */
export function downloadReport(report: EvalReport): void {
  const filename = `eval-run-${report.environment.timestamp.replace(/[:.]/g, '-')}.json`;
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
