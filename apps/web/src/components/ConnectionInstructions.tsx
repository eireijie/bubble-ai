import { shareOrigin, useAccess } from "../access.ts";
import { useState } from "react";
import { CopyBlock, cx } from "./ui.tsx";

/** The same invitation configuration in onboarding and the agent's Connect tab. */
export function ConnectionInstructions({
  token,
  harness,
}: {
  token: string;
  harness: string;
}) {
  const [format, setFormat] = useState(
    harness === "claude-code"
      ? "claude"
      : harness === "codex"
        ? "codex"
        : "json",
  );
  useAccess();
  const hub = shareOrigin();
  // Shell and TOML use their own quoting rules; hub URLs can contain special characters.
  const shell = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
  const config =
    format === "claude"
      ? `claude mcp add bubble-ai --env BUBBLE_URL=${shell(hub)} --env BUBBLE_TOKEN=${shell(token)} -- wisp-mcp`
      : format === "codex"
        ? `[mcp_servers.wisp]\ncommand = "wisp-mcp"\nenv = { BUBBLE_URL = ${JSON.stringify(hub)}, BUBBLE_TOKEN = ${JSON.stringify(token)} }`
        : JSON.stringify(
            {
              mcpServers: {
                wisp: {
                  command: "wisp-mcp",
                  env: { BUBBLE_URL: hub, BUBBLE_TOKEN: token },
                },
              },
            },
            null,
            2,
          );
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        On the agent's machine, run{" "}
        <code className="text-ink">npm install && npm link</code> in Bubble AI's
        folder, add this to its MCP settings and restart the session.
      </p>
      <div
        className="flex flex-wrap gap-1"
        role="tablist"
        aria-label="Connection format"
      >
        {[
          ["claude", "Claude Code"],
          ["codex", "Codex"],
          ["json", "Other MCP clients"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={format === id}
            onClick={() => setFormat(id)}
            className={cx(
              "rounded-lg px-3 py-2 text-xs font-medium",
              format === id ? "bg-chip text-ink" : "text-muted hover:bg-hover",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <CopyBlock text={config} />
      <p className="text-xs text-muted">
        Holds this agent's token. Copy it before closing.
      </p>
    </div>
  );
}
