#!/usr/bin/env node
/**
 * perpwatch CLI.
 *
 *   perpwatch call <tool> [json-args]
 *   perpwatch tools
 *   perpwatch help
 *   perpwatch mcp
 *
 * `call` forwards one tool call to the hosted MarketTrace
 * endpoint (MARKETTRACE_BEARER required for data tools;
 * MARKETTRACE_MCP_URL overrides the endpoint). `help` prints
 * the local guide and needs no credentials. Exit codes: 0
 * success, 1 runtime error, 2 usage error.
 */
import {
  callMarketTool,
  formatPayload,
  getHelp,
  resolveConfig,
  TOOL_NAMES,
  VERSION,
} from "./perpwatch.js";
import type { FetchFn } from "./types.js";

const defaultFetch: FetchFn = async (url, init) => fetch(url, init);

function usage(): never {
  console.error(`Usage:
  perpwatch call <tool> [json-args]
  perpwatch tools
  perpwatch help
  perpwatch mcp
  perpwatch --version`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (cmd === "tools" && rest.length === 0) {
    console.log(TOOL_NAMES.join("\n"));
    return;
  }
  if (cmd === "help" && rest.length === 0) {
    console.log(getHelp());
    return;
  }
  if (cmd !== "call" || rest.length < 1 || rest.length > 2) usage();

  const [tool, jsonArgs] = rest;
  let args: Record<string, unknown> = {};
  if (jsonArgs !== undefined) {
    try {
      const parsed: unknown = JSON.parse(jsonArgs);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("json-args must be a JSON object");
      }
      args = parsed as Record<string, unknown>;
    } catch (err) {
      console.error(`error: invalid json-args: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(2);
    }
  }
  try {
    const out = await callMarketTool(tool, args, resolveConfig(process.env), defaultFetch);
    console.log(formatPayload(out));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
