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

/** The subset of LanguageModelCreateOptions worth preserving across a fallback re-creation (see cloneIsolated); excludes one-shot fields like monitor/signal that must not be replayed on a later, unrelated create() call. */
type StableCreateOptions = Pick<LanguageModelCreateOptions, 'initialPrompts' | 'expectedInputs' | 'expectedOutputs'>;

/** Every prompt template Wren builds internally (Dispatcher's decide/answer/tool-followup, NanoLabeller's labelling prompts) is hardcoded English text, so this is what NanoAdapter.create() declares by default. Chrome logs a quality/safety warning when expectedOutputs is left unspecified entirely; pass nanoOptions.expectedOutputs explicitly to override for a differently-localized deployment. */
const DEFAULT_EXPECTED_OUTPUTS: LanguageModelCreateOptions['expectedOutputs'] = [{ type: 'text', languages: ['en'] }];

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
  protected constructor(
    protected readonly session: LanguageModelSession,
    private readonly stableOptions: StableCreateOptions,
  ) {}

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
    const effectiveOptions: LanguageModelCreateOptions = {
      ...options,
      expectedOutputs: options.expectedOutputs ?? DEFAULT_EXPECTED_OUTPUTS,
    };
    const session = await LanguageModel.create(effectiveOptions);
    return new NanoAdapter(session, {
      initialPrompts: effectiveOptions.initialPrompts,
      expectedInputs: effectiveOptions.expectedInputs,
      expectedOutputs: effectiveOptions.expectedOutputs,
    });
  }

  async prompt(input: string, opts: LanguageModelPromptOptions = {}): Promise<string> {
    return this.withIsolatedSession((isolated) => isolated.prompt(input, opts));
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
    const isolated = await this.cloneIsolated();
    let overflowed = false;
    const onOverflow = (): void => {
      overflowed = true;
    };
    isolated.addEventListener('contextoverflow', onOverflow);
    try {
      if (!isolated.promptStreaming) {
        yield await isolated.prompt(input, opts);
        return;
      }
      let runningTotal = '';
      for await (const chunk of isolated.promptStreaming(input, opts)) {
        const isCumulative = runningTotal.length > 0 && chunk.startsWith(runningTotal);
        yield isCumulative ? chunk.slice(runningTotal.length) : chunk;
        runningTotal = isCumulative ? chunk : runningTotal + chunk;
      }
      if (overflowed) {
        throw new WrenContextOverflowError();
      }
    } catch (error) {
      throw this.translateError(error);
    } finally {
      isolated.removeEventListener('contextoverflow', onOverflow);
      isolated.destroy();
    }
  }

  /**
   * Estimates token cost via the session's own measurement, falling back to
   * a character-based heuristic (roughly 4 characters per token for
   * English text) when neither is exposed. Prefers measureContextUsage,
   * the current API name; measureInputUsage is the obsolete alias some
   * Chrome builds may still carry. Reads from the held template session
   * (see cloneIsolated's doc comment): since that session is never
   * prompted directly, its usage is always 0, so this always measures
   * against a full fresh budget, matching what an actual isolated call
   * will see.
   */
  async estimateTokens(text: string): Promise<number> {
    const measure = this.session.measureContextUsage ?? this.session.measureInputUsage;
    if (measure) {
      return measure.call(this.session, text);
    }
    return Math.ceil(text.length / 4);
  }

  /** Read live from the held template session on every access, never hard-coded; see cloneIsolated's doc comment for why its usage is always 0. */
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
   * Returns an independent NanoAdapter over a clone of the held session.
   * Exposed for callers that want their own long-lived adapter (e.g. a
   * separate Wren instance); nothing inside this class needs it, since
   * every prompt already isolates itself (see withIsolatedSession).
   */
  async clone(): Promise<NanoAdapter> {
    const cloned = await this.cloneIsolated();
    return new NanoAdapter(cloned, this.stableOptions);
  }

  destroy(): void {
    this.session.destroy();
  }

  private translateError(error: unknown): unknown {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      const withProps = error as DOMException & { requested?: number; contextWindow?: number };
      return new WrenQuotaExceededError(withProps.requested, withProps.contextWindow);
    }
    return error;
  }

  /**
   * session.clone() copies the CURRENT conversation state rather than
   * resetting it (verified empirically against real Chrome: a clone's
   * contextUsage starts equal to the source's, not 0). Prompting the held
   * session directly would therefore let every call accumulate into one
   * ever-growing conversation shared across ingestion labelling and every
   * query; in practice this measurably wastes budget and, worse, biases
   * later free-form calls toward whatever shape recent calls used (e.g. a
   * run of JSON-schema-constrained labelling calls making a later
   * unconstrained answer call keep responding in that same JSON shape).
   * Every prompt this class builds is already fully self-contained (all
   * needed context is embedded in the prompt text itself), so no call
   * ever benefits from seeing another call's history. The fix: the held
   * session is a template that is NEVER prompted directly (confirmed
   * empirically: a template that is only ever cloned, never prompted,
   * keeps contextUsage at 0 forever, so every clone starts genuinely
   * fresh); each real prompt() / promptStreaming() call clones its own
   * isolated session, uses it once, and destroys it.
   */
  private async cloneIsolated(): Promise<LanguageModelSession> {
    if (this.session.clone) {
      return this.session.clone();
    }
    if (typeof LanguageModel === 'undefined') {
      throw new WrenNanoUnavailableError('LanguageModel is not present in this browser');
    }
    return LanguageModel.create(this.stableOptions);
  }

  private async withIsolatedSession<T>(run: (isolated: LanguageModelSession) => Promise<T>): Promise<T> {
    const isolated = await this.cloneIsolated();
    let overflowed = false;
    const onOverflow = (): void => {
      overflowed = true;
    };
    isolated.addEventListener('contextoverflow', onOverflow);
    try {
      const result = await run(isolated);
      if (overflowed) {
        throw new WrenContextOverflowError();
      }
      return result;
    } catch (error) {
      throw this.translateError(error);
    } finally {
      isolated.removeEventListener('contextoverflow', onOverflow);
      isolated.destroy();
    }
  }
}
