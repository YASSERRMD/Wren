# @wren/core

A browser-native agent framework core: client-side retrieval and tool
dispatch over Gemini Nano (the Chrome Prompt API), with zero server, zero
network calls at runtime, and zero framework dependencies. `@wren/react`
and `@wren/angular` are thin bindings over this package; everything that
matters lives here.

## Install

```bash
npm install @wren/core
```

## Quickstart

```ts
const wren = await Wren.create();
await wren.ingest({ type: 'markdown', title: 'Docs', content: markdownSource });
const response = await wren.query('how do I reset my password?');
```

`response.answer` is grounded in `response.citations`, each pointing back
to the section it came from.

## Scope contract

Wren is deliberately narrow. Read this before reaching for a workaround.

**In scope:**
- Client-side only. No server, no network calls at runtime.
- Gemini Nano only as the model. No other backend.
- WebMCP (`navigator.modelContext`) as the only tool surface.
- Vectorless retrieval: an FTS5 lexical prefilter plus a shallow,
  LLM-navigable section tree. No embeddings, no vector database.
- Small corpora: page-scale, a handful of documents, not a library.
- One constrained Nano call per decision, with navigation capped at a
  single hop.

**Out of scope, deliberately:**
- Any model other than Gemini Nano. There is no cloud fallback and none
  is planned: a fallback would silently change what data leaves the
  browser, which defeats the point of a client-side-only design.
- Any retrieval mode other than FTS5 plus the section tree. Embeddings
  and vector search pull in a model download and an index format that a
  page-scale corpus does not need.
- Server components or API routes of any kind.
- Autonomous multi-hop planning. The dispatcher is intentionally capped
  at one navigate hop; a small on-device model cannot be trusted with
  open-ended agent loops, and a hard cap is easier to reason about than
  a soft one.
- Cross-origin tool access. WebMCP tools are same-origin only.
- Bindings beyond React and Angular.

## Hard constraints

- Nano's shared input and output context window is small, roughly 6,000
  tokens, and is read from `session.inputQuota` / `session.contextWindow`
  at runtime. Wren never hard-codes a quota.
- Nano's native `tools` and `execute` path is experimental and
  unavailable on stable web pages. Tool invocation is hand-rolled
  instead: Nano returns constrained JSON, Wren validates it, and Wren
  calls the matching WebMCP tool's `execute` directly.
- Nano's tool-selection accuracy degrades as the number of registered
  tools rises. Wren enforces a soft cap (`WrenOptions.toolCap`, default
  7) and warns above it rather than throwing.
- Chrome auto-updates Nano, so its behavior drifts over time. Do not
  assume today's prompt-response shape is permanent.

## What Wren does not do, and why

- **It does not call out to any server.** Every ingested document and
  every query stays on the device running Nano. If that is not the
  tradeoff you want, this is not the right tool.
- **It does not do semantic or vector search.** At page scale, a lexical
  prefilter over a shallow section tree finds the right section as
  reliably as an embedding index would, without the extra model
  download, index format, or failure modes that come with one.
- **It does not let the model wander.** Navigation is capped at one
  hop, hard-enforced in code, not just prompted for. A second attempted
  hop is coerced into an answer rather than allowed to continue, so a
  query always terminates in bounded time.
- **It does not manage more than a handful of tools gracefully.** Past
  the recommended cap, Nano's own tool-selection accuracy drops. Wren
  surfaces that as a warning instead of hiding it.
