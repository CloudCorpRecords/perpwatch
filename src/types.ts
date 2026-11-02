/**
 * perpwatch types.
 *
 * perpwatch is a forwarding client for the hosted MarketTrace
 * perpetual-futures microstructure feed. Every data tool takes a
 * symbol from a fixed nine-asset universe (BTC, ETH, SOL, BNB,
 * XRP, DOGE, HYPE, ZEC, ENA) plus tool-specific options, and the
 * call is proxied to the hosted MCP endpoint over Streamable
 * HTTP. The transport is an injected FetchFn so the whole core
 * is testable offline with a fake fetch — no live network in
 * tests.
 */

/** The minimal slice of a fetch Response the core relies on. */
export interface FetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** The request init the core sends: a JSON-RPC POST with headers. */
export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** Injectable fetch: same call shape as the global fetch, narrowed. */
export type FetchFn = (url: string, init: FetchInit) => Promise<FetchResponse>;

/** Resolved client configuration. */
export interface PerpwatchConfig {
  /** Hosted MCP endpoint URL. */
  mcpUrl: string;
  /** Bearer token for the hosted endpoint, when one is configured. */
  bearer?: string;
}
