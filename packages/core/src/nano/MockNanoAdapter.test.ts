import { describe, expect, it } from 'vitest';
import { WrenSchemaError } from './errors.js';
import { MockNanoAdapter } from './MockNanoAdapter.js';

describe('MockNanoAdapter', () => {
  it('returns queued responses in order', async () => {
    const mock = new MockNanoAdapter(['first', 'second']);
    expect(await mock.prompt('a')).toBe('first');
    expect(await mock.prompt('b')).toBe('second');
  });

  it('throws when the queue is exhausted', async () => {
    const mock = new MockNanoAdapter(['only']);
    await mock.prompt('a');
    await expect(mock.prompt('b')).rejects.toThrow(/queue is empty/);
  });

  it('throws a queued Error to simulate failure', async () => {
    const failure = new Error('simulated nano failure');
    const mock = new MockNanoAdapter([failure]);
    await expect(mock.prompt('a')).rejects.toBe(failure);
  });

  it('records every call in callLog', async () => {
    const mock = new MockNanoAdapter(['x', 'y']);
    await mock.prompt('first input');
    await mock.prompt('second input', { signal: undefined });
    expect(mock.callLog.map((c) => c.input)).toEqual(['first input', 'second input']);
  });

  it('enqueue adds more responses after construction', async () => {
    const mock = new MockNanoAdapter(['a']);
    mock.enqueue('b', 'c');
    expect(await mock.prompt('1')).toBe('a');
    expect(await mock.prompt('2')).toBe('b');
    expect(await mock.prompt('3')).toBe('c');
  });

  describe('promptStructured', () => {
    const schema = {
      type: 'object' as const,
      required: ['label'],
      properties: { label: { type: 'string' as const } },
    };

    it('returns typed data on a valid response', async () => {
      const mock = new MockNanoAdapter([JSON.stringify({ label: 'ok' })]);
      expect(await mock.promptStructured('x', schema)).toEqual({ label: 'ok' });
    });

    it('throws WrenSchemaError on malformed JSON', async () => {
      const mock = new MockNanoAdapter(['not json']);
      await expect(mock.promptStructured('x', schema)).rejects.toBeInstanceOf(WrenSchemaError);
    });

    it('throws WrenSchemaError on schema mismatch', async () => {
      const mock = new MockNanoAdapter([JSON.stringify({ wrong: 1 })]);
      await expect(mock.promptStructured('x', schema)).rejects.toBeInstanceOf(WrenSchemaError);
    });
  });

  it('estimateTokens uses the same character heuristic as the real adapter fallback', async () => {
    const mock = new MockNanoAdapter();
    expect(await mock.estimateTokens('12345678')).toBe(2);
  });

  describe('quota', () => {
    it('defaults to a reasonable quota and can be overridden', () => {
      const mock = new MockNanoAdapter();
      expect(mock.quota).toEqual({ inputQuota: 6000, contextWindow: 6000, usage: 0 });

      mock.setQuota({ inputQuota: 100, contextWindow: 6000, usage: 5900 });
      expect(mock.quota).toEqual({ inputQuota: 100, contextWindow: 6000, usage: 5900 });
    });

    it('accepts an initial quota via the constructor', () => {
      const mock = new MockNanoAdapter([], { inputQuota: 10, contextWindow: 10, usage: 0 });
      expect(mock.quota.inputQuota).toBe(10);
    });
  });

  describe('clone', () => {
    it('copies the remaining queue and current quota independently of the original', async () => {
      const mock = new MockNanoAdapter(['a', 'b']);
      mock.setQuota({ inputQuota: 42, contextWindow: 42, usage: 0 });
      await mock.prompt('consume the first response');

      const cloned = await mock.clone();
      expect(cloned).not.toBe(mock);
      expect(cloned.quota.inputQuota).toBe(42);

      // Cloning copies the remaining queue rather than transferring it: both
      // the original and the clone still have 'b' to consume independently,
      // matching real session.clone() giving an independent conversation.
      expect(await cloned.prompt('x')).toBe('b');
      expect(await mock.prompt('y')).toBe('b');

      mock.enqueue('only on the original');
      cloned.enqueue('only on the clone');
      expect(await mock.prompt('z')).toBe('only on the original');
      expect(await cloned.prompt('z')).toBe('only on the clone');
    });
  });

  it('destroy is a no-op that does not throw', () => {
    const mock = new MockNanoAdapter();
    expect(() => mock.destroy()).not.toThrow();
  });
});
