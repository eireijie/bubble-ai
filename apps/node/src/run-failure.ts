import { runFailureReason, type NodeToHub } from "@bubble-ai/core";

type RunFailed = Extract<NodeToHub, { type: "run_failed" }>;

/**
 * A run_failed report with its reason code, so the hub (and the chat) can say why in plain words
 * and offer the fix: `spawn claude ENOENT` becomes "not_installed", a 401 "signed_out".
 * `harness` is the agent's, when known; a reason already set is kept.
 */
export function runFailed(runId: string, error: string, harness = ""): RunFailed {
  return { type: "run_failed", runId, error, reason: runFailureReason(harness, error) };
}

/** Fill in the reason on a report that has none (every run_failed the device sends goes through this). */
export function withReason(m: RunFailed, harness = ""): RunFailed {
  return m.reason ? m : { ...m, reason: runFailureReason(harness, m.error) };
}
