/**
 * perpwatch core: a forwarding client for the hosted MarketTrace
 * perpetual-futures microstructure feed.
 *
 *   callMarketTool(name, args, config, fetchFn) -> upstream result
 *
 * All eleven tools are read-only market data. Ten of them proxy
 * to the hosted MCP endpoint (default
 * https://api.markettrace.ai/mcp, overridable with the
 * MARKETTRACE_MCP_URL environment variable) as JSON-RPC
 * `tools/call` requests carrying `Authorization: Bearer
 * <MARKETTRACE_BEARER>`. The hosted endpoint is OAuth-protected
 * (browser → email magic link sign-in), so there is no API key
 * to mint locally: when MARKETTRACE_BEARER is absent a call
 * fails honestly, naming the variable and the hosted sign-in,
 * instead of fabricating data — the same behaviour as the
 * original stdio bridge. The `help` tool is the exception: it is
 * served locally from the documented guide and needs no bearer.
 *
 * The data pipeline behind the endpoint (cross-exchange
 * normalisation across Binance, Bybit, OKX and Hyperliquid,
 * coverage/freshness bookkeeping, the 15-minute state archive)
 * is the upstream operator's; this core reproduces the client
 * contract: argument validation (including the nine-symbol
 * universe), forwarding, and faithful surfacing of upstream
 * HTTP / JSON-RPC errors. All HTTP goes through an injected
 * FetchFn so everything is testable offline.
 */
import type { FetchFn, PerpwatchConfig } from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_MCP_URL = "https://api.markettrace.ai/mcp";
export const MCP_URL_ENV = "MARKETTRACE_MCP_URL";
export const BEARER_ENV = "MARKETTRACE_BEARER";

/** The nine assets the feed covers. */
export const SYMBOLS = [
  "BTC",
  "ETH",
  "SOL",
  "BNB",
  "XRP",
  "DOGE",
  "HYPE",
  "ZEC",
  "ENA",
] as const;

