import type { Wren } from '@wren/core';
import { EVAL_CASES } from './cases.js';
import { scoreCase } from './metrics.js';
import { EVAL_TOOLS } from './tools.js';

export const TOOL_COUNT_SWEEP_SIZES: readonly number[] = [3, 5, 7, 10];

export interface SweepStep {
  toolCount: number;
  casesRun: number;
  toolSelectionAccuracy: number;
}

function fraction(correct: number, total: number): number {
  return total === 0 ? NaN : correct / total;
}

/**
 * Registers only the first `toolCount` tools from EVAL_TOOLS and runs
 * only the tool-selection cases whose expectedTool is among them, so
 * "accuracy at N tools" measures the same fixed set of cases growing
 * denser with distractors, not a moving target of which cases apply.
 * This is the empirical check the recommended cap of 7 is based on: if
 * this corpus shows accuracy dropping earlier (or later), the default
 * in WrenOptions.toolCap should move to match, not stay at 7 because a
 * published benchmark said so.
 */
export async function runToolCountSweep(wren: Wren, log: (message: string) => void): Promise<SweepStep[]> {
  const results: SweepStep[] = [];

  for (const toolCount of TOOL_COUNT_SWEEP_SIZES) {
    const subset = EVAL_TOOLS.slice(0, toolCount);
    const subsetNames = new Set(subset.map((tool) => tool.name));
    const unregisterFns = subset.map((tool) => wren.registerTool(tool));

    const applicableCases = EVAL_CASES.filter((c) => c.expectedTool && subsetNames.has(c.expectedTool));
    let correct = 0;
    for (const evalCase of applicableCases) {
      const response = await wren.query(evalCase.query);
      const outcome = scoreCase(evalCase, response);
      if (outcome.toolCorrect) correct += 1;
    }

    const accuracy = fraction(correct, applicableCases.length);
    results.push({ toolCount, casesRun: applicableCases.length, toolSelectionAccuracy: accuracy });
    log(`  ${toolCount} tools registered: ${correct}/${applicableCases.length} correct (${(accuracy * 100).toFixed(0)}%)`);

    for (const unregister of unregisterFns) unregister();
  }

  return results;
}
