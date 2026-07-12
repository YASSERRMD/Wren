import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isSupported, create, fakeWren } = vi.hoisted(() => {
  return {
    isSupported: vi.fn(),
    create: vi.fn(),
    fakeWren: {
      destroy: vi.fn(async () => undefined),
      listDocuments: vi.fn(async () => []),
      query: vi.fn(),
      queryStreaming: vi.fn(),
    },
  };
});

vi.mock('@wren/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wren/core')>();
  return { ...actual, Wren: { isSupported, create } };
});

import type { WrenResponse } from '@wren/core';
import { WrenService } from './WrenService.js';

function response(answer: string): WrenResponse {
  return { answer, action: 'answer', citations: [], hops: 0, durationMs: 1, warnings: [] };
}

describe('WrenService query/queryStreaming', () => {
  beforeEach(() => {
    isSupported.mockReset().mockResolvedValue({ storage: true, nano: 'available', webmcp: false });
    create.mockReset().mockResolvedValue(fakeWren);
    fakeWren.query.mockReset();
    fakeWren.queryStreaming.mockReset();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  async function readyService(): Promise<WrenService> {
    const service = TestBed.inject(WrenService);
    await vi.waitFor(() => expect(service.status()).toBe('ready'));
    return service;
  }

  it('query() emits the response once and completes', async () => {
    fakeWren.query.mockResolvedValue(response('hi'));
    const service = await readyService();

    const received: WrenResponse[] = [];
    let completed = false;
    await new Promise<void>((resolve) => {
      service.query('hello').subscribe({
        next: (v) => received.push(v),
        complete: () => {
          completed = true;
          resolve();
        },
      });
    });

    expect(received).toEqual([response('hi')]);
    expect(completed).toBe(true);
  });

  it('query() errors when the service is not ready yet', async () => {
    const service = TestBed.inject(WrenService);
    let caught: unknown;
    service.query('hello').subscribe({ error: (e) => (caught = e) });
    expect(caught).toBeInstanceOf(Error);
  });

  it('unsubscribing cancels the in-flight query via AbortSignal', async () => {
    let capturedSignal!: AbortSignal;
    fakeWren.query.mockImplementation(
      (_text: string, opts: { signal: AbortSignal }) =>
        new Promise(() => {
          capturedSignal = opts.signal;
        }),
    );
    const service = await readyService();

    const subscription = service.query('hello').subscribe();
    await vi.waitFor(() => expect(capturedSignal).toBeDefined());

    subscription.unsubscribe();
    expect(capturedSignal.aborted).toBe(true);
  });

  it('queryStreaming() emits once per chunk then completes', async () => {
    async function* gen() {
      yield { answer: 'Hello', action: 'answer' as const, citations: [], hops: 0, durationMs: 1, warnings: [] };
      yield { answer: 'Hello world', action: 'answer' as const, citations: [], hops: 0, durationMs: 1, warnings: [] };
    }
    fakeWren.queryStreaming.mockReturnValue(gen());
    const service = await readyService();

    const answers: (string | undefined)[] = [];
    await new Promise<void>((resolve) => {
      service.queryStreaming('hello').subscribe({ next: (v) => answers.push(v.answer), complete: resolve });
    });

    expect(answers).toEqual(['Hello', 'Hello world']);
  });

  it('unsubscribing cancels an in-flight streaming query via AbortSignal', async () => {
    let capturedSignal!: AbortSignal;
    fakeWren.queryStreaming.mockImplementation(async function* (_text: string, opts: { signal: AbortSignal }) {
      capturedSignal = opts.signal;
      await new Promise(() => {});
      yield { answer: 'never', action: 'answer' as const, citations: [], hops: 0, durationMs: 1, warnings: [] };
    });
    const service = await readyService();

    const subscription = service.queryStreaming('hello').subscribe();
    await vi.waitFor(() => expect(capturedSignal).toBeDefined());

    subscription.unsubscribe();
    expect(capturedSignal.aborted).toBe(true);
  });
});
