import { harnessLabel, type RunFailureReason } from "@bubble-ai/core";
import type { HelperCheck } from "../onboarding.ts";

/**
 * "My agent isn't answering", corrected by what actually happened: the device's list can say an
 * AI is installed (or signed in) while its last reply failed because it isn't. The failure wins:
 * that check is marked as needing a fix, with the reason, and the checks after it can't be told.
 */
export function withLastFailure(checks: HelperCheck[], failure: { reason?: RunFailureReason; why?: string } | null, agent: { id: string; harness: string }): HelperCheck[] {
  if (!failure?.reason) return checks;
  const id = failure.reason === "not_installed" ? "harness" : failure.reason === "signed_out" ? "signin" : null;
  if (!id) return checks;
  const at = checks.findIndex((c) => c.id === id);
  const label = harnessLabel(agent.harness);
  const fixed: HelperCheck =
    id === "harness"
      ? { id, status: "bad", label: at >= 0 ? checks[at].label : `${label} is installed`, fix: `${failure.why ?? `${label} isn't installed.`} Install it, or pick an AI that's already there.`, to: { view: "agents", agentId: agent.id, tab: "model" } }
      : { id, status: "bad", label: at >= 0 ? checks[at].label : `${label} is signed in`, fix: `${failure.why ?? `${label} isn't signed in.`} Sign in so it can answer.`, to: { view: "settings", page: "harnesses" } };
  // a check that earlier failed already says what to do first: leave the list as it is
  if (checks.some((c, i) => c.status === "bad" && (at < 0 || i < at))) return checks;
  if (at < 0) return [...checks, fixed];
  return [...checks.slice(0, at), fixed, ...checks.slice(at + 1).map((c) => ({ ...c, status: "unknown" as const, fix: null, to: null }))];
}
