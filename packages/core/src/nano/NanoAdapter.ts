import { WrenContextOverflowError, WrenNanoUnavailableError, WrenQuotaExceededError, WrenSchemaError } from './errors.js';
import type {
  LanguageModelCreateOptions,
  LanguageModelPromptOptions,
  LanguageModelSession,
  NanoAvailability,
} from './language-model.js';
import { matchesSchema, type JsonSchema } from './validateSchema.js';

export interface NanoQuota {
  /** Remaining budget available for new input: contextWindow minus current usage. */
  inputQuota: number;
  contextWindow: number;
  usage: number;
}

/**
 * The interface everything downstream of Nano (labelling, the dispatcher,
 * etc.) should depend on, rather than the concrete NanoAdapter, so
 * MockNanoAdapter can stand in for every test outside the eval harness.
 */
export interface NanoAdapterLike {
  prompt(input: string, opts?: LanguageModelPromptOptions): Promise<string>;
  promptStructured<T>(input: string, schema: JsonSchema, opts?: LanguageModelPromptOptions): Promise<T>;
  /** Always yields incremental deltas to its own consumers; see the implementation's doc comment for why that needs normalising. */
  promptStreaming(input: string, opts?: LanguageModelPromptOptions): AsyncIterable<string>;
  estimateTokens(text: string): Promise<number>;
  readonly quota: NanoQuota;
  clone(): Promise<NanoAdapterLike>;
  destroy(): void;
}

export class NanoAdapter implements NanoAdapterLike {
  private overflowed = false;
  private readonly onContextOverflow = (): void => {
    this.overflowed = true;
  };

  protected constructor(protected readonly session: LanguageModelSession) {
    this.session.addEventListener('contextoverflow', this.onContextOverflow);
  }

  static async availability(): Promise<NanoAvailability> {
    if (typeof LanguageModel === 'undefined') {
      return 'unavailable';
    }
    return LanguageModel.availability();
  }

  static async create(options: LanguageModelCreateOptions = {}): Promise<NanoAdapter> {
    if (typeof LanguageModel === 'undefined') {
      throw new WrenNanoUnavailableError('LanguageModel is not present in this browser');
    }
    const availability = await LanguageModel.availability();
    if (availability === 'unavailable') {
      throw new WrenNanoUnavailableError('availability() reported unavailable');
    }
    const session = await LanguageModel.create(options);
    return new NanoAdapter(session);
  }

  async prompt(input: string, opts: LanguageModelPromptOptions = {}): Promise<string> {
    if (this.overflowed) {
      throw new WrenContextOverflowError();
    }
    try {
      return await this.session.prompt(input, opts);
    } catch (error) {
      throw this.translateError(error);
    }
  }

  async promptStructured<T>(
    input: string,
    schema: JsonSchema,
    opts: LanguageModelPromptOptions = {},
  ): Promise<T> {
    const raw = await this.prompt(input, { ...opts, responseConstraint: schema as object });
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new WrenSchemaError(
        `Nano response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        raw,
      );
    }
    if (!matchesSchema(parsed, schema)) {
      throw new WrenSchemaError('Nano response did not match the expected schema', raw);
    }
    return parsed as T;
  }

  /**
   * Chrome's own promptStreaming() has documented, version-dependent
   * inconsistency: some builds yield cumulative text per chunk, others
   * yield incremental deltas. Rather than pick one and be wrong on the
   * other, this detects it per chunk (does the new chunk start with the
   * running total so far?) and always yields a true incremental delta to
   * its own consumers, so Wren's streaming contract is stable regardless
   * of which behavior the underlying browser has. Falls back to a single
   * whole-answer chunk via prompt() if this Chrome build does not expose
   * promptStreaming at all.
   */
  async *promptStreaming(input: string, opts: LanguageModelPromptOptions = {}): AsyncGenerator<string> {
    if (this.overflowed) {
      throw new WrenContextOverflowError();
    }
    if (!this.session.promptStreaming) {
      yield await this.prompt(input, opts);
      return;
    }
    let runningTotal = '';
    try {
      for await (const chunk of this.session.promptStreaming(input, opts)) {
        const isCumulative = runningTotal.length > 0 && chunk.startsWith(runningTotal);
        yield isCumulative ? chunk.slice(runningTotal.length) : chunk;
        runningTotal = isCumulative ? chunk : runningTotal + chunk;
      }
    } catch (error) {
      throw this.translateError(error);
    }
  }

  /**
   * Estimates token cost via the session's own measurement, falling back to
   * a character-based heuristic (roughly 4 characters per token for
   * English text) when neither is exposed. Prefers measureContextUsage,
   * the current API name; measureInputUsage is the obsolete alias some
   * Chrome builds may still carry.
   */
  async estimateTokens(text: string): Promise<number> {
    const measure = this.session.measureContextUsage ?? this.session.measureInputUsage;
    if (measure) {
      return measure.call(this.session, text);
    }
    return Math.ceil(text.length / 4);
  }

  /** Read live from the session on every access, never hard-coded. */
  get quota(): NanoQuota {
    const contextWindow = this.session.contextWindow ?? this.session.inputQuota ?? 0;
    const usage = this.session.contextUsage ?? this.session.inputUsage ?? 0;
    return {
      contextWindow,
      usage,
      inputQuota: Math.max(0, contextWindow - usage),
    };
  }

  /**
   * Creating a session is expensive, so the intended pattern is to hold one
   * long-lived NanoAdapter and call clone() to get an isolated copy per
   * request, so unrelated calls do not accumulate shared context. Uses
   * session.clone() where available; recreates via LanguageModel.create()
   * if this Chrome build does not expose it. Documented per Phase 4's
   * requirement to record which path was used and why, rather than leaving
   * callers to guess whether isolation actually happened.
   */
  async clone(): Promise<NanoAdapter> {
    if (this.session.clone) {
      const cloned = await this.session.clone();
      return new NanoAdapter(cloned);
    }
    if (typeof LanguageModel === 'undefined') {
      throw new WrenNanoUnavailableError('LanguageModel is not present in this browser');
    }
    const recreated = await LanguageModel.create();
    return new NanoAdapter(recreated);
  }

  destroy(): void {
    this.session.removeEventListener('contextoverflow', this.onContextOverflow);
    this.session.destroy();
  }

  private translateError(error: unknown): unknown {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      const withProps = error as DOMException & { requested?: number; contextWindow?: number };
      return new WrenQuotaExceededError(withProps.requested, withProps.contextWindow);
    }
    return error;
  }
}
