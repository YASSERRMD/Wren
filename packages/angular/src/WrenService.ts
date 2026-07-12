import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Wren, type IngestOptions, type IngestProgress, type IngestResult, type WrenDocument, type WrenSource, type WrenTool } from '@wren/core';
import { WREN_OPTIONS } from './wren-options.js';

/**
 * `'initialising'` while Wren.create() is in flight, `'unsupported'` when
 * this browser lacks OPFS/Worker storage support, `'error'` when creation
 * itself threw, `'ready'` once the service is safe to use.
 */
export type WrenStatus = 'initialising' | 'ready' | 'unsupported' | 'error';

/**
 * Wraps one `Wren` instance for the app: creates it once (asynchronously,
 * exposed as signals rather than a promise a component has to await),
 * and destroys it when the service itself is destroyed. `status`,
 * `documents`, and `ingestProgress` are signals; see query() and
 * queryStreaming() for the observable-based streams.
 */
@Injectable({ providedIn: 'root' })
export class WrenService {
  private readonly options = inject(WREN_OPTIONS, { optional: true }) ?? {};

  private readonly wrenSignal = signal<Wren | null>(null);
  private readonly statusSignal = signal<WrenStatus>('initialising');
  private readonly errorSignal = signal<Error | null>(null);
  private readonly documentsSignal = signal<WrenDocument[]>([]);
  private readonly ingestProgressSignal = signal<IngestProgress | undefined>(undefined);

  readonly status = this.statusSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();
  readonly documents = this.documentsSignal.asReadonly();
  readonly ingestProgress = this.ingestProgressSignal.asReadonly();

  /** Tools registered before Wren finished initialising, applied once it is ready. Keyed so unregistering a still-pending tool is a no-op on the real registry. */
  private readonly pendingTools = new Map<symbol, WrenTool>();
  private readonly activeUnregisters = new Map<symbol, () => void>();

  constructor() {
    void this.initialise();
    inject(DestroyRef).onDestroy(() => {
      void this.wrenSignal()?.destroy();
    });
  }

  private async initialise(): Promise<void> {
    try {
      const support = await Wren.isSupported();
      if (!support.storage) {
        this.statusSignal.set('unsupported');
        return;
      }
      const wren = await Wren.create(this.options);
      this.wrenSignal.set(wren);
      this.flushPendingTools(wren);
      this.statusSignal.set('ready');
      await this.refreshDocuments();
    } catch (error) {
      this.errorSignal.set(error instanceof Error ? error : new Error(String(error)));
      this.statusSignal.set('error');
    }
  }

  /** Registers a tool for the lifetime of the caller; safe to call before Wren finishes initialising. Call the returned function to unregister. */
  registerTool(tool: WrenTool): () => void {
    const id = Symbol();
    const wren = this.wrenSignal();
    if (wren) {
      this.activeUnregisters.set(id, wren.registerTool(tool));
    } else {
      this.pendingTools.set(id, tool);
    }
    return () => {
      this.pendingTools.delete(id);
      this.activeUnregisters.get(id)?.();
      this.activeUnregisters.delete(id);
    };
  }

  private flushPendingTools(wren: Wren): void {
    for (const [id, tool] of this.pendingTools) {
      this.activeUnregisters.set(id, wren.registerTool(tool));
    }
    this.pendingTools.clear();
  }

  async ingest(source: WrenSource, opts: IngestOptions = {}): Promise<IngestResult | undefined> {
    const wren = this.wrenSignal();
    if (!wren) return undefined;
    this.ingestProgressSignal.set(undefined);
    try {
      const result = await wren.ingest(source, {
        ...opts,
        onProgress: (progress) => {
          this.ingestProgressSignal.set(progress);
          opts.onProgress?.(progress);
        },
      });
      await this.refreshDocuments();
      return result;
    } finally {
      this.ingestProgressSignal.set(undefined);
    }
  }

  async refreshDocuments(): Promise<void> {
    const wren = this.wrenSignal();
    if (!wren) return;
    this.documentsSignal.set(await wren.listDocuments());
  }

  async deleteDocument(id: string): Promise<void> {
    const wren = this.wrenSignal();
    if (!wren) return;
    await wren.deleteDocument(id);
    await this.refreshDocuments();
  }
}
