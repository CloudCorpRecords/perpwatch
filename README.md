# perpwatch

A forwarding client for the MarketTrace perpetual-futures
microstructure feed. perpwatch exposes the feed's eleven
read-only tools as a stdio MCP server (and a small CLI): it
validates each call locally — including the nine-symbol
universe (BTC, ETH, SOL, BNB, XRP, DOGE, HYPE, ZEC, ENA,
case-insensitive with an optional `USDT` suffix) — and proxies
the call to the hosted endpoint, which aggregates Binance,
Bybit, OKX and Hyperliquid.

Tools, by the question they answer:

- **Market context** — `get_market_state` (one normalized
  snapshot: funding + percentile, OI, volume, CVD, book
  imbalance, liquidation pressure, basis), `get_funding_percentile`
- **History and base rates** — `get_conditional_outcomes`
  (measured forward returns after a stated condition;
  `history_silent` when the evidence is too thin),
  `get_state_history` (15-minute state archive series),
  `get_ohlcv` (consolidated candles)
- **Flow and footprint** — `get_liquidations_recent`,
  `get_volume_profile` (POC / value area / naked POCs),
  `get_big_trades`, `get_footprint_events` (absorbed / pulled
  book walls), `get_stacked_imbalances`
- **`help`** — the tool guide, served locally with no
  credentials: tools grouped by question, example calls,
  scales, and limits.

## Auth

The hosted endpoint uses OAuth sign-in (browser → email magic
link). Complete that sign-in and export the resulting bearer:

```bash
export MARKETTRACE_BEARER="<bearer from the hosted sign-in>"
```

Without it, data calls fail with an error naming
`MARKETTRACE_BEARER` and the sign-in — no data is fabricated.
The endpoint defaults to `https://api.markettrace.ai/mcp`;
override it with `MARKETTRACE_MCP_URL`. Market data is
informational only, not financial advice.

## CLI

```bash
npx @reneturcios/perpwatch tools
npx @reneturcios/perpwatch help
npx @reneturcios/perpwatch call get_market_state '{"symbol":"BTC"}'
npx @reneturcios/perpwatch --version
```

Exit codes: `0` success, `1` runtime error (including a
missing bearer or an upstream error), `2` usage error.

## MCP server

```bash
npx -y @reneturcios/perpwatch mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "perpwatch": {
      "command": "npx",
      "args": ["-y", "@reneturcios/perpwatch", "mcp"],
      "env": { "MARKETTRACE_BEARER": "<bearer from the hosted sign-in>" }
    }
  }
}
```

## Docker

```bash
docker run -i -e MARKETTRACE_BEARER="<bearer>" ghcr.io/cloudcorprecords/perpwatch
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (fake fetch, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
