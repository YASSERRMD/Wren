export const WREN_CORE_VERSION = '0.0.0';

export { WrenStorage } from './storage/WrenStorage.js';
export type { Migration, SqlEngine } from './storage/migrations.js';
export {
  WrenStorageClosedError,
  WrenStorageError,
  WrenStorageUnsupportedError,
} from './storage/errors.js';
export { RpcError } from './storage/rpc-protocol.js';

export type { WrenDocument, WrenSection, WrenSourceType, WrenTreeNode } from './types.js';
export { ADD_CONTENT_HASH_MIGRATION, INITIAL_MIGRATION } from './documents/migrations.js';
export {
  DocumentRepository,
  MAX_SECTION_DEPTH,
  SectionDepthError,
} from './documents/DocumentRepository.js';

export { NanoAdapter } from './nano/NanoAdapter.js';
export type { NanoAdapterLike, NanoQuota } from './nano/NanoAdapter.js';
export type { NanoAvailability } from './nano/language-model.js';
export type { JsonSchema } from './nano/validateSchema.js';
export {
  WrenContextOverflowError,
  WrenNanoError,
  WrenNanoUnavailableError,
  WrenQuotaExceededError,
  WrenSchemaError,
} from './nano/errors.js';
export { MockNanoAdapter } from './nano/MockNanoAdapter.js';
export type { MockNanoCall } from './nano/MockNanoAdapter.js';

export { parse } from './ingest/parse.js';
export type { ParseOptions, ParsedDocument, ParseWarning, WrenSource } from './ingest/types.js';
export { DEFAULT_MAX_SECTION_CHARS } from './ingest/types.js';

export type { LabelGenerator } from './labelling/LabelGenerator.js';
export type { IngestProgress, ProgressCallback } from './labelling/progress.js';
export { HeuristicLabeller } from './labelling/HeuristicLabeller.js';
export { NanoLabeller } from './labelling/NanoLabeller.js';
export { hashContent } from './labelling/contentHash.js';
export { CachingLabelGenerator } from './labelling/CachingLabelGenerator.js';
export type { LabelCache } from './labelling/CachingLabelGenerator.js';
export { createLabelGenerator } from './labelling/createLabelGenerator.js';
export type { CreateLabelGeneratorResult, LabelStrategy } from './labelling/createLabelGenerator.js';

