import { describe, expect, it } from "vitest";
import { isTopOverlay, registerOverlay, topOverlay } from "../src/overlays.ts";

describe("overlay stack", () => {
  it("only the last overlay opened is on top, and closing hands the keyboard back", () => {
    const builder = Symbol("builder"), modal = Symbol("modal"), palette = Symbol("palette");
    const offBuilder = registerOverlay(builder, "builder");
    expect(topOverlay()).toBe("builder");
    const offModal = registerOverlay(modal, "modal");
    expect(topOverlay()).toBe("modal");
    expect(isTopOverlay(builder)).toBe(false);
    const offPalette = registerOverlay(palette, "palette");
    expect(isTopOverlay(modal)).toBe(false);
    expect(isTopOverlay(palette)).toBe(true);
    offModal(); // closed out of order
    expect(isTopOverlay(palette)).toBe(true);
    offPalette();
    expect(topOverlay()).toBe("builder");
    offBuilder();
    expect(topOverlay()).toBeNull();
  });

  it("a dialog opened after a menu answers Escape (menus are not overlays and leave nothing behind)", () => {
    const dialog = Symbol("modal");
    const off = registerOverlay(dialog, "modal");
    expect(isTopOverlay(dialog)).toBe(true);
    off();
    expect(topOverlay()).toBeNull();
  });

  it("the help card has no keys of its own, so a dialog under it still answers Escape", () => {
    const dialog = Symbol("modal"), help = Symbol("help"), palette = Symbol("palette");
    const offDialog = registerOverlay(dialog, "modal");
    const offHelp = registerOverlay(help, "help"); // appeared after the dialog opened
    expect(isTopOverlay(dialog)).toBe(true);
    const offPalette = registerOverlay(palette, "palette");
    expect(isTopOverlay(dialog)).toBe(false);
    offPalette(); offHelp(); offDialog();
    expect(topOverlay()).toBeNull();
  });
});
