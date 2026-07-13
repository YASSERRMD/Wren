import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isSupported, create, fakeWren } = vi.hoisted(() => {
  const destroy = vi.fn(async () => undefined);
  return {
    isSupported: vi.fn(),
    create: vi.fn(),
    fakeWren: { destroy },
  };
});

vi.mock('@wren/core', () => ({
  Wren: { isSupported, create },
}));

import { WrenContext } from './WrenContext.js';
import { WrenProvider } from './WrenProvider.js';

describe('WrenProvider', () => {
  beforeEach(() => {
    isSupported.mockReset();
    create.mockReset();
    fakeWren.destroy.mockClear();
  });

  it('goes through initialising to ready once Wren.create() resolves', async () => {
    isSupported.mockResolvedValue({ storage: true, nano: 'available', webmcp: false });
    create.mockResolvedValue(fakeWren);

    const seenStatuses: string[] = [];
    render(
      <WrenProvider>
        <WrenContext.Consumer>
          {(value) => {
            if (value) seenStatuses.push(value.status);
            return null;
          }}
        </WrenContext.Consumer>
      </WrenProvider>,
    );

    expect(seenStatuses[0]).toBe('initialising');
    await waitFor(() => expect(seenStatuses.at(-1)).toBe('ready'));
  });

  it('reports unsupported without attempting Wren.create() when storage is unsupported', async () => {
    isSupported.mockResolvedValue({ storage: false, nano: 'unavailable', webmcp: false });

    let latestStatus: string | undefined;
    render(
      <WrenProvider>
        <WrenContext.Consumer>
          {(value) => {
            latestStatus = value?.status;
            return null;
          }}
        </WrenContext.Consumer>
      </WrenProvider>,
    );

    await waitFor(() => expect(latestStatus).toBe('unsupported'));
    expect(create).not.toHaveBeenCalled();
  });

  it('reports error when Wren.create() rejects', async () => {
    isSupported.mockResolvedValue({ storage: true, nano: 'unavailable', webmcp: false });
    create.mockRejectedValue(new Error('nano is unavailable'));

    let latest: { status?: string; error?: Error | null } = {};
    render(
      <WrenProvider>
        <WrenContext.Consumer>
          {(value) => {
            latest = { status: value?.status, error: value?.error };
            return null;
          }}
        </WrenContext.Consumer>
      </WrenProvider>,
    );

    await waitFor(() => expect(latest.status).toBe('error'));
    expect(latest.error?.message).toBe('nano is unavailable');
  });

  it('destroys the instance on unmount', async () => {
    isSupported.mockResolvedValue({ storage: true, nano: 'available', webmcp: false });
    create.mockResolvedValue(fakeWren);

    const { unmount } = render(<WrenProvider>{null}</WrenProvider>);
    await waitFor(() => expect(create).toHaveBeenCalled());
    await Promise.resolve();

    unmount();

    await waitFor(() => expect(fakeWren.destroy).toHaveBeenCalledTimes(1));
  });
});
