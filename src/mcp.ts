/**
 * perpwatch MCP server. Tools: get_market_state,
 * get_funding_percentile, get_liquidations_recent, get_ohlcv,
 * get_conditional_outcomes, get_state_history,
 * get_volume_profile, get_big_trades, get_footprint_events,
 * get_stacked_imbalances, help.
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts zod schemas to JSON Schema and injects keys
 * not in this tool's defined spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the
 * spec's exact input schemas as explicit literals, while zod
 * still validates every tools/call argument set.
 *
 * Configuration is read from the environment at call time:
 * MARKETTRACE_BEARER (the bearer from the hosted OAuth sign-in;
 * data calls error honestly without it) and MARKETTRACE_MCP_URL
 * (endpoint override, default https://api.markettrace.ai/mcp).
 * The `help` tool is served locally and needs neither.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  callMarketTool,
  formatPayload,
  resolveConfig,
  VERSION,
} from "./perpwatch.js";
import type { FetchFn } from "./types.js";

const defaultFetch: FetchFn = async (url, init) => fetch(url, init);

const SymbolArg = z.string();
const OptString = z.string().nullable().optional();
const OptInt = z.number().int().nullable().optional();
const OptNumber = z.number().nullable().optional();
const OptStringArray = z.array(z.string()).nullable().optional();

const SymbolOnlyArgs = z.object({ symbol: SymbolArg });
const LiquidationsArgs = z.object({ symbol: SymbolArg, window_s: OptInt });
const OhlcvArgs = z.object({
  symbol: SymbolArg,
  interval: OptString,
  limit: OptInt,
});
const ConditionalArgs = z.object({
  symbol: SymbolArg,
  funding_pct_gte: OptNumber,
  funding_pct_lte: OptNumber,
  streak_h_gte: OptInt,
  funding_sign: OptString,
  archive_feature: OptString,
  archive_gte: OptNumber,
  archive_lte: OptNumber,
  archive_pct_gte: OptNumber,
  archive_pct_lte: OptNumber,
  horizons: OptStringArray,
});
const StateHistoryArgs = z.object({
  symbol: SymbolArg,
  fields: z.array(z.string()),
  from: OptString,
  to: OptString,
  max_points: OptInt,
});
const VolumeProfileArgs = z.object({ symbol: SymbolArg, days: OptInt });
const BigTradesArgs = z.object({
  symbol: SymbolArg,
  from: OptString,
  to: OptString,
  min_usd: OptInt,
  limit: OptInt,
});
const FootprintArgs = z.object({
  symbol: SymbolArg,
  from: OptString,
  to: OptString,
  kinds: OptStringArray,
  min_usd: OptNumber,
  limit: OptInt,
});
const StackedArgs = z.object({
  symbol: SymbolArg,
  from: OptString,
  to: OptString,
  interval: OptString,
  ratio: OptInt,
  kinds: OptStringArray,
  limit: OptInt,
});
const NoArgs = z.object({});

const ARG_SCHEMAS: Record<string, z.ZodTypeAny> = {
  get_market_state: SymbolOnlyArgs,
  get_funding_percentile: SymbolOnlyArgs,
  get_liquidations_recent: LiquidationsArgs,
  get_ohlcv: OhlcvArgs,
  get_conditional_outcomes: ConditionalArgs,
  get_state_history: StateHistoryArgs,
  get_volume_profile: VolumeProfileArgs,
  get_big_trades: BigTradesArgs,
  get_footprint_events: FootprintArgs,
  get_stacked_imbalances: StackedArgs,
  help: NoArgs,
};

type ToolDef = {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

const TOOLS = [
  {
    "name": "get_market_state",
    "description": "Single normalized perpetual-futures microstructure snapshot for one crypto symbol, aggregated across Binance, Bybit, OKX and Hyperliquid. Answers: \"What's the market state for BTC?\", \"Is ETH positioning stretched?\". Covers BTC, ETH, SOL, BNB, XRP, DOGE, HYPE, ZEC, ENA. Returns funding+2y-percentile, OI, volume, CVD aggression, order-book imbalance, recent liquidation pressure, basis, and key drivers. Scales: *_ratio fields are 0..1, percentiles are 0-100, rel.* are multipliers of the trailing median (1.4 = 140%), obi.skew is -1..+1 (positive = bid-heavy), cvd.delta_usd positive = net taker buying, basis_bps positive = perp above spot index. Every metric carries a coverage entry (venues, window depth, partial reason) — weight confidence by it. Read-only, ~30s fresh. Use first for market context; for the historical base rate of a condition you observe here (e.g. funding percentile ≥ 90), follow with get_conditional_outcomes. For volume-profile levels (POC, value area, naked POCs) use get_volume_profile; for large aggressive orders use get_big_trades. For absorbed or pulled order-book walls use get_footprint_events. For stacked buy or sell imbalances in the footprint use get_stacked_imbalances.",
    "inputSchema": {
      "properties": {
        "symbol": {
          "description": "Asset symbol: BTC, ETH, SOL, BNB, XRP, DOGE, HYPE, ZEC or ENA (case-insensitive; a\n`USDT` suffix is accepted, e.g. `BTCUSDT`).",
          "type": "string"
        }
      },
      "required": [
        "symbol"
      ],
      "type": "object"
    }
  },
  {
    "name": "get_funding_percentile",
    "description": "Current perpetual funding rate for a symbol, ranked vs its own multi-year history as a percentile (0-100). Answers: \"Is BTC funding unusually high?\", \"What percentile is ETH funding at?\". Returns rate_bps (basis points, 8h-normalized, cross-venue; positive = longs pay shorts), percentile (0-100), streak_h (hours the rate has kept its sign), and the coverage (venues + history depth backing the rank). Read-only.",
    "inputSchema": {
      "properties": {
        "symbol": {
          "description": "Asset symbol: BTC, ETH, SOL, BNB, XRP, DOGE, HYPE, ZEC or ENA (case-insensitive; a\n`USDT` suffix is accepted, e.g. `BTCUSDT`).",
          "type": "string"
        }
      },
      "required": [
        "symbol"
      ],
      "type": "object"
    }
  },
  {
    "name": "get_liquidations_recent",
    "description": "Recent cross-exchange liquidation notional estimates for a symbol. Answers: \"How much got liquidated on ETH in the last hour?\", \"Mostly longs or shorts?\". Covers Binance, Bybit, OKX (not Hyperliquid). USD values are base quantity multiplied by each venue's source reference price; Bybit/OKX expose bankruptcy price, so these are estimates rather than execution notionals. Returns whole-dollar estimates, long_ratio (0..1 share of LONGS liquidated), notional_semantics, and event count for the window (window_s, default 3600, max 86400). Read-only.",
    "inputSchema": {
      "properties": {
        "symbol": {
          "description": "Asset symbol: BTC, ETH, SOL, BNB, XRP, DOGE, HYPE, ZEC or ENA (case-insensitive; a\n`USDT` suffix is accepted).",
          "type": "string"
        },
        "window_s": {
          "description": "Look-back window in seconds, 1..=86400 (default 3600). Values beyond\n24 h are rejected, not clamped.",
          "format": "int64",
          "type": [
            "integer",
            "null"
          ]
        }
      },
      "required": [
        "symbol"
      ],
      "type": "object"
    }
  },
  {
    "name": "get_ohlcv",
    "description": "Consolidated cross-exchange OHLCV candles for a symbol (all four venues' trades merged onto one timeline). Answers: \"Show me BTC 1h candles\", \"What's the 24h range?\". Use for stop placement, position sizing (ATR), R:R and realized-volatility math — the exact-candle complement to get_market_state's approximate price block. Intervals: 5m, 15m, 1h, 4h, 1d (default 1h); limit 1..=200 candles (default 100), oldest first. The consolidated tape holds 31 days, so limit × interval must fit inside it: 1d ≤ 31, 4h ≤ 186, 1h and finer reach the full 200 — beyond that is an error, not a clamp. ZEC and ENA keep a 14-day tape that started filling when they were added, so their longer windows return fewer candles than asked — count what comes back. The NEWEST candle may be partial:true (bucket still forming) — exclude it from ATR/RV math. Fields: t = bucket open epoch ms, o/h/l/c = USD, v = traded volume in BASE units (BTC, ETH, ...), NOT USD — multiply by price for approximate notional. delta = taker-buy minus taker-sell volume inside the candle, BASE units like v (positive = net aggressive buying); the running sum of delta over the returned candles is the CVD of that window. Read-only.",
    "inputSchema": {
      "properties": {
        "interval": {
          "description": "Candle interval: 5m, 15m, 1h, 4h or 1d (default 1h).",
          "type": [
            "string",
            "null"
          ]
        },
        "limit": {
          "description": "Number of candles, newest last: 1..=200 (default 100).",
          "format": "uint32",
          "minimum": 0,
          "type": [
            "integer",
            "null"
          ]
        },
        "symbol": {
          "description": "Asset symbol: BTC, ETH, SOL, BNB, XRP, DOGE, HYPE, ZEC or ENA (case-insensitive; a\n`USDT` suffix is accepted).",
          "type": "string"
        }
      },
      "required": [
        "symbol"
      ],
      "type": "object"
    }
  },
  {
    "name": "get_conditional_outcomes",
    "description": "Measured HISTORY of forward returns after a stated condition — the base rate from this feed's own data, replacing folklore like \"high funding = squeeze\". Answers: \"What happened historically after funding above the 90th percentile?\", \"When OBI stayed bid-heavy while funding was positive, what did the next 24h look like?\". Condition fields AND together (state at least one). Funding (multi-year series): funding_pct_gte/lte (AS-OF percentile 0..100 — the rank the live endpoint showed at that moment, no look-ahead), streak_h_gte (hours funding kept its sign), funding_sign (positive|negative). Archive (v2, 15-min state archive — YOUNG series, growing daily): archive_feature ∈ obi_skew (−1..+1) | oi_chg_1h_pct (%) | taker_buy_ratio (0..1) | basis_bps, with archive_gte/lte (raw value, no sample floor) and archive_pct_gte/lte (as-of percentile). An archive condition shrinks the match window to the INTERSECTION of the series' spans — the response window and coverage.archive.{window_days,n_samples} disclose exactly how thin the evidence is; weight accordingly. horizons: [\"4h\",\"24h\",\"72h\"] default, each 1h..168h. Per horizon: n_matches (raw), n_effective (overlap-collapsed — overlapping forward windows are NOT independent samples; all stats use the collapsed set), median/p10/p90 forward return in PERCENT, hit_rate_up (RATIO 0..1), max_dd_median_pct (median worst drawdown before the horizon resolves, ≤0). verdict=history_silent means the condition matched too rarely to measure (n_effective<12 on every horizon): a first-class answer — you are trading on belief, size accordingly; stats are null, never noise. warnings flag overlap collapse, 14-day clustering and silenced horizons. matches_sample = up to 50 audit timestamps. current = where the LAST hour of the same series sits on the condition axes (funding_pct as-of percentile, null below the floor; streak_h; sign) — read the band it falls in, then ask about that band; null only when there is no funding series. Percentile-form conditions exist only once the ranked series has coverage.warmup_samples (12) points — a STRUCTURAL floor (a rank among 2 points is degenerate), not a maturity gate; nothing time-based is withheld. Prices: Binance 1h closes (coverage.price_src). REPORTS HISTORY, NOT PREDICTIONS — past conditional distributions do not imply future returns. Read-only.",
    "inputSchema": {
      "properties": {
        "archive_feature": {
          "description": "v2: condition on ONE archived state feature (15-min archive):\n`obi_skew` (−1..+1), `oi_chg_1h_pct` (%), `taker_buy_ratio` (0..1),\n`basis_bps`. ANDs with the funding fields; the match window becomes\nthe INTERSECTION of the constrained series' spans. Needs at least one\narchive threshold below.",
          "type": [
            "string",
            "null"
          ]
        },
        "archive_gte": {
          "description": "Match hours where the archive feature's RAW value ≥ this (raw\nthresholds have no sample floor — they exist from the first point).",
          "format": "double",
          "type": [
            "number",
            "null"
          ]
        },
        "archive_lte": {
          "description": "Match hours where the archive feature's RAW value ≤ this.",
          "format": "double",
          "type": [
            "number",
            "null"
          ]
        },
        "archive_pct_gte": {
          "description": "Match hours where the feature's AS-OF percentile ≥ this (0..=100; the\nrank exists only once its series has warmup_samples points).",
          "format": "double",
          "type": [
            "number",
            "null"
          ]
        },
        "archive_pct_lte": {
          "description": "Match hours where the feature's as-of percentile ≤ this (0..=100).",
          "format": "double",
          "type": [
            "number",
            "null"
          ]
        },
        "funding_pct_gte": {
          "description": "Match hours where the AS-OF funding percentile was ≥ this (0..=100).\n\"As-of\" = the rank the live endpoint reported at that moment — computed\nonly from data available then, no look-ahead.",
          "format": "double",
          "type": [
            "number",
            "null"
          ]
        },
        "funding_pct_lte": {
          "description": "Match hours where the as-of funding percentile was ≤ this (0..=100).",
          "format": "double",
          "type": [
            "number",
            "null"
          ]
        },
        "funding_sign": {
          "description": "Funding sign filter: `positive` (longs pay shorts) or `negative`.",
          "type": [
            "string",
            "null"
          ]
        },
        "horizons": {
          "description": "Forward horizons as `<hours>h` labels, each 1h..=168h\n(default `[\"4h\",\"24h\",\"72h\"]`).",
          "items": {
            "type": "string"
          },
          "type": [
            "array",
            "null"
          ]
        },
        "streak_h_gte": {
          "description": "Match hours where funding had kept its sign for at least this many hours.",
          "format": "int64",
          "type": [
            "integer",
            "null"
          ]
        },
        "symbol": {
          "description": "Asset symbol: BTC, ETH, SOL, BNB, XRP, DOGE, HYPE, ZEC or ENA (case-insensitive; a\n`USDT` suffix is accepted).",
          "type": "string"
        }
      },
      "required": [
        "symbol"
      ],
      "type": "object"
    }
  },
  {
    "name": "get_state_history",
    "description": "Time series of any numeric market-state fields from the 15-minute full-state archive — the derivative/trend view get_market_state cannot give. Answers: \"How did OI build over the last 3 days?\", \"Is funding percentile rising or falling this week?\", \"When did the book skew flip?\". fields = dotted numeric paths of get_market_state (1..=16), e.g. funding.percentile, oi.usd, obi.skew, cvd.delta_usd, basis_bps, price.last, depth.bid_usd.10bps, venues.binance.oi_usd. Returns parallel arrays: t (epoch ms, ascending) + series[field] aligned with t; null = that field was not populated in the archived row (honest hole, common near the archive's start — blocks accrue at their own pace). Downsampling: max_points 1..=1000 (default 200); stride in the response says how many 15-min rows each point skips; the newest row is never sampled away. coverage.archive_from/to are the WHOLE archive's bounds — the archive is YOUNG (born 2026-07-03) and grows a row per 15 min per asset; a thin answer is honest, not broken. from/to accept RFC3339, YYYY-MM-DD or epoch ms. Read-only.",
    "inputSchema": {
      "properties": {
        "fields": {
          "description": "Dotted numeric paths of the market state, 1..=16 per request — e.g.\n`funding.percentile`, `oi.usd`, `obi.skew`, `cvd.delta_usd`,\n`basis_bps`, `price.last`, `depth.bid_usd.10bps`,\n`venues.binance.oi_usd`. Typos get an error naming the offender.\nAn array is canonical; one comma-separated string is also accepted.",
          "items": {
            "type": "string"
          },
          "type": "array"
        },
        "from": {
          "description": "Range start: RFC3339 (`2026-07-03T08:00:00Z`), `YYYY-MM-DD` (UTC\nmidnight), or epoch milliseconds. Default: the whole archive.",
          "type": [
            "string",
            "null"
          ]
        },
        "max_points": {
          "description": "Points returned after downsampling, 1..=1000 (default 200). The\nresponse's `stride` says how many archived rows each point skips.",
          "format": "uint64",
          "minimum": 0,
          "type": [
            "integer",
            "null"
          ]
        },
        "symbol": {
          "description": "Asset symbol: BTC, ETH, SOL, BNB, XRP, DOGE, HYPE, ZEC or ENA (case-insensitive; a\n`USDT` suffix is accepted).",
          "type": "string"
        },
        "to": {
          "description": "Range end, same formats. Default: the whole archive.",
          "type": [
            "string",
            "null"
          ]
        }
      },
      "required": [
        "symbol",
        "fields"
      ],
      "type": "object"
    }
  },
  {
    "name": "get_volume_profile",
    "description": "Volume-profile reference levels for a symbol, from the consolidated trade tape of Binance, Bybit, OKX and Hyperliquid. Answers: \"Where are the key volume levels on BTC?\", \"Is price inside yesterday's value area?\", \"Any untested POCs nearby?\". Sessions are UTC days. poc = price row with the most traded volume; vah/val = top and bottom of the value area, the band around the POC that holds 70% of the session's volume. Returns today (the session still forming, developing:true, its levels still move), days (the last N complete days, days 1..=30, default 7, oldest first), composite (one profile over those days plus today) and naked_pocs (POCs of the last 30 complete days that price has not traded back to since). Per profile: poc/vah/val in USD (lower edge of a `bucket`-wide price row), va_width_pct = (vah − val) / poc × 100, volume in BASE units (BTC, ETH, ...), taker_buy_ratio 0..1 (share of volume that was aggressive buying). va_width_rank.percentile (0-100) ranks the latest complete day's va_width_pct among the last n_days complete days: low = an unusually tight day; null below 12 days. Levels only, no histogram. For where price sits against these levels read price.last from get_market_state. ZEC and ENA were added later, so fewer days come back for them: count what is returned and read coverage. Read-only.",
    "inputSchema": {
      "properties": {
        "days": {
          "description": "Complete UTC days to return, 1..=30 (default 7). Out of range is an\nerror, not a clamp.",
          "format": "int64",
          "type": [
            "integer",
            "null"
          ]
        },
        "symbol": {
          "description": "Asset symbol: BTC, ETH, SOL, BNB, XRP, DOGE, HYPE, ZEC or ENA (case-insensitive; a\n`USDT` suffix is accepted).",
          "type": "string"
        }
      },
      "required": [
        "symbol"
      ],
      "type": "object"
    }
  },
  {
    "name": "get_big_trades",
    "description": "Large aggressive orders (\"big trades\") from the trade tape of Binance, Bybit, OKX and Hyperliquid for a symbol. Answers: \"Any whale market orders on BTC in the last hour?\", \"Were the big prints buying or selling?\", \"Which venue took the largest hit?\". One big trade = all fills that share venue, taker side and exchange timestamp: a market order sweeping several price levels prints as many fills at one instant, and they are summed back into one trade. aggressor: buy = the taker bought, sell = the taker sold. Per trade: t = exchange timestamp, epoch ms; venue; price = volume-weighted fill price, USD; usd = notional, whole dollars. min_usd = smallest notional that counts, at least 50000; default = the asset's threshold on the MarketTrace chart (BTC and ETH 1000000; SOL, BNB, XRP, DOGE and HYPE 500000; ZEC and ENA 100000); the response echoes the value used. totals = count (n) and summed usd of every trade at or above min_usd in the window, per side. trades = at most limit of them (1..=150, default 50): when there are more, the LARGEST are kept and truncated=true; the list is ordered by time. Window: from/to as RFC3339, YYYY-MM-DD or epoch ms; default the last hour; at most 12 h per call and from no older than 31 days, beyond either is an error, not a clamp. settled=false means the window reaches into the last 3 minutes, which the tape may not hold in full yet. coverage.venues lists the venues with tape in the window; an empty list means no tape there, not no trades (ZEC and ENA keep a 14-day tape). An order the trader split into separate child orders shows up as separate smaller trades. Descriptive: a big trade is executed flow, not a signal. Read-only.",
    "inputSchema": {
      "properties": {
        "from": {
          "description": "Window start: RFC3339, `YYYY-MM-DD` (UTC midnight) or epoch ms.\nDefault: `to` minus one hour. No older than 31 days.",
          "type": [
            "string",
            "null"
          ]
        },
        "limit": {
          "description": "Trades listed, 1..=150 (default 50); the largest are kept.",
          "format": "uint32",
          "minimum": 0,
          "type": [
            "integer",
            "null"
          ]
        },
        "min_usd": {
          "description": "Smallest notional that counts, whole USD, at least 50000. Default:\nthe asset's chart threshold (echoed in the response).\n\nRead as any JSON value and checked in [`big_trades_query`], so a\nfractional, negative or non-numeric value is an invalid_params NAMING\nthe parameter (a typed `u64` would fail inside rmcp's deserializer with\nserde's \"expected u64\" and no field name). The schema says integer.",
          "format": "uint64",
          "minimum": 0,
          "type": [
            "integer",
            "null"
          ]
        },
        "symbol": {
          "description": "Asset symbol: BTC, ETH, SOL, BNB, XRP, DOGE, HYPE, ZEC or ENA (case-insensitive; a\n`USDT` suffix is accepted).",
          "type": "string"
        },
        "to": {
          "description": "Window end (exclusive), same formats. Default: now. At most 12 h after `from`.",
          "type": [
            "string",
            "null"
          ]
        }
      },
      "required": [
        "symbol"
      ],
      "type": "object"
    }
  },
  {
    "name": "get_footprint_events",
    "description": "Order-book wall events from the 1-minute footprint of a symbol, built on the consolidated book and trade tape of Binance, Bybit, OKX and Hyperliquid. Answers: \"Did a large resting order get absorbed on BTC in the last hour?\", \"Were bid walls pulled before this drop?\", \"How thin was the book this hour?\". A wall = a resting price row far larger than the book's typical row (above median + 5 MAD of row sizes). kind=absorbed: trades hit the wall for at least 5% of its peak size, it still held at least 85% of that peak at the minute's close, and price did not break through it. kind=pulled: the wall fell below half of its peak while trades covered less than 30% of the drop, it did not refill within 2 seconds, and price had come within reach of it (cancelled, not filled). Scope: only price rows that traded in that minute and lie within the nearest 60 rows per side of mid are examined, so distant or untouched walls are not reported. wall_side: bid = resting buy orders, ask = resting sell orders. Per event: t = minute open, epoch ms; price = USD, lower edge of a `bucket`-wide row; peak_usd = largest resting size seen in the minute; executed_usd = volume traded against the wall; close_usd = resting size at the minute's close (whole dollars). At most 4 events of each kind are kept per minute, the largest peaks. thin_minutes = minutes whose resting depth near mid (within 25 bps, capped at the nearest 60 rows per side) was below the 20th percentile of the previous 2 hours, per side (bid, ask, both); classified = minutes of the window classified so far (the newest 2-3 minutes are still pending). Window: from/to as RFC3339, YYYY-MM-DD or epoch ms; default the last hour; at most 24 h per call, longer is an error, not a clamp. kinds = absorbed and/or pulled (default both); min_usd filters by peak_usd; limit 1..=150 (default 50) keeps the NEWEST events, counts cover the whole window and truncated=true says the list was cut. coverage.archive_from is when recording began; the archive only grows forward, so a window before it is honestly empty. Descriptive: an event states what the book did, not what price will do. Read-only.",
    "inputSchema": {
      "properties": {
        "from": {
          "description": "Window start: RFC3339 (`2026-10-12T09:10:00Z`), `YYYY-MM-DD` (UTC\nmidnight) or epoch milliseconds. Default: `to` minus one hour.",
          "type": [
            "string",
            "null"
          ]
        },
        "kinds": {
          "description": "Event kinds to return: `absorbed` and/or `pulled` (default both).",
          "items": {
            "type": "string"
          },
          "type": [
            "array",
            "null"
          ]
        },
        "limit": {
          "description": "Events returned, 1..=150 (default 50). When the window holds more, the\nNEWEST are kept and `truncated` is true; `counts` still cover the window.",
          "format": "uint32",
          "minimum": 0,
          "type": [
            "integer",
            "null"
          ]
        },
        "min_usd": {
          "description": "Smallest `peak_usd` that counts, USD, >= 0 (default 0 = every event).",
          "format": "double",
          "type": [
            "number",
            "null"
          ]
        },
        "symbol": {
          "description": "Asset symbol: BTC, ETH, SOL, BNB, XRP, DOGE, HYPE, ZEC or ENA (case-insensitive; a\n`USDT` suffix is accepted).",
          "type": "string"
        },
        "to": {
          "description": "Window end (exclusive), same formats. Default: now. At most 24 h after\n`from` — longer is an error, not a clamp.",
          "type": [
            "string",
            "null"
          ]
        }
      },
      "required": [
        "symbol"
      ],
      "type": "object"
    }
  },
  {
    "name": "get_stacked_imbalances",
    "description": "Stacked imbalances in the footprint of a symbol, computed on the consolidated trade tape of Binance, Bybit, OKX and Hyperliquid. Answers: \"Any stacked buying imbalance on BTC in the last hour?\", \"Where did aggressive selling stack up this morning?\", \"Which price bands saw one-sided market orders?\". Rule (diagonal, the same as the MarketTrace footprint chart): each candle is split into price rows `bucket` wide; rows with no trades are skipped, so a row's neighbour is the nearest traded row above or below. A row is a buy imbalance when its taker-buy volume is at least ratio × the taker-sell volume of the nearest traded row below it, and a sell imbalance when its taker-sell volume is at least ratio × the taker-buy volume of the nearest traded row above it; a zero opposite side counts, zero against zero does not. A row counts only if its total volume is at least 10% of the candle's largest row. A stacked imbalance = 3 or more consecutive traded rows flagged on the same side within one candle; a row can sit in a buy run and a sell run at once. ratio = 2, 3 or 4 (default 3). interval = 1m, 5m, 15m or 1h candles (default 1m). Per event: t = candle open, epoch ms; kind = buy (aggressive buying) or sell (aggressive selling); low/high = USD band from the lower edge of the run's lowest row to the upper edge of its highest row (it may include untraded rows); rows = flagged rows in the run; usd = dominant-side volume of the run × row price, whole dollars; partial = true while the candle is still forming or closed less than 3 minutes ago (the tape may still add trades). candles = candles with trades in the window. counts = runs per kind in the whole window; events lists at most limit of them (1..=150, default 50): when there are more, the LARGEST by usd are kept and truncated=true; the list is ordered by time. kinds = buy and/or sell (default both). On BTC at ratio 3 a typical hour has about 38 runs on 1m candles, 13 on 5m, 4 on 15m and 1 on 1h. Window: from/to as RFC3339, YYYY-MM-DD or epoch ms; default the last hour; a candle is included when its open lies in [from, to); at most 12 h per call and from no older than 31 days, beyond either is an error, not a clamp. Rows are never merged: when zoomed out the chart merges rows and outlines fewer, wider runs, so it matches this output only at a zoom where each row is one bucket. coverage.venues lists the venues with tape in the window; an empty list means no tape there (ZEC and ENA keep a 14-day tape). Descriptive: an imbalance states where aggressive volume was one-sided, not what price will do. Read-only.",
    "inputSchema": {
      "properties": {
        "from": {
          "description": "Window start: RFC3339, `YYYY-MM-DD` (UTC midnight) or epoch ms.\nDefault: `to` minus one hour. No older than 31 days.",
          "type": [
            "string",
            "null"
          ]
        },
        "interval": {
          "description": "Candle interval: 1m, 5m, 15m or 1h (default 1m).",
          "type": [
            "string",
            "null"
          ]
        },
        "kinds": {
          "description": "Sides to return: `buy` and/or `sell` (default both).",
          "items": {
            "type": "string"
          },
          "type": [
            "array",
            "null"
          ]
        },
        "limit": {
          "description": "Runs listed, 1..=150 (default 50); the largest by usd are kept.",
          "format": "uint32",
          "minimum": 0,
          "type": [
            "integer",
            "null"
          ]
        },
        "ratio": {
          "description": "Dominance ratio: 2, 3 or 4 (default 3).\n\nRead as any JSON value and checked in [`stacked_imbalances_query`], so\n2.5 or \"3\" is an invalid_params NAMING the parameter (a typed `u32`\nwould fail inside rmcp's deserializer with no field name). The schema\nsays integer.",
          "format": "uint32",
          "minimum": 0,
          "type": [
            "integer",
            "null"
          ]
        },
        "symbol": {
          "description": "Asset symbol: BTC, ETH, SOL, BNB, XRP, DOGE, HYPE, ZEC or ENA (case-insensitive; a\n`USDT` suffix is accepted).",
          "type": "string"
        },
        "to": {
          "description": "Window end (exclusive), same formats. Default: now. At most 12 h after `from`.",
          "type": [
            "string",
            "null"
          ]
        }
      },
      "required": [
        "symbol"
      ],
      "type": "object"
    }
  },
  {
    "name": "help",
    "description": "Guide to this server: every tool grouped by the question it answers, with a working example call for each, the supported symbols, how to read the scales, request limits, and where to find data that is not a tool of its own here (open interest, CVD, funding rate). Call it whenever you are unsure which tool to use. Takes no arguments. Read-only.",
    "inputSchema": {
      "properties": {},
      "type": "object"
    }
  }
] as unknown as ToolDef[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "perpwatch", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    const schema = ARG_SCHEMAS[name];
    if (!schema) {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    const parsed = schema.parse(args ?? {}) as Record<string, unknown>;
    const out = await callMarketTool(name, parsed, resolveConfig(process.env), defaultFetch);
    // A hosted tools/call result already carries MCP content
    // blocks; pass it through untouched when it does.
    if (isRecord(out) && Array.isArray(out.content)) {
      return out as { content: never[] };
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
