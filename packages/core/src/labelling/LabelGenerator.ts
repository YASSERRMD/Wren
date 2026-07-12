import type { WrenSection } from '../types.js';
import type { ProgressCallback } from './progress.js';

/**
 * Labelling runs at ingest, once, not at query time. This is the entire
 * reason the query path (Phase 10's dispatcher) can afford to be cheap:
 * it reads a pre-computed label off every candidate section rather than
 * asking Nano to summarise anything on the hot path.
 */
export interface LabelGenerator {
  /** Returns new section objects with `label` populated; does not mutate its input. */
  generateLabels(sections: readonly WrenSection[], onProgress?: ProgressCallback): Promise<WrenSection[]>;
}
