import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  callMarketTool,
  normalizeSymbol,
  parseRpcResponse,
  resolveConfig,
} from "../src/perpwatch.js";
import type { FetchFn, FetchInit, PerpwatchConfig } from "../src/types.js";

/**
 * All tests run offline against a fake fetch that records its
 * calls and returns canned JSON-RPC responses. No live network.
 */

interface Recorded {
  url: string;
  init: FetchInit;
}

function fakeFetch(responseBody: string, status = 200) {
  const calls: Recorded[] = [];
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => responseBody };
  };
  return { fn, calls };
}

function rpcResult(result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, result });
}

const WITH_BEARER: PerpwatchConfig = {
  mcpUrl: "https://api.markettrace.ai/mcp",
  bearer: "test-bearer",
};
const NO_BEARER: PerpwatchConfig = { mcpUrl: "https://api.markettrace.ai/mcp" };

describe("callMarketTool — forwarding", () => {
  it("POSTs a JSON-RPC tools/call with the bearer and returns the result", async () => {
    const payload = { content: [{ type: "text", text: "snapshot" }] };
    const { fn, calls } = fakeFetch(rpcResult(payload));
    const out = await callMarketTool("get_market_state", { symbol: "BTC" }, WITH_BEARER, fn);
    assert.deepEqual(out, payload);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.markettrace.ai/mcp");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers.authorization, "Bearer test-bearer");
    const body = JSON.parse(calls[0].init.body) as {
      method: string;
      params: { name: string; arguments: unknown };
    };
    assert.equal(body.method, "tools/call");
    assert.equal(body.params.name, "get_market_state");
    assert.deepEqual(body.params.arguments, { symbol: "BTC" });
  });

  it("honours the MARKETTRACE_MCP_URL override via resolveConfig", async () => {
    const cfg = resolveConfig({
      MARKETTRACE_MCP_URL: "https://example.test/feed",
      MARKETTRACE_BEARER: "tok",
    });
    const { fn, calls } = fakeFetch(rpcResult({ ok: true }));
    await callMarketTool("get_funding_percentile", { symbol: "ETH" }, cfg, fn);
    assert.equal(calls[0].url, "https://example.test/feed");
    assert.equal(calls[0].init.headers.authorization, "Bearer tok");
  });

  it("parses an SSE-framed upstream response", async () => {
    const sse = `event: message\ndata: ${rpcResult({ content: [{ type: "text", text: "sse" }] })}\n\n`;
    const { fn } = fakeFetch(sse);
    const out = (await callMarketTool("get_ohlcv", { symbol: "SOL" }, WITH_BEARER, fn)) as {
      content: { text: string }[];
    };
    assert.equal(out.content[0].text, "sse");
  });

  it("surfaces an upstream JSON-RPC error by message", async () => {
    const { fn } = fakeFetch(
      JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: "window too long" } }),
    );
    await assert.rejects(
      () => callMarketTool("get_big_trades", { symbol: "BTC" }, WITH_BEARER, fn),
      /window too long/,
    );
  });

  it("surfaces an upstream HTTP error with its status", async () => {
    const { fn } = fakeFetch("upstream exploded", 502);
    await assert.rejects(
      () => callMarketTool("get_market_state", { symbol: "BTC" }, WITH_BEARER, fn),
      /HTTP 502/,
    );
  });
});

describe("callMarketTool — missing bearer", () => {
  it("errors honestly, naming MARKETTRACE_BEARER and the OAuth sign-in, without fetching", async () => {
    const { fn, calls } = fakeFetch(rpcResult({}));
    await assert.rejects(
      () => callMarketTool("get_market_state", { symbol: "BTC" }, NO_BEARER, fn),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        assert.match(msg, /MARKETTRACE_BEARER/);
        assert.match(msg, /OAuth/);
        return true;
      },
    );
    assert.equal(calls.length, 0);
  });
});

describe("help — served locally", () => {
  it("returns the guide with no bearer and no fetch", async () => {
    const { fn, calls } = fakeFetch(rpcResult({}));
    const out = (await callMarketTool("help", {}, NO_BEARER, fn)) as string;
    assert.match(out, /get_market_state/);
    assert.match(out, /get_stacked_imbalances/);
    assert.match(out, /BTC, ETH, SOL/);
    assert.equal(calls.length, 0);
  });
});

describe("validation", () => {
  it("normalizeSymbol canonicalises case and a USDT suffix", () => {
    assert.equal(normalizeSymbol("btc"), "BTC");
    assert.equal(normalizeSymbol("EthUSDT"), "ETH");
    assert.equal(normalizeSymbol(" hype "), "HYPE");
  });

  it("rejects a symbol outside the nine-asset set, naming the set", async () => {
    const { fn, calls } = fakeFetch(rpcResult({}));
    assert.throws(() => normalizeSymbol("ADA"), /BTC, ETH, SOL/);
    await assert.rejects(
      () => callMarketTool("get_market_state", { symbol: "ADA" }, WITH_BEARER, fn),
      /symbol must be one of/,
    );
    assert.equal(calls.length, 0);
  });

  it("rejects a missing symbol before any fetch", async () => {
    const { fn, calls } = fakeFetch(rpcResult({}));
    await assert.rejects(
      () => callMarketTool("get_volume_profile", {}, WITH_BEARER, fn),
      /symbol is required/,
    );
    assert.equal(calls.length, 0);
  });

  it("requires fields for get_state_history", async () => {
    const { fn, calls } = fakeFetch(rpcResult({}));
    await assert.rejects(
      () => callMarketTool("get_state_history", { symbol: "BTC" }, WITH_BEARER, fn),
      /fields is required/,
    );
    assert.equal(calls.length, 0);
  });

  it("rejects an unknown tool name", async () => {
    const { fn } = fakeFetch(rpcResult({}));
    await assert.rejects(
      () => callMarketTool("get_order_book", { symbol: "BTC" }, WITH_BEARER, fn),
      /Unknown tool/,
    );
  });
});

describe("parseRpcResponse", () => {
  it("rejects an unreadable body instead of fabricating a result", () => {
    assert.throws(() => parseRpcResponse("<html>nope</html>"), /unreadable response/);
  });
});