export const TOOL_NAMES = [
  "get_market_state",
  "get_funding_percentile",
  "get_liquidations_recent",
  "get_ohlcv",
  "get_conditional_outcomes",
  "get_state_history",
  "get_volume_profile",
  "get_big_trades",
  "get_footprint_events",
  "get_stacked_imbalances",
  "help",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/**
 * The local guide served by the `help` tool: every tool grouped
 * by the question it answers, with a working example call for
 * each, the supported symbols, how to read the scales, request
 * limits, and where data without its own tool lives.
 */
export const HELP_TEXT = `perpwatch — MarketTrace perpetual-futures microstructure feed (read-only)

Symbols: BTC, ETH, SOL, BNB, XRP, DOGE, HYPE, ZEC, ENA (case-insensitive;
a USDT suffix such as BTCUSDT is accepted). Venues: Binance, Bybit, OKX
and Hyperliquid (liquidations cover Binance, Bybit and OKX only).
Informational market data only — not financial advice.

MARKET CONTEXT
- get_market_state {symbol} — one normalized snapshot: funding with its
  2y percentile, open interest, volume, CVD aggression, order-book
  imbalance, recent liquidation pressure, basis, key drivers.
  Example: get_market_state {"symbol":"BTC"}
- get_funding_percentile {symbol} — current funding rate ranked against
  its own multi-year history (percentile 0-100).
  Example: get_funding_percentile {"symbol":"ETH"}

HISTORY AND BASE RATES
- get_conditional_outcomes {symbol, ...} — measured forward returns
  after a stated condition (funding percentile / streak / sign and/or
  one archived state feature). At least one condition is required;
  verdict history_silent means too few matches to measure.
  Example: get_conditional_outcomes {"symbol":"BTC","funding_pct_gte":90}
- get_state_history {symbol, fields, from?, to?, max_points?} — time
  series of dotted market-state fields from the 15-minute archive
  (1..16 fields per request).
  Example: get_state_history {"symbol":"SOL","fields":["funding.percentile","oi.usd"]}
- get_ohlcv {symbol, interval?, limit?} — consolidated candles;
  intervals 5m, 15m, 1h, 4h, 1d (default 1h), limit 1..200 (default 100).
  Example: get_ohlcv {"symbol":"BTC","interval":"1h","limit":24}

FLOW AND FOOTPRINT
- get_liquidations_recent {symbol, window_s?} — liquidation notional
  estimates for a look-back window (default 3600s, max 86400s).
  Example: get_liquidations_recent {"symbol":"ETH","window_s":3600}
- get_volume_profile {symbol, days?} — POC / value-area levels per UTC
  day plus a composite and naked POCs (days 1..30, default 7).
  Example: get_volume_profile {"symbol":"BTC","days":7}
- get_big_trades {symbol, from?, to?, min_usd?, limit?} — large
  aggressive orders; window at most 12h, limit 1..150 (default 50).
  Example: get_big_trades {"symbol":"BTC","min_usd":1000000}
- get_footprint_events {symbol, from?, to?, kinds?, min_usd?, limit?} —
  absorbed / pulled order-book wall events; window at most 24h.
  Example: get_footprint_events {"symbol":"BTC","kinds":["absorbed"]}
- get_stacked_imbalances {symbol, from?, to?, interval?, ratio?,
  kinds?, limit?} — stacked diagonal buy/sell imbalances; ratio 2, 3
  or 4 (default 3), window at most 12h.
  Example: get_stacked_imbalances {"symbol":"BTC","ratio":3}

READING THE SCALES
Ratios are 0..1; percentiles are 0-100; rel.* fields are multipliers of
the trailing median; obi.skew is -1..+1 (positive = bid-heavy);
cvd.delta_usd positive = net taker buying; basis_bps positive = perp
above spot index; funding rate_bps positive = longs pay shorts. Every
metric carries a coverage entry (venues, window depth, freshness) —
weight confidence by it. Out-of-range windows and limits are errors,
not clamps.

DATA WITHOUT ITS OWN TOOL
Open interest, CVD and the funding rate itself live inside
get_market_state (and as fields of get_state_history); there is no
separate endpoint for them.

AUTH
Data calls proxy to the hosted endpoint, which uses OAuth sign-in
(browser → email magic link). Set MARKETTRACE_BEARER to the bearer
from that sign-in; without it, data calls return an error naming the
variable instead of data.`;

/** Build a config from environment-style values. */
export function resolveConfig(env: {
  [MCP_URL_ENV]?: string;
  [BEARER_ENV]?: string;
}): PerpwatchConfig {
  const urlRaw = typeof env[MCP_URL_ENV] === "string" ? env[MCP_URL_ENV].trim() : "";
  const bearerRaw = typeof env[BEARER_ENV] === "string" ? env[BEARER_ENV].trim() : "";
  return {
    mcpUrl: urlRaw ? urlRaw : DEFAULT_MCP_URL,
    bearer: bearerRaw ? bearerRaw : undefined,
  };
}

/**
 * Validate a symbol argument against the nine-asset universe and
 * return its canonical base form (upper-case, USDT suffix
 * stripped). Anything else is an error naming the parameter and
 * the supported set.
 */
export function normalizeSymbol(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("symbol is required and must be a string");
  }
  let s = value.trim().toUpperCase();
  if (s.endsWith("USDT")) s = s.slice(0, -4);
  if (!(SYMBOLS as readonly string[]).includes(s)) {
    throw new Error(
      `symbol must be one of ${SYMBOLS.join(", ")} (case-insensitive; a USDT suffix is accepted); got '${value}'`,
    );
  }
  return s;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The local guide text served by the `help` tool. */
export function getHelp(): string {
  return HELP_TEXT;
}

/**
 * Extract the JSON-RPC response object from an upstream body.
 * The hosted endpoint speaks Streamable HTTP, so a body may be a
 * plain JSON document or an SSE stream whose `data:` lines carry
 * the JSON-RPC messages; the last data line wins.
 */
export function parseRpcResponse(body: string): Record<string, unknown> {
  const trimmed = body.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isRecord(parsed)) return parsed;
  } catch {
    // fall through to SSE scanning
  }
  let last: Record<string, unknown> | undefined;
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    try {
      const parsed: unknown = JSON.parse(line.slice(5).trim());
      if (isRecord(parsed)) last = parsed;
    } catch {
      // not a JSON data line; keep scanning
    }
  }
  if (last) return last;
  throw new Error(`MarketTrace upstream returned an unreadable response body: ${trimmed.slice(0, 200)}`);
}

/**
 * Call one tool. `help` is answered locally; every other tool is
 * validated (symbol universe; `fields` for get_state_history) and
 * forwarded to the hosted endpoint as a JSON-RPC tools/call.
 * Returns the upstream `result` payload unchanged.
 */
export async function callMarketTool(
  name: string,
  args: Record<string, unknown> | undefined,
  config: PerpwatchConfig,
  fetchFn: FetchFn,
): Promise<unknown> {
  if (!(TOOL_NAMES as readonly string[]).includes(name)) {
    throw new Error(`Unknown tool: ${name}`);
  }
  if (name === "help") return HELP_TEXT;

  const a = args ?? {};
  normalizeSymbol(a.symbol);
  if (name === "get_state_history") {
    if (!Array.isArray(a.fields) || a.fields.length === 0) {
      throw new Error("fields is required for get_state_history and must be a non-empty array of dotted field paths");
    }
  }

  if (!config.bearer) {
    throw new Error(
      `${BEARER_ENV} is not set: the hosted MarketTrace endpoint at ${config.mcpUrl} requires ` +
        `OAuth sign-in (browser -> email magic link on the same device/browser). Complete that ` +
        `sign-in, export ${BEARER_ENV} with the resulting bearer, and retry. No data was fetched.`,
    );
  }

  const res = await fetchFn(config.mcpUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${config.bearer}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: a },
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`MarketTrace upstream returned HTTP ${res.status}: ${body.trim().slice(0, 200)}`);
  }
  const rpc = parseRpcResponse(body);
  if (isRecord(rpc.error)) {
    const message = typeof rpc.error.message === "string" ? rpc.error.message : JSON.stringify(rpc.error);
    throw new Error(`MarketTrace upstream error: ${message}`);
  }
  if (!("result" in rpc)) {
    throw new Error("MarketTrace upstream response carried neither a result nor an error");
  }
  return rpc.result;
}

/** Render a payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}
