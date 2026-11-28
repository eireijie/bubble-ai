import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GhostAppearance } from "@bubble-ai/core/src/appearance.ts";

const calls: { method: string; path: string; body: unknown }[] = [];
vi.mock("../api.ts", () => ({
  api: async (method: string, path: string, body: unknown) => {
    calls.push({ method, path, body });
    return {};
  },
  uploadFile: async () => ({ id: "f1" }),
  fileUrl: async () => "blob:x",
}));

// onboarding's helpers come with the drawn bubble and the New agent dialog; neither matters here
vi.mock("./onboarding/HostGhost.tsx", () => ({ WHITE_WISP: {} }));
vi.mock("../views/CreateAgent.tsx", () => ({ freeHandle: (name: string) => name.toLowerCase() }));

const { lookPhotoId, mergeLook } = await import("./lookPhoto.tsx");
const { renameNamedAgent } = await import("../views/onboarding/firstAgent.ts");

const base: GhostAppearance = { shape: "round", color: "#7fb0f0", eyes: "dots", mouth: "none", cheeks: false, hat: "none", accessory: "none", motion: "float", bubble: "round", parts: true };

describe("an agent's photo face (round 11, the iPhone's appearance.photo)", () => {
  beforeEach(() => void (calls.length = 0));

  it("keeps a saved photo, and any field it doesn't know, when another part of the look is saved", () => {
    const saved = { ...base, photo: "/api/files/abc_1", later: "kept" } as GhostAppearance;
    const picked: GhostAppearance = { ...base, hat: "beanie" };
    expect(mergeLook(saved, picked)).toEqual({ ...base, hat: "beanie", photo: "/api/files/abc_1", later: "kept" });
  });

  it("removes the photo only when the pick says so (undefined), and leaves the saved look alone", () => {
    const saved = { ...base, photo: "/api/files/abc_1" };
    const out = mergeLook(saved, { ...base, color: "#ff0000", photo: undefined });
    expect("photo" in out).toBe(false);
    expect(JSON.parse(JSON.stringify(out))).toEqual({ ...base, color: "#ff0000" });
    expect(saved.photo).toBe("/api/files/abc_1");
  });

  it("works with nothing saved yet", () => {
    expect(mergeLook(undefined, { ...base, photo: "/api/files/x" })).toEqual({ ...base, photo: "/api/files/x" });
  });

  it("shows only hub files: an outside address or junk falls back to the bubble", () => {
    expect(lookPhotoId("/api/files/abc_1-Z")).toBe("abc_1-Z");
    for (const bad of [undefined, null, "", "https://elsewhere.example/a.png", "/api/files/../x", "/api/files/", `/api/files/${"a".repeat(65)}`, "api/files/abc"]) expect(lookPhotoId(bad)).toBeNull();
  });

  it("onboarding's re-save of the first agent keeps a photo set elsewhere", async () => {
    const agent = { id: "a1", name: "Ivy", handle: "ivy", settings: { appearance: { ...base, photo: "/api/files/face" } } };
    await renameNamedAgent(agent, { name: "Ivy", role: "", appearance: { ...base, color: "#00ff00" }, instructions: "" }, []);
    expect(calls).toHaveLength(1);
    const sent = calls[0].body as { settings: { appearance: GhostAppearance } };
    expect(sent.settings.appearance.photo).toBe("/api/files/face");
    expect(sent.settings.appearance.color).toBe("#00ff00");
  });
});
