#!/usr/bin/env node
// `bubble-ai-mcp`: stdio MCP server that gives any harness Bubble AI's chat, task, memory and file tools.
import { register } from "tsx/esm/api";
register();
await import("../packages/mcp/src/main.ts");
