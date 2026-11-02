# perpwatch — Build Report

MCP Rebuild 1000, Batch 11. Clean-room rebuild of
MarketTrace/markettrace-agent-feed (rank 453), built from the
firsthand spec at `specs-batch10/markettrace.md`; the tool
contract (names, descriptions, input schemas) was transcribed
from the in-repo `tools.json` (contract version 1.11.0),
fetched firsthand via the GitHub connector read route on
2026-10-27 — including the one description the spec snapshot
truncated (`get_state_history`'s `fields`: "…An array is
canonical; one comma-separated string is also accepted.",
copied verbatim). Local build only — nothing pushed or
published.

Identity: repo `perpwatch`, npm `@reneturcios/perpwatch`,
MCP name `io.github.CloudCorpRecords/perpwatch`, version
`0.1.0`, bin `perpwatch` → `dist/cli.js`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json`, `server.json` (description "Cross-exchange
  crypto perps microstructure feed: funding, liquidations,
  footprint, big trades.", 94 chars ≤100; npm entry carries
  `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/perpwatch:0.1.0` carries **no**
  `version` field), `Dockerfile` (node:20-alpine two-stage,
  label `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/perpwatch"`),
  `tsconfig.json`, `.gitignore`, `LICENSE` (MIT, Copyright (c)
  2026 Rene Turcios), `README.md` (fresh text), `CHANGELOG.md`
  (single 0.1.0 entry, 2026-10-27)
- `src/index.ts`, `src/cli.ts` (`call <tool> [json-args]`,
  `tools`, `help`, `mcp`, `--version`; exit 2 usage / 1
  runtime error), `src/mcp.ts`, `src/types.ts`,
  `src/perpwatch.ts` (core, `VERSION = "0.1.0"`)
- `test/perpwatch.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`

Plus `package-lock.json` (Route 3, below) and `parity-out/`.

Note on construction: the fixture and the `TOOLS` literal in
`src/mcp.ts` are one canonical set, generated from the
firsthand `tools.json` (descriptions contain embedded `\n`
escapes that hand-typing would corrupt). Verified after
assembly by parsing both files and deep-comparing them —
identical — and by the parity run below. The canonical
inputSchemas are the originals minus the `$schema` key (the
standing fleet rule: no `$schema` / `additionalProperties`
keys); `format` / `minimum` / `items` are preserved as
published. `help` omits `required` (empty).

## Tools implemented (11, all read-only)

- `get_market_state` — `symbol` (required)
- `get_funding_percentile` — `symbol` (required)
- `get_liquidations_recent` — `symbol` (required), `window_s`
  (integer|null)
- `get_ohlcv` — `symbol` (required), `interval`
  (string|null), `limit` (integer|null)
- `get_conditional_outcomes` — `symbol` (required),
  `funding_pct_gte`/`funding_pct_lte` (number|null),
  `streak_h_gte` (integer|null), `funding_sign` (string|null),
  `archive_feature` (string|null),
  `archive_gte`/`archive_lte`/`archive_pct_gte`/`archive_pct_lte`
  (number|null), `horizons` (array|null)
- `get_state_history` — `symbol`, `fields` (array, both
  required), `from`/`to` (string|null), `max_points`
  (integer|null)
- `get_volume_profile` — `symbol` (required), `days`
  (integer|null)
- `get_big_trades` — `symbol` (required), `from`/`to`
  (string|null), `min_usd` (integer|null), `limit`
  (integer|null)
- `get_footprint_events` — `symbol` (required), `from`/`to`
  (string|null), `kinds` (array|null), `min_usd`
  (number|null), `limit` (integer|null)
- `get_stacked_imbalances` — `symbol` (required),
  `from`/`to` (string|null), `interval` (string|null),
  `ratio` (integer|null), `kinds` (array|null), `limit`
  (integer|null)
- `help` — no arguments; served locally

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with explicit
  inputSchema literals exactly matching the fixture, per the
  standing fleet rule; zod validates every `tools/call`
  (nullable optionals as `.nullable().optional()`).
- Behaviour mirrors the original bridge: data calls forward
  as JSON-RPC `tools/call` POSTs to
  `https://api.markettrace.ai/mcp` (override:
  `MARKETTRACE_MCP_URL`) with `Authorization: Bearer
  <MARKETTRACE_BEARER>`; when the bearer is absent the call
  returns an honest error naming `MARKETTRACE_BEARER` and the
  hosted OAuth sign-in (browser → email magic link) — no data
  is fabricated and no request is made. Plain-JSON and
  SSE-framed upstream responses are both parsed; upstream
  HTTP and JSON-RPC errors surface with their status/message.
  An upstream result carrying MCP `content` blocks passes
  through untouched.
- The core validates the nine-symbol universe (BTC, ETH, SOL,
  BNB, XRP, DOGE, HYPE, ZEC, ENA; case-insensitive, `USDT`
  suffix accepted) before any fetch, and requires `fields`
  for `get_state_history`. `help` returns the local guide:
  tools grouped by question with a working example call each,
  symbols, scales, limits, and where OI / CVD / funding live.
- All HTTP goes through an injected `FetchFn`; tests use a
  fake fetch — no live network anywhere in tests.

## Verification (foreground, this run)

- `tsc --noEmit` exit 0; `tsc` build exit 0 (`dist/cli.js`)
- `tsx --test`: **13 tests, 13 pass, 0 fail** — forwarding
  shape (URL, POST, bearer header, JSON-RPC body) with result
  passthrough, `MARKETTRACE_MCP_URL` override, SSE-framed
  response parsing, upstream JSON-RPC and HTTP 502 error
  surfacing, missing-bearer honest error (names the variable
  + OAuth, zero fetches), local `help` with no bearer/fetch,
  symbol canonicalisation and out-of-set rejection, missing
  symbol, `fields` requirement, unknown tool, unreadable
  upstream body rejection
- `dist/cli.js --version` → `0.1.0`; unknown command prints
  usage and exits 2; `call get_market_state` with no bearer
  exits 1 with the honest `MARKETTRACE_BEARER` error
- Parity: `harness/parity.py` vs
  `harness/fixtures/markettrace-tools-original.json` →
  **PASS, parity 100.0, identical_tools 11/11**

## Lockfile status

`package-lock.json` generated clean via Route 3 (temp copy
with only `package.json`, offline `npm install
--package-lock-only --ignore-scripts --offline`), verified:
parses, name `@reneturcios/perpwatch`, **128 package
entries**. Local `node_modules` is a symlink to the sibling
burnmeter tree; gitignored.

## Gaps / honest notes

- **The data pipeline is upstream's.** The cross-exchange
  normalisation, coverage/freshness bookkeeping, conditional-
  outcomes statistics and the 15-minute state archive live
  behind the hosted endpoint (closed source in the original
  too); this rebuild reproduces the client contract —
  validation, forwarding, error honesty — not the pipeline.
- **Live behaviour unproven.** No bearer was available in
  this environment, so no call has been made against the
  real hosted endpoint; forwarding shape is proven only
  against the fake fetch, and SSE handling against a canned
  SSE body.
- Range/limit enforcement beyond the symbol set and the
  `fields` requirement (window sizes, `limit` bounds,
  conditional-outcome condition presence) is the upstream
  server's, whose errors forward verbatim — the same split
  as the original bridge.
- Container build not exercised locally; the
  publish-container workflow smoke-tests the image at
  publish time.
