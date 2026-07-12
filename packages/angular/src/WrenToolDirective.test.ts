import { ChangeDetectionStrategy, Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isSupported, create, fakeWren } = vi.hoisted(() => {
  const registerTool = vi.fn(() => vi.fn());
  return {
    isSupported: vi.fn(),
    create: vi.fn(),
    fakeWren: { destroy: vi.fn(async () => undefined), registerTool, listDocuments: vi.fn(async () => []) },
  };
});

vi.mock('@wren/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wren/core')>();
  return { ...actual, Wren: { isSupported, create } };
});

import type { WrenTool } from '@wren/core';
import { WrenService } from './WrenService.js';
import { WrenToolDirective } from './WrenToolDirective.js';

function tool(overrides: Partial<WrenTool> = {}): WrenTool {
  return { name: 'my_tool', description: 'x', inputSchema: { type: 'object' }, execute: async () => ({ content: 'ok' }), ...overrides };
}

describe('WrenToolDirective', () => {
  beforeEach(() => {
    isSupported.mockReset().mockResolvedValue({ storage: true, nano: 'available', webmcp: false });
    create.mockReset().mockResolvedValue(fakeWren);
    fakeWren.registerTool.mockClear();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  it('registers on init and unregisters on destroy', async () => {
    const unregisterSpy = vi.fn();
    fakeWren.registerTool.mockReturnValueOnce(unregisterSpy);

    @Component({ selector: 'host', template: `<div [wrenTool]="tool"></div>`, imports: [WrenToolDirective] })
    class Host {
      tool = tool();
    }

    TestBed.configureTestingModule({ imports: [Host] });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    const service = TestBed.inject(WrenService);
    await vi.waitFor(() => expect(service.status()).toBe('ready'));
    expect(fakeWren.registerTool).toHaveBeenCalledTimes(1);

    fixture.destroy();
    expect(unregisterSpy).toHaveBeenCalledTimes(1);
  });

  it('re-registers when the bound tool changes', async () => {
    const firstUnregister = vi.fn();
    const secondUnregister = vi.fn();
    fakeWren.registerTool.mockReturnValueOnce(firstUnregister).mockReturnValueOnce(secondUnregister);

    // Bound through a signal, not a plain mutable property: in a zoneless
    // app (Angular's default), a plain property reassignment with nothing
    // else marking the view dirty is not guaranteed to be picked back up
    // by change detection, verified separately; a signal read in the
    // template is the correct, supported way to make a bound value change.
    @Component({
      selector: 'host',
      template: `<div [wrenTool]="tool()"></div>`,
      imports: [WrenToolDirective],
      changeDetection: ChangeDetectionStrategy.OnPush,
    })
    class Host {
      tool = signal(tool({ description: 'first' }));
    }

    TestBed.configureTestingModule({ imports: [Host] });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    const service = TestBed.inject(WrenService);
    await vi.waitFor(() => expect(service.status()).toBe('ready'));
    expect(fakeWren.registerTool).toHaveBeenCalledTimes(1);

    const secondTool = tool({ description: 'second' });
    fixture.componentInstance.tool.set(secondTool);
    fixture.detectChanges();

    expect(firstUnregister).toHaveBeenCalledTimes(1);
    expect(fakeWren.registerTool).toHaveBeenCalledTimes(2);
    expect(fakeWren.registerTool).toHaveBeenLastCalledWith(secondTool);
  });

  it('does not register twice if the tool object reference is unchanged across change detection', async () => {
    const sameTool = tool();
    @Component({ selector: 'host', template: `<div [wrenTool]="tool"></div>`, imports: [WrenToolDirective] })
    class Host {
      tool = sameTool;
    }

    TestBed.configureTestingModule({ imports: [Host] });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    const service = TestBed.inject(WrenService);
    await vi.waitFor(() => expect(service.status()).toBe('ready'));

    fixture.detectChanges();
    fixture.detectChanges();

    expect(fakeWren.registerTool).toHaveBeenCalledTimes(1);
  });
});
