import { NanoAdapter } from '../nano/NanoAdapter.js';
import type { NanoAdapterLike } from '../nano/NanoAdapter.js';
import { HeuristicLabeller } from './HeuristicLabeller.js';
import type { LabelGenerator } from './LabelGenerator.js';
import { NanoLabeller } from './NanoLabeller.js';

export type LabelStrategy = 'nano' | 'heuristic';

export interface CreateLabelGeneratorResult {
  generator: LabelGenerator;
  strategy: LabelStrategy;
}

/**
 * Ingest must never hard-fail because of model availability: this always
 * resolves, falling back to HeuristicLabeller whenever Nano cannot be
 * used, including on any unexpected error from the adapter itself. The
 * returned strategy is what the caller (Phase 7's Ingestor) records on
 * WrenDocument.meta.labelStrategy.
 *
 * requestedStrategy 'auto' (the default) only uses Nano when it is
 * already 'available': it does not trigger a model download mid-ingest,
 * since that could stall an otherwise-fast operation for an unbounded
 * time. Pass 'nano' explicitly to opt into waiting for a download.
 */
export async function createLabelGenerator(
  requestedStrategy: LabelStrategy | 'auto' = 'auto',
  nanoFactory: () => Promise<NanoAdapterLike> = () => NanoAdapter.create(),
): Promise<CreateLabelGeneratorResult> {
  const heuristicResult: CreateLabelGeneratorResult = { generator: new HeuristicLabeller(), strategy: 'heuristic' };

  if (requestedStrategy === 'heuristic') {
    return heuristicResult;
  }

  try {
    const availability = await NanoAdapter.availability();
    if (availability === 'unavailable') {
      return heuristicResult;
    }
    if (requestedStrategy === 'nano' || availability === 'available') {
      const nano = await nanoFactory();
      return { generator: new NanoLabeller(nano), strategy: 'nano' };
    }
    return heuristicResult;
  } catch {
    return heuristicResult;
  }
}
