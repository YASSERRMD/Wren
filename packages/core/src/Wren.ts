import { DocumentRepository } from './documents/DocumentRepository.js';
import { ADD_CONTENT_HASH_MIGRATION, INITIAL_MIGRATION } from './documents/migrations.js';
import { DEFAULT_BUDGET_RATIO, Dispatcher, type DispatcherOptions } from './dispatcher/Dispatcher.js';
import type { WrenResponse } from './dispatcher/types.js';
import { DEFAULT_MAX_SECTION_CHARS } from './ingest/types.js';
import { Ingestor, type IngestOptions, type IngestResult } from './ingest/Ingestor.js';
import type { WrenSource } from './ingest/types.js';
import type { LabelStrategy } from './labelling/createLabelGenerator.js';
import { NanoAdapter } from './nano/NanoAdapter.js';
import type { NanoAdapterLike } from './nano/NanoAdapter.js';
import type { LanguageModelCreateOptions, NanoAvailability } from './nano/language-model.js';
import { LexicalRetriever } from './retrieval/LexicalRetriever.js';
import type { SqlEngine } from './storage/migrations.js';
import { WrenStorage } from './storage/WrenStorage.js';
import { ToolRegistry } from './tools/ToolRegistry.js';
import type { WrenTool } from './tools/WrenTool.js';
import type { WrenDocument } from './types.js';

const DEFAULT_DB_NAME = 'wren.sqlite3';
const MIGRATIONS = [INITIAL_MIGRATION, ADD_CONTENT_HASH_MIGRATION];

/** What Wren needs from storage beyond SqlEngine: a way to release the underlying resource on destroy(). */
interface WrenStorageLike extends SqlEngine {
  close(): Promise<void>;
}

export interface WrenOptions {
  dbName?: string;
  /** Default 'auto': Nano if available, heuristic otherwise. Applied to every ingest() call that does not override it. */
  labeller?: LabelStrategy | 'auto';
  maxSectionChars?: number;
  budgetRatio?: number;
  /** Recommended maximum tools before Nano's tool-selection accuracy degrades; registering past it only warns, never throws. */
  toolCap?: number;
  nanoOptions?: LanguageModelCreateOptions;
}

interface WrenDefaults {
  labeller: LabelStrategy | 'auto';
  maxSectionChars: number;
  budgetRatio: number;
}

/** Lets a consumer degrade knowingly instead of discovering missing capabilities via a thrown error mid-use. */
export interface WrenSupport {
  storage: boolean;
  nano: NanoAvailability;
  webmcp: boolean;
}

/**
 * The only class most consumers touch directly: assembles storage, the
 * Nano adapter, the document repository, retriever, tool registry,
 * ingestor, and dispatcher behind one client-side API.
 */
export class Wren {
  private constructor(
    private readonly storage: WrenStorageLike,
    private readonly nano: NanoAdapterLike,
    private readonly repo: DocumentRepository,
    private readonly registry: ToolRegistry,
    private readonly ingestor: Ingestor,
    private readonly dispatcher: Dispatcher,
    private readonly defaults: WrenDefaults,
  ) {}

  static async create(opts: WrenOptions = {}): Promise<Wren> {
    const storage = await WrenStorage.open(opts.dbName ?? DEFAULT_DB_NAME, MIGRATIONS);
    const nano = await NanoAdapter.create(opts.nanoOptions);
    const repo = new DocumentRepository(storage);
    const retriever = new LexicalRetriever(storage);
    const registry = new ToolRegistry(opts.toolCap);
    const ingestor = new Ingestor(repo);
    const dispatcher = new Dispatcher(nano, retriever, repo, registry);

    return new Wren(storage, nano, repo, registry, ingestor, dispatcher, {
      labeller: opts.labeller ?? 'auto',
      maxSectionChars: opts.maxSectionChars ?? DEFAULT_MAX_SECTION_CHARS,
      budgetRatio: opts.budgetRatio ?? DEFAULT_BUDGET_RATIO,
    });
  }

  static async isSupported(): Promise<WrenSupport> {
    return {
      storage: WrenStorage.isSupported(),
      nano: await NanoAdapter.availability(),
      webmcp: typeof navigator !== 'undefined' && navigator.modelContext !== undefined,
    };
  }

  async ingest(source: WrenSource, opts: IngestOptions = {}): Promise<IngestResult> {
    return this.ingestor.ingest(source, {
      ...opts,
      labeller: opts.labeller ?? this.defaults.labeller,
      maxSectionChars: opts.maxSectionChars ?? this.defaults.maxSectionChars,
    });
  }

  async query(text: string, opts: DispatcherOptions = {}): Promise<WrenResponse> {
    return this.dispatcher.run(text, { ...opts, budgetRatio: opts.budgetRatio ?? this.defaults.budgetRatio });
  }

  queryStreaming(text: string, opts: DispatcherOptions = {}): AsyncGenerator<Partial<WrenResponse>> {
    return this.dispatcher.runStreaming(text, {
      ...opts,
      budgetRatio: opts.budgetRatio ?? this.defaults.budgetRatio,
    });
  }

  registerTool(tool: WrenTool): () => void {
    return this.registry.register(tool);
  }

  async listDocuments(): Promise<WrenDocument[]> {
    return this.repo.listDocuments();
  }

  async deleteDocument(id: string): Promise<void> {
    await this.repo.deleteDocument(id);
  }

  /** Deletes every ingested document, leaving registered tools and the session untouched. */
  async clear(): Promise<void> {
    const docs = await this.repo.listDocuments();
    for (const doc of docs) {
      await this.repo.deleteDocument(doc.id);
    }
  }

  async destroy(): Promise<void> {
    this.nano.destroy();
    await this.storage.close();
  }
}
