import { DestroyRef, Injectable, NgZone, inject, signal } from '@angular/core';
import { Wren, type IngestOptions, type IngestProgress, type IngestResult, type WrenDocument, type WrenResponse, type WrenSource, type WrenTool } from '@wren/core';
import { Observable } from 'rxjs';
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
  private readonly ngZone = inject(NgZone);

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
        this.ngZone.run(() => this.statusSignal.set('unsupported'));
        return;
      }
      const wren = await Wren.create(this.options);
      this.ngZone.run(() => {
        this.wrenSignal.set(wren);
        this.flushPendingTools(wren);
        this.statusSignal.set('ready');
      });
      await this.refreshDocuments();
    } catch (error) {
      const normalised = error instanceof Error ? error : new Error(String(error));
      this.ngZone.run(() => {
        this.errorSignal.set(normalised);
        this.statusSignal.set('error');
      });
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
    this.ngZone.run(() => this.ingestProgressSignal.set(undefined));
    try {
      const result = await wren.ingest(source, {
        ...opts,
        onProgress: (progress) => {
          this.ngZone.run(() => this.ingestProgressSignal.set(progress));
          opts.onProgress?.(progress);
        },
      });
      await this.refreshDocuments();
      return result;
    } finally {
      this.ngZone.run(() => this.ingestProgressSignal.set(undefined));
    }
  }

  async refreshDocuments(): Promise<void> {
    const wren = this.wrenSignal();
    if (!wren) return;
    const documents = await wren.listDocuments();
    this.ngZone.run(() => this.documentsSignal.set(documents));
  }

  async deleteDocument(id: string): Promise<void> {
    const wren = this.wrenSignal();
    if (!wren) return;
    await wren.deleteDocument(id);
    await this.refreshDocuments();
  }

  /** Emits the response once and completes. Unsubscribing before then aborts the query via AbortSignal. */
  query(text: string): Observable<WrenResponse> {
    return new Observable<WrenResponse>((subscriber) => {
      const wren = this.wrenSignal();
      if (!wren) {
        subscriber.error(new Error('WrenService is not ready yet'));
        return undefined;
      }
      const controller = new AbortController();
      wren
        .query(text, { signal: controller.signal })
        .then((response) => {
          this.ngZone.run(() => {
            subscriber.next(response);
            subscriber.complete();
          });
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) this.ngZone.run(() => subscriber.error(error));
        });
      return () => controller.abort();
    });
  }

  /** Same cancellation contract as query(), but emits once per streamed chunk; the final emission's answer is the full accumulated text. */
  queryStreaming(text: string): Observable<Partial<WrenResponse>> {
    return new Observable<Partial<WrenResponse>>((subscriber) => {
      const wren = this.wrenSignal();
      if (!wren) {
        subscriber.error(new Error('WrenService is not ready yet'));
        return undefined;
      }
      const controller = new AbortController();
      (async () => {
        try {
          for await (const partial of wren.queryStreaming(text, { signal: controller.signal })) {
            this.ngZone.run(() => subscriber.next(partial));
          }
          this.ngZone.run(() => subscriber.complete());
        } catch (error) {
          if (!controller.signal.aborted) this.ngZone.run(() => subscriber.error(error));
        }
      })();
      return () => controller.abort();
    });
  }
}
