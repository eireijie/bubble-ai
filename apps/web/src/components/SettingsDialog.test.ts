import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../theme.ts", () => ({ motionReduced: () => false, useMotionReduced: () => false }));
import { SettingsDialog, escapeCloses } from "./SettingsDialog.tsx";

const render = (closing: boolean) => renderToStaticMarkup(createElement(SettingsDialog, { label: "Settings", closing, onClose: vi.fn(), children: createElement("p", null, "Body") }));

describe("the Settings pop-up", () => {
  it("is a labelled modal dialog with a close button, over a dim", () => {
    const html = render(false);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Settings"');
    expect(html).toContain('aria-label="Close"');
    expect(html).toContain('class="settings-pop ');
    expect(html).toContain('data-state="in"');
    expect(html).toContain("Body");
  });

  it("plays its exit while it closes", () => {
    const html = render(true);
    expect(html).toContain('data-state="out"');
    expect(html).toContain("pointer-events-none");
  });

  it("closes on Escape, unless something else should take it first", () => {
    const key = (k: string, target: unknown = null, defaultPrevented = false) => ({ key: k, target, defaultPrevented });
    expect(escapeCloses(key("Escape"), false)).toBe(true);
    expect(escapeCloses(key("Enter"), false)).toBe(false);
    // a menu or another dialog is open on top
    expect(escapeCloses(key("Escape"), true)).toBe(false);
    // someone already handled it
    expect(escapeCloses(key("Escape", null, true), false)).toBe(false);
    // a search with words in it clears first; an empty one closes
    expect(escapeCloses(key("Escape", { tagName: "INPUT", type: "search", value: "voice" }), false)).toBe(false);
    expect(escapeCloses(key("Escape", { tagName: "INPUT", type: "search", value: "" }), false)).toBe(true);
  });
});
