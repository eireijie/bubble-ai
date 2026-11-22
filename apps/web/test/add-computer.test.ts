import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AddComputer, DEFAULT_SIZE, orgoStatus, startKind } from "../src/views/ComputersView.tsx";
import { AddDeviceDialog } from "../src/components/AddDevice.tsx";
import type { DeviceInfo } from "../src/devices.ts";
import { useStore } from "../src/store.ts";

vi.mock("../src/api.ts", () => ({ api: vi.fn(() => new Promise(() => {})), uploadFile: vi.fn() }));
vi.mock("../src/theme.ts", () => ({ motionReduced: () => false }));

const initial = useStore.getState();
afterEach(() => {
  (useStore.getInitialState() as { me: unknown }).me = initial.me;
});

const mac: DeviceInfo = { id: "mac", name: "This Mac", online: true, mine: true, agents: [], capabilities: { platform: "darwin", arch: "arm64", screen: { ok: true, detail: "" }, vm: { ok: true, detail: "" } } };

describe("add computer choices", () => {
  it("starts on the agent's own desktop when a device can run one, and on a cloud computer when that is the row picked", () => {
    expect(startKind(undefined, [mac])).toBe("vm");
    expect(startKind("here", [mac])).toBe("vm");
    expect(startKind("here", [])).toBeNull();
    expect(startKind("here", [{ ...mac, capabilities: null }])).toBeNull();
    expect(startKind("cloud", [])).toBe("orgo");
  });

  it("makes new computers medium unless a size is picked", () => {
    expect(DEFAULT_SIZE).toBe("medium");
  });

  it("treats loading and missing Orgo key as unavailable", () => {
    expect(orgoStatus(null)).toBe("checking");
    expect(orgoStatus({ configured: false })).toBe("needs-key");
    expect(orgoStatus({ configured: true })).toBe("ready");
  });

  const render = (devices: DeviceInfo[], only?: "here" | "cloud") => renderToStaticMarkup(createElement(AddComputer, { devices, only, onClose: () => {}, onCreated: () => {} }));

  it("offers its own desktop, your screen and a cloud computer, with no question to answer first", () => {
    const html = render([mac]);
    expect(html).toContain("Its own desktop");
    expect(html).toContain("My screen");
    expect(html).toContain("A cloud computer");
    expect(html).not.toContain("What should the agent be able to do?");
    expect(html).not.toContain("Answer questions only");
  });

  it("fills in where it lives, its name and its size, behind one Change", () => {
    const html = render([mac], "here");
    expect(html).toContain("This Mac desktop · Medium · On This Mac");
    expect(html).toContain("Change");
    // nothing to fill in before adding
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<input");
  });

  it("narrows to what the Add list's row was", () => {
    expect(render([mac], "here")).not.toContain("A cloud computer");
    const cloud = render([mac], "cloud");
    expect(cloud).not.toContain("Its own desktop");
    expect(cloud).toContain("A cloud computer");
  });

  it("says why when no device can run a desktop", () => {
    expect(render([])).toContain("Connect a device first.");
  });
});

describe("the Add list", () => {
  it("is one list of what can be added", () => {
    const html = renderToStaticMarkup(createElement(AddDeviceDialog, { onClose: () => {} }));
    const rows = ["This computer", "Another computer", "A phone", "A cloud computer"];
    for (const row of rows) expect(html).toContain(row);
    expect(rows.map((r) => html.indexOf(r))).toEqual([...rows.map((r) => html.indexOf(r))].sort((a, b) => a - b));
  });
});
