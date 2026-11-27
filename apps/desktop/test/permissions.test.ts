import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const { permissionStatus, screenShouldTurnOn, requestPermission, PANE } = createRequire(import.meta.url)("../src/permissions.cjs");

const mac = (media: Record<string, string> = {}, trusted = false) => ({
  getMediaAccessStatus: vi.fn((k: string) => media[k] ?? "not-determined"),
  isTrustedAccessibilityClient: vi.fn(() => trusted),
  askForMediaAccess: vi.fn(async () => true),
});

describe("first-run permissions", () => {
  it("reads each one live on a Mac; notifications count once asked", () => {
    expect(permissionStatus({ platform: "darwin", systemPreferences: mac({ screen: "granted", microphone: "denied" }, true) })).toEqual({ screen: "granted", accessibility: "granted", microphone: "denied", notifications: "not-determined" });
    expect(permissionStatus({ platform: "darwin", systemPreferences: mac(), notificationsAsked: true }).notifications).toBe("granted");
  });

  it("needs none on Windows and Linux", () => {
    expect(Object.values(permissionStatus({ platform: "win32", systemPreferences: {} }))).toEqual(["granted", "granted", "granted", "granted"]);
  });

  it("turns the screen on once agents can see and use the Mac, unless someone chose at the device", () => {
    const yes = { screen: "granted", accessibility: "granted" };
    expect(screenShouldTurnOn({ platform: "darwin", node: {}, perms: yes })).toBe(true);
    expect(screenShouldTurnOn({ platform: "darwin", node: {}, perms: { ...yes, accessibility: "not-determined" } })).toBe(false);
    expect(screenShouldTurnOn({ platform: "darwin", node: { shareScreen: false }, perms: yes })).toBe(false);
    expect(screenShouldTurnOn({ platform: "darwin", node: { noScreen: true }, perms: yes })).toBe(false);
    expect(screenShouldTurnOn({ platform: "linux", node: {}, perms: {} })).toBe(true);
  });

  it("Allow asks macOS first, then opens the right System Settings pane", async () => {
    const shell = { openExternal: vi.fn(async () => {}) };
    const asked = new Set<string>();
    const prefs = mac({ screen: "denied" });
    const deps = { platform: "darwin", systemPreferences: prefs, shell, desktopCapturer: { getSources: vi.fn(async () => []) }, notify: vi.fn(), asked };
    expect(await requestPermission("accessibility", deps)).toBe("asked");
    expect(prefs.isTrustedAccessibilityClient).toHaveBeenLastCalledWith(true);
    expect(await requestPermission("accessibility", deps)).toBe("opened");
    expect(shell.openExternal).toHaveBeenLastCalledWith(PANE.accessibility);
    // looking at the screen once makes macOS ask; still not allowed, so its pane opens
    expect(await requestPermission("screen", deps)).toBe("opened");
    expect(deps.desktopCapturer.getSources).toHaveBeenCalledOnce();
    expect(shell.openExternal).toHaveBeenLastCalledWith(PANE.screen);
    expect(await requestPermission("microphone", deps)).toBe("asked");
    expect(prefs.askForMediaAccess).toHaveBeenCalledWith("microphone");
    expect(await requestPermission("notifications", deps)).toBe("asked");
    expect(deps.notify).toHaveBeenCalledOnce();
  });
});
