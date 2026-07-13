import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WrenContextOverflowError,
  WrenNanoUnavailableError,
  WrenQuotaExceededError,
  WrenSchemaError,
} from './errors.js';
import type {
  LanguageModelCreateOptions,
  LanguageModelPromptOptions,
  LanguageModelSession,
  LanguageModelStatic,
  NanoAvailability,
} from './language-model.js';
import { NanoAdapter } from './NanoAdapter.js';

type Listener = () => void;

class FakeSession implements LanguageModelSession {
  destroyed = false;
  promptImpl: (input: string, opts?: LanguageModelPromptOptions) => Promise<string> = async (input) => input;
  contextWindow: number | undefined = 6000;
  contextUsage: number | undefined = 100;
  inputQuota: number | undefined;
  inputUsage: number | undefined;
  measureContextUsage: ((input: string) => Promise<number>) | undefined;
  measureInputUsage: ((input: string) => Promise<number>) | undefined;
  /** Deliberately a plain optional property, not a prototype method, so tests can make it genuinely absent. */
  clone: (() => Promise<LanguageModelSession>) | undefined;

  private readonly listeners = new Map<string, Set<Listener>>();

  async prompt(input: string, opts?: LanguageModelPromptOptions): Promise<string> {
    return this.promptImpl(input, opts);
  }

  destroy(): void {
    this.destroyed = true;
  }

