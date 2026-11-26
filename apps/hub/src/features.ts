import { FEATURE_KEYS, FEATURES_VERSION, resolveFeatures, upgradeStoredFeatures, type FeatureKey, type Features } from "@bubble-ai/core";
import type { Store } from "./store.ts";

const KEY = "features";

/**
 * The organization's optional features (Settings → General → Mods). Organizations from before Features have everything on.
 * A set stored before agents working on their own was on by default gets it now, once (upgradeStoredFeatures).
 */
export function workspaceFeatures(store: Store, workspaceId: string): Features {
  let stored: (Partial<Features> & { v?: number }) | null = null;
  try {
    stored = JSON.parse(store.setting(workspaceId, KEY) ?? "null");
  } catch {}
  const upgraded = upgradeStoredFeatures(stored);
  if (upgraded) {
    store.setSetting(workspaceId, KEY, JSON.stringify(upgraded));
    stored = upgraded;
  }
  return resolveFeatures(stored);
}

export function featureOn(store: Store, workspaceId: string, key: FeatureKey): boolean {
  return workspaceFeatures(store, workspaceId)[key];
}

/** Store a complete set: what's there now with `patch` on top. */
export function setWorkspaceFeatures(store: Store, workspaceId: string, patch: Partial<Features>): Features {
  const next = { ...workspaceFeatures(store, workspaceId) };
  for (const k of FEATURE_KEYS) if (typeof patch[k] === "boolean") next[k] = patch[k]!;
  store.setSetting(workspaceId, KEY, JSON.stringify({ ...next, v: FEATURES_VERSION }));
  return next;
}
