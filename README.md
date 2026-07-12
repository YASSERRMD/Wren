# Wren

Wren is a browser-native agent framework for React and Angular, built on
Gemini Nano, WebMCP, and vectorless retrieval.

## Stack

- Model: Gemini Nano via the Chrome Prompt API. No other model, no cloud
  fallback.
- Tools: WebMCP (`navigator.modelContext`) as the only tool surface.
- Retrieval: vectorless. An FTS5 lexical prefilter plus a shallow,
  LLM-navigable section tree. No embeddings, no vector database.
- Storage: SQLite WASM over OPFS, in a Web Worker.

## Scope contract

**In scope**

- Client-side only. No server, no network calls at runtime.
- Gemini Nano only as the model.
- WebMCP as the only tool surface.
- Vectorless retrieval: FTS5 plus a shallow section tree, capped at two
  navigation hops.
- Small, page-scale corpora.

**Out of scope**

- Any model other than Gemini Nano.
- Embeddings or vector storage of any kind.
- Server components or API routes.
- Multi-hop autonomous planning beyond the capped dispatcher.
- Vue, Svelte, or any binding beyond React and Angular.

## Requirements

- Chrome desktop with the Prompt API and the on-device Nano model available.
- The WebMCP origin trial or flag, for the tool bridge to external agents.
  Wren's own dispatcher works without it.

## Packages

```
packages/core     @wren/core     framework-agnostic, zero UI dependencies
packages/react    @wren/react    provider and hooks
packages/angular  @wren/angular  module, service, and directive
examples/         example applications
evals/            browser-based eval harness
```

## Development

```
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

## Status

Under active, phased development. The public API will change while WebMCP
is in origin trial.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
