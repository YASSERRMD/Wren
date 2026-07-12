export interface IngestProgress {
  phase: 'parsing' | 'labelling' | 'indexing';
  current: number;
  total: number;
}

export type ProgressCallback = (progress: IngestProgress) => void;
