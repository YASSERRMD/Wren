import { ChangeDetectionStrategy, Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isSupported, create, fakeWren } = vi.hoisted(() => ({
  isSupported: vi.fn(),
  create: vi.fn(),
  fakeWren: { destroy: vi.fn(async () => undefined), listDocuments: vi.fn(async () => []) },
}));

vi.mock('@wren/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wren/core')>();
  return { ...actual, Wren: { isSupported, create } };
});

import { WrenService } from './WrenService.js';

describe('WrenService signals in a zoneless configuration', () => {
  beforeEach(() => {
    isSupported.mockReset().mockResolvedValue({ storage: true, nano: 'available', webmcp: false });
    create.mockReset().mockResolvedValue(fakeWren);
  });

  it('an OnPush template bound to status() re-renders as the signal changes, with no manual detectChanges() after the initial render', async () => {
    @Component({
      selector: 'host',
      template: `<span>{{ wren.status() }}</span>`,
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class Host {
      wren = TestBed.inject(WrenService);
    }

    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()], imports: [Host] });
    const fixture = TestBed.createComponent(Host);
    fixture.autoDetectChanges();

    expect(fixture.nativeElement.textContent).toContain('initialising');

    await vi.waitFor(() => expect(fixture.nativeElement.textContent).toContain('ready'));
  });
});
