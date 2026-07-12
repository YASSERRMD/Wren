# @wren/react

React bindings for [`@wren/core`](../core/README.md): a provider and a set
of hooks over the `Wren` class, with tool registration lifetime tied to
component lifetime.

## Install

```bash
npm install @wren/react @wren/core
```

## Quickstart

```tsx
import { WrenProvider } from '@wren/react';

function App() {
  return (
    <WrenProvider>
      <Assistant />
    </WrenProvider>
  );
}
```

## Full example

```tsx
import { useEffect } from 'react';
import { WrenProvider, useWren, useTool, useQuery, useIngest, useDocuments } from '@wren/react';

function App() {
  return (
    <WrenProvider>
      <Assistant />
    </WrenProvider>
  );
}

function Assistant() {
  const { status, error } = useWren();
  const { ingest } = useIngest();
  const { documents } = useDocuments();
  const { query, response, loading, cancel } = useQuery();

  // A declarative tool: registered while this component is mounted,
  // unregistered automatically when it unmounts.
  useTool({
    name: 'get_current_time',
    description: 'Returns the current time as an ISO string.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ content: new Date().toISOString() }),
  });

  useEffect(() => {
    if (documents.length === 0) {
      void ingest({ type: 'text', title: 'Help', content: 'Wren answers questions about this page.' });
    }
  }, [documents.length, ingest]);

  if (status === 'initialising') return <p>Starting Wren...</p>;
  if (status === 'unsupported') return <p>This browser cannot run Wren.</p>;
  if (status === 'error') return <p>Wren failed to start: {error?.message}</p>;

  return (
    <div>
      <button onClick={() => query('what time is it?')} disabled={loading}>
        Ask
      </button>
      {loading && <button onClick={cancel}>Cancel</button>}
      {response && <p>{response.answer}</p>}
    </div>
  );
}
```

## API

- **`WrenProvider`**: creates one `Wren` instance for its subtree from
  `WrenOptions` props, and destroys it on unmount.
- **`useWren()`**: `{ wren, status, error }`, where `status` is one of
  `'initialising' | 'ready' | 'unsupported' | 'error'`.
- **`useTool(tool, deps?)`**: registers a tool on mount, unregisters on
  unmount, re-registers when `deps` changes.
- **`useQuery()`**: `{ query, response, loading, error, cancel }`. Starting
  a new query cancels whatever is still in flight; unmounting cancels the
  last one.
- **`useStreamingQuery()`**: the same shape as `useQuery`, but
  `response.answer` accumulates as Wren streams it in.
- **`useIngest()`**: `{ ingest, progress, loading, error }`, with
  `progress` updated as ingestion moves through parsing, labelling, and
  indexing.
- **`useDocuments()`**: `{ documents, loading, error, refresh,
  deleteDocument }`. Refetches automatically after a successful
  `useIngest` call or its own `deleteDocument`, from any component
  watching the same `Wren` instance.

## React Strict Mode

Every hook here is written so that its effect setup and cleanup are
defined together and are exact inverses of each other. That is what
makes registration survive Strict Mode's development-only mount, clean
up, and remount cycle: `useTool` ends up with exactly one registration
either way, not zero and not two.
