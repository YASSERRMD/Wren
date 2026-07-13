# Wren Eval Harness

Evidence, not hope, about whether Wren actually works. Runs Wren's
dispatcher against a small fixed fixture corpus and a set of eval
cases, using this browser's real Gemini Nano. This is a browser page,
not a Node test, because it needs a real model: nothing about routing,
retrieval, or tool selection accuracy can be verified against a mock.

## Why this exists

Chrome auto-updates Nano. Its behavior drifts between versions in ways
nothing else in this repo would catch: `@wren/core`'s own test suite
mocks Nano deliberately (see its README), so it verifies Wren's own
logic, not the model's actual behavior. This harness is the only thing
in the repo that would notice if a Chrome update made Nano worse (or
better) at routing, retrieval, or tool selection against a real corpus.

## Running it

```bash
pnpm --filter @wren/evals run dev
```

Open the page it prints, click "Run evals", and wait. If Nano's
`availability()` is `'downloadable'` rather than `'available'`, the
first run triggers a real model download; this can take a while and
only needs to happen once per Chrome profile.

## Interpreting the results

The page reports, per run:

- **Routing accuracy**: the fraction of cases where Nano's chosen
  action (`answer`, `tool`, `none`) matched what the case expected.
- **Retrieval accuracy**: among cases that specify which section
  heading should be cited, the fraction where it actually was.
- **Tool selection accuracy**: among cases that specify a tool, the
  fraction where Nano picked that tool with arguments that at least
  loosely matched (case-insensitive substring per expected key, not
  exact equality: natural-language argument extraction varies in
  phrasing even when it is functionally correct).
- **Budget truncation rate**: how often the dispatcher had to drop or
  shorten content to fit Nano's context window. A high rate on this
  small a corpus would be surprising and worth investigating.
- **Hop count distribution**: how often Nano navigates at all, and
  whether the hard one-hop cap is ever actually hit.
- **Query / ingest latency (p50 / p95)**: nearest-rank percentiles, so
  every reported number is a duration that was actually observed, never
  an interpolated one.
- **Tool count sweep**: the same tool-selection cases re-run with only
  3, 5, 7, then 10 tools registered, to check the recommended cap of 7
  empirically against this corpus rather than trusting a published
  benchmark. If accuracy on this corpus drops before 7 tools, or holds
  steady well past it, `WrenOptions.toolCap`'s default should change to
  match what was actually measured here, not stay at 7 by convention.

Eval cases are inherently probabilistic, not deterministic assertions:
a single run's failures are not necessarily bugs, and a single run's
clean pass is not proof of correctness. Judge trends across runs, not
any one run in isolation.

## Recording drift

Click "Download results JSON" after a run finishes. It downloads
`eval-run-<timestamp>.json`, containing the full environment (Chrome
version, Nano availability), every metric above, the tool count sweep,
and every individual case's outcome. Move it into `evals/results/` and
commit it:

```bash
mv ~/Downloads/eval-run-*.json evals/results/
git add evals/results/
git commit -m "chore: record eval run against Chrome <version>"
```

Committing the raw JSON, not just a summary, is what makes drift
visible in `git log -p evals/results/` and `git diff` between two runs:
a future regression shows up as an actual diff against a real prior
run, not a vague memory of "it used to work better."

**Run this on every Chrome stable release**, not just when touching
Wren's own code. Nano can get better or worse at routing, retrieval, or
tool selection purely from a browser update, with nothing in this
repository's own history to explain why.
