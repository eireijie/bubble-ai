#!/usr/bin/env -S npx tsx
import { envVar } from "@bubble-ai/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { WispClient } from "@bubble-ai/sdk";
import { createWispMcp } from "./server.ts";

/**
 * wisp-mcp: stdio MCP server.
 *   BUBBLE_URL    hub URL (default http://localhost:4747)
 *   BUBBLE_TOKEN  agent token, or node token together with BUBBLE_AGENT
 *   BUBBLE_AGENT  agent id when using a node token
 *   BUBBLE_RUN    the request this server works on (set by the device for each run)
 */
const url = envVar("URL") ?? "http://localhost:4747";
const token = envVar("TOKEN");
if (!token) {
  console.error("wisp-mcp: set BUBBLE_TOKEN (create one in Bubble AI under Agent → Connect)");
  process.exit(1);
}

const server = await createWispMcp(new WispClient({ url, token, agentId: envVar("AGENT"), runId: envVar("RUN") }));
await server.connect(new StdioServerTransport());
