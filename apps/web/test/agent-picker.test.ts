import { afterEach, describe, expect, it, vi } from "vitest";
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../src/theme.ts", () => ({ motionReduced: () => motion.reduced, useMotionReduced: () => motion.reduced }));
import { AGENT_TYPES, START_APPS, appsForTypes, missesMac, typeRole } from "../src/views/onboarding/agentTypes.ts";
import { onAMac, sheetCta } from "../src/views/onboarding/TypeStep.tsx";
import { QUICK, answeredOnce, pingState } from "../src/components/onboarding/FirstChat.tsx";
import { readTerms } from "../src/components/onboarding/FirstHello.tsx";
import { listOf } from "../src/views/HereView.tsx";
import { CONNECTOR_CATALOG } from "@wisp/core";

afterEach(() => {
  motion.reduced = false;
  vi.useRealTimers();
});

describe("pick your agent", () => {
  it("uses the owner's names, in order", () => {
    expect(AGENT_TYPES.map((t) => t.name)).toEqual(["Daily assistant", "Work assistant", "Coding assistant", "Business manager", "Research assistant", "Something else"]);
  });

  it("merges the picked kinds' apps once each, with Soon apps last", () => {
    const ids = appsForTypes(["work", "biz"], "", true).map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 5)).toEqual(["slack", "notion", "linear", "jira", "stripe"]);
    expect(ids.slice(-3)).toEqual(["gmail", "gcal", "gdrive"]);
  });

  it("shows Apple apps only when Wisp lives on a Mac, and says so when they're missing", () => {
    expect(appsForTypes(["daily"], "", true).map((a) => a.id).slice(0, 4)).toEqual(["messages", "calendar", "reminders", "contacts"]);
    expect(appsForTypes(["daily"], "", false).some((a) => a.how === "mac")).toBe(false);
    expect(missesMac(["daily"], false)).toBe(true);
    expect(missesMac(["daily"], true)).toBe(false);
    expect(missesMac(["code"], false)).toBe(false);
    expect(onAMac([{ mine: true, capabilities: { platform: "darwin" } }])).toBe(true);
    expect(onAMac([{ mine: false, capabilities: { platform: "darwin" } }, { mine: true, capabilities: { platform: "linux" } }])).toBe(false);
  });

  it("never fakes an app: every keyed app is a real catalog connector, and Google and Vercel stay Soon", () => {
    for (const a of Object.values(START_APPS)) if (a.how === "key") expect(CONNECTOR_CATALOG.some((c) => c.id === a.catalogId)).toBe(true);
    for (const id of ["gmail", "gcal", "gdrive", "vercel"]) expect(START_APPS[id].how).toBe("soon");
  });

  it("suggests a notes app and web search for Something else only once there are words", () => {
    expect(appsForTypes(["other"], "", true)).toEqual([]);
    expect(appsForTypes(["other"], "plan my garden", true).map((a) => a.id)).toEqual(["notion", "brave"]);
  });

  it("prefills What I do from the first pick, or their own words", () => {
    expect(typeRole(["daily", "code"], "")).toBe("Keep my days on track.");
    expect(typeRole(["other"], "plan my garden")).toBe("Plan my garden.");
    expect(typeRole([], "")).toBeNull();
  });

  it("names the sheet's button by how many are connected", () => {
    expect(sheetCta(0)).toBe("Connect one to continue");
    expect(sheetCta(1)).toBe("Continue with 1 app");
    expect(sheetCta(3)).toBe("Continue with 3 apps");
  });

  it("underlines what it read, saying where from", () => {
    expect(readTerms([{ app: "GitHub", terms: ["acme/shop-web", "ab"] }])).toEqual([{ term: "acme/shop-web", src: "GitHub, just now" }]);
    expect(listOf(["GitHub"])).toBe("GitHub");
    expect(listOf(["Messages", "Calendar", "Slack"])).toBe("Messages, Calendar and Slack");
  });
});

describe("first chat: one primary step, pings after something useful", () => {
  const m = (kind: "user" | "agent", id: string) => ({ author: { kind, id }, threadId: null, deletedAt: null }) as never;
  it("offers one primary quick reply", () => {
    expect(QUICK[0]).toBe("Yes, go ahead");
    expect(QUICK).toHaveLength(2);
  });

  it("waits for the agent to answer the person before asking about pings", () => {
    expect(answeredOnce([m("agent", "a1")], "a1")).toBe(false);
    expect(answeredOnce([m("agent", "a1"), m("user", "u1")], "a1")).toBe(false);
    expect(answeredOnce([m("agent", "a1"), m("user", "u1"), m("agent", "a1")], "a1")).toBe(true);
    expect(answeredOnce([m("user", "u1"), m("agent", "a2")], "a1")).toBe(false);
  });

  it("asks, then shows what the system said, with the switch after a no", () => {
    expect(pingState({ answered: false, asked: false, busy: false, perm: "default" })).toBe("hidden");
    expect(pingState({ answered: true, asked: false, busy: false, perm: "default" })).toBe("ask");
    expect(pingState({ answered: true, asked: false, busy: true, perm: "default" })).toBe("asking");
    expect(pingState({ answered: true, asked: false, busy: false, perm: "denied" })).toBe("off");
    expect(pingState({ answered: true, asked: true, busy: false, perm: "denied" })).toBe("hidden");
    expect(pingState({ answered: true, asked: false, busy: false, perm: "granted" })).toBe("hidden");
    expect(pingState({ answered: true, asked: false, busy: false, perm: "unsupported" })).toBe("hidden");
  });
});

describe("the host thinks before it reacts", () => {
  it("looks up for a moment, then plays only the last answer; Reduce Motion skips the pause", async () => {
    vi.useFakeTimers();
    const { hostAnswer, onHostReact, THINK_MS } = await import("../src/components/onboarding/HostGhost.tsx");
    const seen: string[] = [];
    const off = onHostReact((k) => seen.push(k));
    try {
      hostAnswer("nod");
      hostAnswer("hop");
      expect(seen).toEqual([]);
      vi.advanceTimersByTime(THINK_MS);
      expect(seen).toEqual(["hop"]);
      motion.reduced = true;
      hostAnswer("catch");
      expect(seen).toEqual(["hop", "catch"]);
    } finally {
      off();
    }
  });
});
