import { afterEach, describe, expect, it, vi } from "vitest";
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../src/theme.ts", () => ({ motionReduced: () => motion.reduced, useMotionReduced: () => motion.reduced }));
import { AGENT_TYPES, START_APPS, appsForTypes, missesMac, typeRole } from "../src/views/onboarding/agentTypes.ts";
import { ASK_OPENS, QUICK, answeredOnce, chatAsk, pingState } from "../src/components/onboarding/FirstChat.tsx";
import { READY_ITEMS, nextAsk, readyRows } from "../src/onboarding.ts";
import { readTerms } from "../src/components/onboarding/FirstHello.tsx";
import { listOf } from "../src/views/HereView.tsx";
import { CONNECTOR_CATALOG } from "@bubble-ai/core";

afterEach(() => {
  motion.reduced = false;
  vi.useRealTimers();
});

describe("pick your agent", () => {
  it("uses the owner's names, in order", () => {
    expect(AGENT_TYPES.map((t) => t.name)).toEqual(["Daily assistant", "Work assistant", "Coding assistant", "Business manager", "Research assistant", "Something else"]);
  });

  it("merges the picked kinds' apps once each, in order", () => {
    const ids = appsForTypes(["work", "biz"], "", true).map((a) => a.id);
    expect(ids).toEqual(["gmail", "gcal", "gdrive", "slack", "notion", "linear", "jira", "stripe"]);
  });

  it("shows Apple apps only when Bubble AI lives on a Mac, and says so when they're missing", () => {
    expect(appsForTypes(["daily"], "", true).map((a) => a.id).slice(0, 4)).toEqual(["messages", "calendar", "reminders", "contacts"]);
    expect(appsForTypes(["daily"], "", false).some((a) => a.how === "mac")).toBe(false);
    expect(missesMac(["daily"], false)).toBe(true);
    expect(missesMac(["daily"], true)).toBe(false);
    expect(missesMac(["code"], false)).toBe(false);
  });

  it("never fakes an app: every catalog app is a real connector, Google and Vercel included", () => {
    for (const a of Object.values(START_APPS)) if (a.how === "key") expect(CONNECTOR_CATALOG.some((c) => c.id === a.catalogId)).toBe(true);
    for (const id of ["gmail", "gcal", "gdrive", "vercel"]) expect(START_APPS[id]).toMatchObject({ how: "key", catalogId: id });
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

describe("what the first run no longer asks is asked in the chat, one at a time", () => {
  const on = { started: true, youSpoke: true, pingUp: false, guest: false, firstAgent: true };
  it("asks for the phone, apps, away from home and getting to know you, in that order", () => {
    expect(READY_ITEMS.map((i) => i.id)).toEqual(["phone", "apps", "away", "know"]);
    expect(chatAsk({ ...on, rows: readyRows({}) })?.id).toBe("phone");
    expect(chatAsk({ ...on, rows: readyRows({ phone: true }) })?.id).toBe("apps");
    // "Later" moves on to the next one, and leaves that one on Finish setup
    const rows = readyRows({ phone: true, apps: "later" });
    expect(chatAsk({ ...on, rows })?.id).toBe("away");
    expect(rows.filter((r) => !r.done).map((r) => r.id)).toEqual(["apps", "away", "know"]);
    expect(chatAsk({ ...on, rows: readyRows({ phone: true, apps: "later", away: "later", know: true }) })).toBeNull();
    expect(nextAsk(readyRows({ phone: "later" }))?.id).toBe("apps");
  });
  it("waits for an answer to its hello, never talks over the notifications question, and only in the first agent's chat", () => {
    const rows = readyRows({});
    expect(chatAsk({ ...on, rows, youSpoke: false })).toBeNull();
    expect(chatAsk({ ...on, rows, pingUp: true })).toBeNull();
    expect(chatAsk({ ...on, rows, guest: true })).toBeNull();
    expect(chatAsk({ ...on, rows, firstAgent: false })).toBeNull();
    expect(chatAsk({ ...on, rows, started: false })).toBeNull();
  });
  it("each one is a short question with one action of 1 to 3 words, and leads somewhere real", () => {
    for (const i of READY_ITEMS) {
      expect(i.ask.endsWith("?")).toBe(true);
      expect(i.action.split(" ").length).toBeLessThanOrEqual(3);
      expect(i.button.split(" ").length).toBeLessThanOrEqual(2);
      expect(ASK_OPENS[i.id]).toBeTruthy();
    }
    expect(ASK_OPENS.apps).toEqual({ view: "marketplace", section: "apps" });
    expect(ASK_OPENS.away).toEqual({ view: "settings", page: "access" });
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
