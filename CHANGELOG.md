# Changelog

## 0.1.0 (2026-10-27)

- Initial release: eleven read-only MarketTrace perps-feed tools
  (`get_market_state`, `get_funding_percentile`,
  `get_liquidations_recent`, `get_ohlcv`,
  `get_conditional_outcomes`, `get_state_history`,
  `get_volume_profile`, `get_big_trades`,
  `get_footprint_events`, `get_stacked_imbalances`, `help`).
- Data calls forward to the hosted MCP endpoint with the
  `MARKETTRACE_BEARER` bearer (endpoint overridable via
  `MARKETTRACE_MCP_URL`); `help` is served locally.
