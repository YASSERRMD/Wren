import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WrenContextOverflowError,
  WrenNanoUnavailableError,
  WrenQuotaExceededError,
  WrenSchemaError,
} from './errors.js';
import type {
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

    it('throws WrenContextOverflowError on the call after contextoverflow fires', async () => {
      const session = stubLanguageModel({});
      const adapter = await NanoAdapter.create();
      session.fire('contextoverflow');
      await expect(adapter.prompt('hi')).rejects.toBeInstanceOf(WrenContextOverflowError);
    });

    it('leaves other errors untranslated', async () => {
      const session = stubLanguageModel({});
      session.promptImpl = async () => {
        throw new RangeError('something else');
      };
      const adapter = await NanoAdapter.create();
      await expect(adapter.prompt('hi')).rejects.toBeInstanceOf(RangeError);
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
    it('destroys the session and unsubscribes the overflow listener', async () => {
      const session = stubLanguageModel({});
      const adapter = await NanoAdapter.create();
      expect(session.listenerCount('contextoverflow')).toBe(1);

      adapter.destroy();

      expect(session.destroyed).toBe(true);
      expect(session.listenerCount('contextoverflow')).toBe(0);
    });
  });
});
