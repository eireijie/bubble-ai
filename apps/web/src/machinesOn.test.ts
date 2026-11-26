import { describe, expect, it } from "vitest";
import { machinesOn } from "./devices.ts";

const vm = (over: Partial<{ online: boolean; status: "ready" | "starting" | "stopped" | "offline" | "error"; paused: boolean }> = {}) => ({ kind: "vm" as const, online: true, status: "ready" as const, paused: false, ...over });

describe("machinesOn (the sidebar's Computers count)", () => {
  it("counts a connected device that has no computer yet", () => {
    expect(machinesOn([{ online: true }], [])).toBe(1);
  });
  it("counts a device and its screen once", () => {
    expect(machinesOn([{ online: true }], [{ kind: "device", online: true, status: "ready", paused: false }])).toBe(1);
  });
  it("adds running VMs, not stopped, offline or paused ones", () => {
    expect(machinesOn([{ online: true }, { online: false }], [vm(), vm({ status: "starting" }), vm({ status: "stopped" }), vm({ online: false }), vm({ paused: true })])).toBe(3);
  });
  it("leaves out paused devices", () => {
    expect(machinesOn([{ online: true, paused: true }], [])).toBe(0);
  });
  it("uses device screens until the device list loads", () => {
    expect(machinesOn(null, [{ kind: "device", online: true, status: "ready", paused: false }, vm()])).toBe(2);
  });
});
