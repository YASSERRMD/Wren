import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLabelGenerator } from './createLabelGenerator.js';
import { HeuristicLabeller } from './HeuristicLabeller.js';
import { NanoLabeller } from './NanoLabeller.js';

describe('createLabelGenerator', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to heuristic without throwing when LanguageModel does not exist', async () => {
    vi.stubGlobal('LanguageModel', undefined);
    const result = await createLabelGenerator();
    expect(result.strategy).toBe('heuristic');
    expect(result.generator).toBeInstanceOf(HeuristicLabeller);
  });

  it('falls back to heuristic without throwing when availability is unavailable', async () => {
    vi.stubGlobal('LanguageModel', {
      availability: async () => 'unavailable',
      create: async () => {
        throw new Error('should not be called');
      },
    });
    const result = await createLabelGenerator();
    expect(result.strategy).toBe('heuristic');
  });

  it('in auto mode, does not trigger a download: falls back when availability is downloadable', async () => {
    vi.stubGlobal('LanguageModel', {
      availability: async () => 'downloadable',
      create: async () => {
        throw new Error('should not be called in auto mode when not yet available');
      },
    });
    const result = await createLabelGenerator('auto');
    expect(result.strategy).toBe('heuristic');
  });

  it('uses NanoLabeller when availability is available', async () => {
    const fakeSession = {
      destroy: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    vi.stubGlobal('LanguageModel', {
      availability: async () => 'available',
      create: async () => fakeSession,
    });
    const result = await createLabelGenerator();
    expect(result.strategy).toBe('nano');
    expect(result.generator).toBeInstanceOf(NanoLabeller);
  });

  it('falls back to heuristic without throwing if NanoAdapter.create() throws unexpectedly', async () => {
    vi.stubGlobal('LanguageModel', {
      availability: async () => 'available',
      create: async () => {
        throw new Error('boom');
      },
    });
    const result = await createLabelGenerator();
    expect(result.strategy).toBe('heuristic');
  });

  it('requesting heuristic explicitly never touches LanguageModel at all', async () => {
    vi.stubGlobal('LanguageModel', {
      availability: async () => {
        throw new Error('should not be called');
      },
      create: async () => {
        throw new Error('should not be called');
      },
    });
    const result = await createLabelGenerator('heuristic');
    expect(result.strategy).toBe('heuristic');
  });
});
