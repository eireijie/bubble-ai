import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../theme.ts", () => ({ motionReduced: () => false, useMotionReduced: () => false }));
vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
import { welcomeScreen } from "../WelcomeView.tsx";
import { allAllowed, macStepWanted, ThisMacStep } from "./ThisMacStep.tsx";

const desktop = (platform: string) => ({ platform, permissions: { status: async () => null, request: async () => null } }) as unknown as Window["wispDesktop"];

describe("Let your agents use this Mac", () => {
  it("shows only in the desktop app on a Mac, once", () => {
    expect(macStepWanted(desktop("darwin"), false)).toBe(true);
    expect(macStepWanted(desktop("darwin"), true)).toBe(false);
    expect(macStepWanted(desktop("win32"), false)).toBe(false);
    expect(macStepWanted(desktop("linux"), undefined)).toBe(false);
    expect(macStepWanted(undefined, false)).toBe(false);
  });

  it("comes right after the name, before the first agent", () => {
    expect(welcomeScreen(null, { hasAgent: false, mac: true })).toBe("mac");
    expect(welcomeScreen("mac", { hasAgent: false, mac: true })).toBe("mac");
    expect(welcomeScreen("agent", { hasAgent: false, mac: true })).toBe("agent");
    expect(welcomeScreen(null, { hasAgent: false, mac: false })).toBe("agent");
  });

  it("lists the four permissions with Allow, and Continue waits for all of them", () => {
    const html = renderToStaticMarkup(createElement(ThisMacStep, { onDone: () => {} }));
    expect(html).toContain("Let your agents use this Mac");
    for (const n of ["Screen Recording", "Accessibility", "Microphone", "Notifications"]) expect(html).toContain(`aria-label="Allow ${n}"`);
    expect(html).toMatch(/<button type="button" disabled="" class="ob-primary[^"]*">Continue<\/button>/);
    expect(html).toContain("Not now");
    expect(allAllowed({ screen: "granted", accessibility: "granted", microphone: "granted", notifications: "not-determined" })).toBe(false);
    expect(allAllowed({ screen: "granted", accessibility: "granted", microphone: "granted", notifications: "granted" })).toBe(true);
  });
});