  addEventListener(type: string, listener: Listener): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function stubLanguageModel(overrides: {
  availability?: NanoAvailability;
  session?: FakeSession;
}): FakeSession {
  const session = overrides.session ?? new FakeSession();
  const stub: LanguageModelStatic = {
    availability: async () => overrides.availability ?? 'available',
    create: async () => session,
  };
  vi.stubGlobal('LanguageModel', stub);
  return session;
}

describe('NanoAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('availability', () => {
    it('returns unavailable when LanguageModel does not exist', async () => {
      vi.stubGlobal('LanguageModel', undefined);
      expect(await NanoAdapter.availability()).toBe('unavailable');
    });

    it('delegates to LanguageModel.availability() otherwise', async () => {
      stubLanguageModel({ availability: 'downloadable' });
      expect(await NanoAdapter.availability()).toBe('downloadable');
    });
  });

  describe('create', () => {
    it('throws WrenNanoUnavailableError when LanguageModel does not exist', async () => {
      vi.stubGlobal('LanguageModel', undefined);
      await expect(NanoAdapter.create()).rejects.toBeInstanceOf(WrenNanoUnavailableError);
    });

    it('throws WrenNanoUnavailableError when availability is unavailable', async () => {
      stubLanguageModel({ availability: 'unavailable' });
      await expect(NanoAdapter.create()).rejects.toBeInstanceOf(WrenNanoUnavailableError);
    });

    it('returns an adapter wrapping the created session otherwise', async () => {
      stubLanguageModel({ availability: 'available' });
      const adapter = await NanoAdapter.create();
      expect(adapter).toBeInstanceOf(NanoAdapter);
    });

    it('defaults expectedOutputs to English, matching Wren\'s own hardcoded English prompt templates', async () => {
      const session = new FakeSession();
      let seenOptions: LanguageModelCreateOptions | undefined;
      vi.stubGlobal('LanguageModel', {
        availability: async () => 'available',
        create: async (options?: LanguageModelCreateOptions) => {
          seenOptions = options;
          return session;
        },
      } satisfies LanguageModelStatic);

      await NanoAdapter.create();

      expect(seenOptions?.expectedOutputs).toEqual([{ type: 'text', languages: ['en'] }]);
    });

    it('respects an explicit expectedOutputs override instead of the English default', async () => {
      const session = new FakeSession();
      let seenOptions: LanguageModelCreateOptions | undefined;
      vi.stubGlobal('LanguageModel', {
        availability: async () => 'available',
        create: async (options?: LanguageModelCreateOptions) => {
          seenOptions = options;
          return session;
        },
      } satisfies LanguageModelStatic);
      const expectedOutputs = [{ type: 'text' as const, languages: ['ja' as const] }];

      await NanoAdapter.create({ expectedOutputs });

      expect(seenOptions?.expectedOutputs).toBe(expectedOutputs);
    });
  });

  describe('prompt', () => {
    it('delegates to session.prompt', async () => {
      const session = stubLanguageModel({});
      session.promptImpl = async (input) => `echo:${input}`;
      const adapter = await NanoAdapter.create();
      expect(await adapter.prompt('hi')).toBe('echo:hi');
    });

    it('translates a QuotaExceededError DOMException into WrenQuotaExceededError', async () => {
      const session = stubLanguageModel({});
      session.promptImpl = async () => {
        const error = new DOMException('too big', 'QuotaExceededError') as DOMException & {
          requested?: number;
          contextWindow?: number;
        };
        error.requested = 9000;
        error.contextWindow = 6000;
        throw error;
      };
      const adapter = await NanoAdapter.create();
      const caught = await adapter.prompt('hi').catch((e: unknown) => e);
      expect(caught).toBeInstanceOf(WrenQuotaExceededError);
      expect((caught as WrenQuotaExceededError).requested).toBe(9000);
      expect((caught as WrenQuotaExceededError).contextWindow).toBe(6000);
    });

    it('throws WrenContextOverflowError for a call that fires contextoverflow on its own isolated session', async () => {
      const session = stubLanguageModel({});
      const clonedSession = new FakeSession();
      session.clone = async () => clonedSession;
      clonedSession.promptImpl = async (input) => {
        clonedSession.fire('contextoverflow');
        return input;
      };
      const adapter = await NanoAdapter.create();
      await expect(adapter.prompt('hi')).rejects.toBeInstanceOf(WrenContextOverflowError);
    });

    it('does not let one call overflowing affect a later, unrelated call', async () => {
      const session = stubLanguageModel({});
      let cloneCount = 0;
      session.clone = async () => {
        cloneCount += 1;
        const clone = new FakeSession();
        // Only the first call's isolated session overflows.
        if (cloneCount === 1) {
          clone.promptImpl = async (input) => {
            clone.fire('contextoverflow');
            return input;
          };
        }
        return clone;
      };
      const adapter = await NanoAdapter.create();
      await expect(adapter.prompt('first')).rejects.toBeInstanceOf(WrenContextOverflowError);
      await expect(adapter.prompt('second')).resolves.toBe('second');
    });

    it('leaves other errors untranslated', async () => {
      const session = stubLanguageModel({});
      session.promptImpl = async () => {
        throw new RangeError('something else');
      };
      const adapter = await NanoAdapter.create();
      await expect(adapter.prompt('hi')).rejects.toBeInstanceOf(RangeError);
    });

    it('prompts an isolated clone rather than the held session, and never accumulates history on it', async () => {
      const session = stubLanguageModel({});
      session.promptImpl = async () => {
        throw new Error('the held session should never be prompted directly');
      };
      const clonedSession = new FakeSession();
      clonedSession.promptImpl = async (input) => `echo:${input}`;
      session.clone = async () => clonedSession;

      const adapter = await NanoAdapter.create();
      await expect(adapter.prompt('hi')).resolves.toBe('echo:hi');
      expect(clonedSession.destroyed).toBe(true);
    });
  });

  describe('promptStructured', () => {
    const schema = {
      type: 'object' as const,
      required: ['label'],
      properties: { label: { type: 'string' as const } },
    };

    it('returns typed data on a valid response', async () => {
      const session = stubLanguageModel({});
      session.promptImpl = async () => JSON.stringify({ label: 'a short summary' });
      const adapter = await NanoAdapter.create();
      const result = await adapter.promptStructured<{ label: string }>('summarize', schema);
      expect(result).toEqual({ label: 'a short summary' });
    });

    it('passes the schema as responseConstraint', async () => {
      const session = stubLanguageModel({});
      let seenOpts: LanguageModelPromptOptions | undefined;
      session.promptImpl = async (_input, opts) => {
        seenOpts = opts;
        return '{"label":"x"}';
      };
      const adapter = await NanoAdapter.create();
      await adapter.promptStructured('summarize', schema);
      expect(seenOpts?.responseConstraint).toBe(schema);
    });

    it('throws WrenSchemaError on malformed JSON', async () => {
      const session = stubLanguageModel({});
      session.promptImpl = async () => 'not json {{{';
      const adapter = await NanoAdapter.create();
      const caught = await adapter.promptStructured('summarize', schema).catch((e: unknown) => e);
      expect(caught).toBeInstanceOf(WrenSchemaError);
      expect((caught as WrenSchemaError).rawResponse).toBe('not json {{{');
    });

    it('throws WrenSchemaError when the response does not match the schema', async () => {
      const session = stubLanguageModel({});
      session.promptImpl = async () => JSON.stringify({ wrongKey: 1 });
      const adapter = await NanoAdapter.create();
      await expect(adapter.promptStructured('summarize', schema)).rejects.toBeInstanceOf(WrenSchemaError);
    });

    it('retries once on a truncated-JSON response and returns the retry result', async () => {
      const session = stubLanguageModel({});
      let callCount = 0;
      session.promptImpl = async () => {
        callCount += 1;
        return callCount === 1 ? '{"label": "cut off' : JSON.stringify({ label: 'complete' });
      };
      const adapter = await NanoAdapter.create();

      const result = await adapter.promptStructured<{ label: string }>('summarize', schema);

      expect(result).toEqual({ label: 'complete' });
      expect(callCount).toBe(2);
    });

    it('sends a note about the cut-off response on the retry prompt', async () => {
      const session = stubLanguageModel({});
      const inputs: string[] = [];
      session.promptImpl = async (input) => {
        inputs.push(input);
        // Cut off right after the property's colon: "Unexpected end of JSON input", the other truncation shape.
        return inputs.length === 1 ? '{"label":' : JSON.stringify({ label: 'ok' });
      };
      const adapter = await NanoAdapter.create();

      await adapter.promptStructured('summarize this', schema);

      expect(inputs[0]).toBe('summarize this');
      expect(inputs[1]).toContain('summarize this');
      expect(inputs[1]).toContain('cut off before it finished');
    });

    it('does not retry a second time when the retry response is truncated again', async () => {
      const session = stubLanguageModel({});
      let callCount = 0;
      session.promptImpl = async () => {
        callCount += 1;
        return '{"label": "cut off';
      };
      const adapter = await NanoAdapter.create();

      const caught = await adapter.promptStructured('summarize', schema).catch((e: unknown) => e);

      expect(caught).toBeInstanceOf(WrenSchemaError);
      expect(callCount).toBe(2);
    });

    it('does not retry a malformed-but-not-truncated JSON response', async () => {
      const session = stubLanguageModel({});
      let callCount = 0;
      session.promptImpl = async () => {
        callCount += 1;
        return 'not json {{{';
      };
      const adapter = await NanoAdapter.create();

      await expect(adapter.promptStructured('summarize', schema)).rejects.toBeInstanceOf(WrenSchemaError);
      expect(callCount).toBe(1);
    });

    it('does not retry a well-formed response that simply does not match the schema', async () => {
      const session = stubLanguageModel({});
      let callCount = 0;
      session.promptImpl = async () => {
        callCount += 1;
        return JSON.stringify({ wrongKey: 1 });
      };
      const adapter = await NanoAdapter.create();

      await expect(adapter.promptStructured('summarize', schema)).rejects.toBeInstanceOf(WrenSchemaError);
      expect(callCount).toBe(1);
    });
  });

  describe('estimateTokens', () => {
    it('prefers measureContextUsage when present', async () => {
      const session = stubLanguageModel({});
      session.measureContextUsage = async () => 42;
      session.measureInputUsage = async () => 999;
      const adapter = await NanoAdapter.create();
      expect(await adapter.estimateTokens('hello')).toBe(42);
    });

    it('falls back to measureInputUsage when measureContextUsage is absent', async () => {
      const session = stubLanguageModel({});
      session.measureInputUsage = async () => 17;
      const adapter = await NanoAdapter.create();
      expect(await adapter.estimateTokens('hello')).toBe(17);
    });

    it('falls back to a character heuristic when neither is exposed', async () => {
      stubLanguageModel({});
      const adapter = await NanoAdapter.create();
      expect(await adapter.estimateTokens('12345678')).toBe(2);
    });
  });

  describe('quota', () => {
    it('reads live values from the session rather than a constant', async () => {
      const session = stubLanguageModel({});
      session.contextWindow = 6000;
      session.contextUsage = 100;
      const adapter = await NanoAdapter.create();
      expect(adapter.quota).toEqual({ contextWindow: 6000, usage: 100, inputQuota: 5900 });

      session.contextUsage = 5000;
      expect(adapter.quota).toEqual({ contextWindow: 6000, usage: 5000, inputQuota: 1000 });
    });

    it('falls back to the legacy inputQuota/inputUsage aliases', async () => {
      const session = stubLanguageModel({});
      session.contextWindow = undefined;
      session.contextUsage = undefined;
      session.inputQuota = 4000;
      session.inputUsage = 500;
      const adapter = await NanoAdapter.create();
      expect(adapter.quota).toEqual({ contextWindow: 4000, usage: 500, inputQuota: 3500 });
    });
  });

  describe('clone', () => {
    it('uses session.clone() when available', async () => {
      const session = stubLanguageModel({});
      const clonedSession = new FakeSession();
      session.clone = async () => clonedSession;
      const adapter = await NanoAdapter.create();
      const cloned = await adapter.clone();
      expect(cloned).toBeInstanceOf(NanoAdapter);
      expect(cloned).not.toBe(adapter);
    });

    it('recreates via LanguageModel.create() when session.clone is unavailable', async () => {
      const session = stubLanguageModel({});
      session.clone = undefined;
      const adapter = await NanoAdapter.create();
      const cloned = await adapter.clone();
      expect(cloned).toBeInstanceOf(NanoAdapter);
    });
  });

  describe('destroy', () => {
    it('destroys the held session', async () => {
      const session = stubLanguageModel({});
      const adapter = await NanoAdapter.create();

      adapter.destroy();

      expect(session.destroyed).toBe(true);
    });
  });

  describe('isolation', () => {
    it('never prompts the held session directly, so its own usage never grows', async () => {
      const session = stubLanguageModel({});
      session.contextUsage = 0;
      const clonedSession = new FakeSession();
      session.clone = async () => clonedSession;
      const adapter = await NanoAdapter.create();

      await adapter.prompt('one');
      await adapter.prompt('two');
      await adapter.prompt('three');

      expect(session.contextUsage).toBe(0);
    });

    it('cleans up each isolated clone (removes its listener, destroys it) after use', async () => {
      const session = stubLanguageModel({});
      const clonedSession = new FakeSession();
      session.clone = async () => clonedSession;
      const adapter = await NanoAdapter.create();

      await adapter.prompt('hi');

      expect(clonedSession.destroyed).toBe(true);
      expect(clonedSession.listenerCount('contextoverflow')).toBe(0);
    });

    it('preserves initialPrompts and expectedOutputs when falling back to LanguageModel.create() without session.clone', async () => {
      const session = new FakeSession();
      session.clone = undefined;
      const seenOptions: LanguageModelCreateOptions[] = [];
      const stub: LanguageModelStatic = {
        availability: async () => 'available',
        create: async (options) => {
          seenOptions.push(options ?? {});
          return session;
        },
      };
      vi.stubGlobal('LanguageModel', stub);
      const initialPrompts = [{ role: 'system', content: 'be concise' }];

      const adapter = await NanoAdapter.create({ initialPrompts });
      seenOptions.length = 0; // Only interested in calls made by prompt() below, not the create() above.
      await adapter.prompt('hi');

      expect(seenOptions).toEqual([
        { initialPrompts, expectedInputs: undefined, expectedOutputs: [{ type: 'text', languages: ['en'] }] },
      ]);
    });
  });
});
