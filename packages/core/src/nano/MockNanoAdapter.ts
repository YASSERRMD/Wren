import { WrenSchemaError } from './errors.js';
import type { LanguageModelPromptOptions } from './language-model.js';
import type { NanoAdapterLike, NanoQuota } from './NanoAdapter.js';
import { matchesSchema, type JsonSchema } from './validateSchema.js';

export interface MockNanoCall {
  input: string;
  opts?: LanguageModelPromptOptions;
}

type QueuedResponse = { kind: 'text'; value: string } | { kind: 'error'; error: Error };

const DEFAULT_QUOTA: NanoQuota = { inputQuota: 6000, contextWindow: 6000, usage: 0 };

/**
 * Drives NanoAdapterLike from a scripted queue of responses instead of a
 * real Chrome session. Every test outside the eval harness (Phase 14) uses
 * this rather than real Nano.
 */
export class MockNanoAdapter implements NanoAdapterLike {
  private queue: QueuedResponse[];
  private quotaValue: NanoQuota;
  private readonly calls: MockNanoCall[] = [];

  constructor(responses: readonly (string | Error)[] = [], quota: NanoQuota = DEFAULT_QUOTA) {
    this.queue = responses.map(toQueuedResponse);
    this.quotaValue = quota;
  }

  /** Every prompt() call this adapter has received, in order, for asserting what was sent. */
  get callLog(): readonly MockNanoCall[] {
    return this.calls;
  }

  enqueue(...responses: readonly (string | Error)[]): void {
    this.queue.push(...responses.map(toQueuedResponse));
  }

  setQuota(quota: NanoQuota): void {
    this.quotaValue = quota;
  }

  async prompt(input: string, opts?: LanguageModelPromptOptions): Promise<string> {
    this.calls.push({ input, opts });
    const next = this.queue.shift();
    if (!next) {
      throw new Error('MockNanoAdapter: response queue is empty');
    }
    if (next.kind === 'error') {
      throw next.error;
    }
    return next.value;
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
        `Mock response was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        raw,
      );
    }
    if (!matchesSchema(parsed, schema)) {
      throw new WrenSchemaError('Mock response did not match the expected schema', raw);
    }
    return parsed as T;
  }

  async estimateTokens(text: string): Promise<number> {
    return Math.ceil(text.length / 4);
  }

  get quota(): NanoQuota {
    return this.quotaValue;
  }

  async clone(): Promise<MockNanoAdapter> {
    const cloned = new MockNanoAdapter([], this.quotaValue);
    cloned.queue = [...this.queue];
    return cloned;
  }

  destroy(): void {
    // Nothing to release: no real session, no real listeners.
  }
}

function toQueuedResponse(response: string | Error): QueuedResponse {
  return response instanceof Error ? { kind: 'error', error: response } : { kind: 'text', value: response };
}
