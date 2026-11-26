import { describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../theme.ts", () => ({ motionReduced: () => false }));
const { LAYER, layerIndex } = await import("./layers.ts");
const { Modal } = await import("./ui.tsx");
const { SettingsDialog } = await import("./SettingsDialog.tsx");

const zOf = (html: string) => layerIndex(/class="[^"]*?(z-\[?\d+\]?)/.exec(html)?.[1] ?? "");

describe("what covers what", () => {
  it("puts a dialog opened from Settings over Settings, and menus and toasts over both", () => {
    const order = [LAYER.sheet, LAYER.settings, LAYER.modal, LAYER.menu, LAYER.toast, LAYER.tour].map(layerIndex);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(order).size).toBe(order.length);
  });

  it("renders Settings and a dialog in those layers", () => {
    const settings = zOf(renderToStaticMarkup(h(SettingsDialog, { label: "Settings", closing: false, onClose: () => {}, children: "x" })));
    const modal = zOf(renderToStaticMarkup(h(Modal, { title: "Connect Claude", onClose: () => {}, children: "x" })));
    expect(settings).toBe(layerIndex(LAYER.settings));
    expect(modal).toBe(layerIndex(LAYER.modal));
    expect(modal).toBeGreaterThan(settings);
  });
});
