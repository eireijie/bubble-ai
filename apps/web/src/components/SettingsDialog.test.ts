import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("../theme.ts", () => ({ motionReduced: () => false, useMotionReduced: () => false }));
import { DIALOG_SIZE, PopNav, SettingsDialog, escapeCloses } from "./SettingsDialog.tsx";

const render = (closing: boolean, more: { size?: "large" | "medium" | "full"; swapKey?: string } = {}) => renderToStaticMarkup(createElement(SettingsDialog, { label: "Settings", closing, onClose: vi.fn(), ...more, children: createElement("p", null, "Body") }));

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

  it("comes in three sizes: large 960 and medium 640, both as tall as they need up to 680, and the whole window", () => {
    expect(render(false)).toContain('data-size="large"');
    expect(DIALOG_SIZE.large).toContain("w-[min(960px,calc(100vw-48px))]");
    expect(DIALOG_SIZE.large).toContain("max-h-[min(680px,calc(100vh-96px))]");
    expect(DIALOG_SIZE.large).not.toMatch(/(^| )h-/);
    expect(DIALOG_SIZE.medium).toContain("w-[min(640px,calc(100vw-48px))]");
    expect(DIALOG_SIZE.medium).toContain("max-h-[min(680px,calc(100vh-96px))]");
    expect(DIALOG_SIZE.medium).not.toMatch(/(^| )h-/);
    const medium = render(false, { size: "medium" });
    expect(medium).toContain('data-size="medium"');
    expect(medium).toContain(DIALOG_SIZE.medium);
    expect(render(false, { size: "full" })).toContain(DIALOG_SIZE.full);
  });

  it("crossfades what's inside when another place is picked, instead of closing and opening again", () => {
    expect(render(false, { swapKey: "computers" })).toContain("pop-swap");
    expect(render(false)).not.toContain("pop-swap");
  });

  it("lists its sections in 34px rows of 14px text with 16px icons", () => {
    const html = renderToStaticMarkup(createElement(PopNav, { label: "Settings", current: "you", items: [{ key: "you", label: "You", icon: createElement("svg"), href: "#/settings/profile" }, { key: "mods", label: "Mods", icon: createElement("svg"), href: "#/settings/mods" }] }));
    expect(html).toContain("h-[34px]");
    expect(html).toContain("text-[length:var(--t-row)]");
    expect(html).toContain("size-4");
    expect(html).toContain('aria-current="page"');
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
