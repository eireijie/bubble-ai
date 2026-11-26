import { describe, expect, it, vi } from "vitest";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FEATURE_PRESETS } from "@bubble-ai/core";
import type { FiveState } from "./rows.tsx";

// the shared UI parts read browser state when their module loads; a row doesn't need it
vi.mock("../../theme.ts", () => ({ motionReduced: () => false }));
const { FiveContext, Group, SRow } = await import("./rows.tsx");

const base: FiveState = { page: "you", guest: false, features: FEATURE_PRESETS.everything, landed: null, target: null };
const draw = (state: Partial<FiveState>, ...children: ReactNode[]) => renderToStaticMarkup(h(FiveContext.Provider, { value: { ...base, ...state } }, ...children));

describe("a settings row", () => {
  it("shows its name from the map with its control beside it", () => {
    const html = draw({}, h(SRow, { id: "appearance" }, h("b", null, "control")));
    expect(html).toContain('id="setting-appearance"');
    expect(html).toContain("Appearance");
    expect(html).toContain("<b>control</b>");
  });

  it("is always shown: nothing is folded behind Show all", () => {
    expect(draw({}, h(SRow, { id: "clock" }))).toContain("Clock");
    expect(draw({ page: "agents" }, h(SRow, { id: "hops" }))).toContain("Hand-offs in a row");
  });

  it("is a link to its own address when it opens a sheet, with its value on it", () => {
    const html = draw({}, h(SRow, { id: "notifications", value: "On" }));
    expect(html).toContain('href="#/settings/notifications"');
    expect(html).toContain("On");
    expect(draw({ page: "privacy" }, h(SRow, { id: "password" }))).toContain('href="#/settings/security/password"');
  });

  it("isn't there for a guest, or while its mod is off", () => {
    expect(draw({ guest: true }, h(SRow, { id: "voice" }))).toBe("");
    expect(draw({ page: "privacy", features: { ...FEATURE_PRESETS.everything, invite: false } }, h(SRow, { id: "people" }))).toBe("");
  });

  it("leaves its card empty (and so hidden) when every row in it is out", () => {
    expect(draw({ guest: true }, h(Group, null, h(SRow, { id: "voice" })))).toMatch(/^<div class="[^"]*empty:hidden[^"]*"><\/div>$/);
  });

  it("is marked when an address points at it", () => {
    expect(draw({ target: "appearance" }, h(SRow, { id: "appearance" }))).toContain("bg-side-active");
  });
});

describe("a group", () => {
  it("puts a small title over its card", () => {
    const html = draw({}, h(Group, { title: "Chat" }, h(SRow, { id: "clock" })));
    expect(html).toContain(">Chat</h2>");
    expect(html).toContain("Clock");
  });
});
