import { describe, expect, it } from "vitest";
import { CHAPTERS, STOPS, TOTAL, bubbleSpot, cardSpot, chapterProgress, cleanSeen, curveControl, curvePoint, eyebrow, flightMs, resumeIndex, resumeLabel, seenCount, stopBody, stopsFor, withSeen } from "./tour.ts";

const view = { w: 1440, h: 900 };

describe("Show me around stops", () => {
  it("is 25 stops in 5 chapters: Talk 5, Hands-off 4, Tools 5, Memory and teams 5, Make it yours 6", () => {
    expect(TOTAL).toBe(25);
    expect(CHAPTERS).toEqual(["Talk", "Hands-off", "Tools", "Memory and teams", "Make it yours"]);
    expect(CHAPTERS.map((_, ch) => STOPS.filter((s) => s.ch === ch).length)).toEqual([5, 4, 5, 5, 6]);
    // in chapter order, each id once
    expect(STOPS.map((s) => s.ch)).toEqual([...STOPS.map((s) => s.ch)].sort((a, b) => a - b));
    expect(new Set(STOPS.map((s) => s.id)).size).toBe(TOTAL);
  });

  it("points every stop at something, and gives a fallback line only where the last target is a stand-in", () => {
    for (const s of STOPS) {
      expect(s.targets.length, s.id).toBeGreaterThan(0);
      if (s.fallbackBody) expect(s.targets.length, s.id).toBeGreaterThan(1);
    }
  });

  it("offers a switch only for the mods that start off, and never teaches the password vault or the Code mod", () => {
    expect(STOPS.filter((s) => s.mod).map((s) => [s.id, s.mod])).toEqual([
      ["message-first", "background"],
      ["schedules", "routines"],
      ["mods", "tasks"],
    ]);
    const words = STOPS.map((s) => `${s.title} ${s.body} ${s.fallbackBody ?? ""}`).join(" ").toLowerCase();
    expect(words).not.toMatch(/password vault|code mod|screen watch/);
  });

  it("leaves guests the stops they can open", () => {
    const g = stopsFor(true);
    expect(g.length).toBeLessThan(TOTAL);
    expect(g.every((s) => !s.noGuests)).toBe(true);
    expect(g.map((s) => s.id)).toContain("write");
    expect(g.map((s) => s.id)).not.toContain("usage");
    expect(stopsFor(false)).toBe(STOPS);
  });
});

describe("progress", () => {
  it("counts only stops that still exist, once each", () => {
    expect(cleanSeen(["write", "write", "gone", "attach"])).toEqual(["write", "attach"]);
    expect(seenCount({ seen: ["write", "attach", "gone"] })).toBe(2);
    expect(seenCount(undefined)).toBe(0);
  });

  it("resumes at the first stop not seen, and starts over when all are", () => {
    expect(resumeIndex(undefined)).toBe(0);
    expect(resumeIndex({ seen: ["write", "attach", "slash"] })).toBe(3);
    expect(resumeIndex({ seen: ["attach"] })).toBe(0);
    expect(resumeIndex({ seen: STOPS.map((s) => s.id) })).toBe(0);
  });

  it("says Show me around, Resume or Start again", () => {
    expect(resumeLabel(undefined)).toBe("Show me around");
    expect(resumeLabel({ seen: ["write"] })).toBe("Resume");
    expect(resumeLabel({ seen: STOPS.map((s) => s.id) })).toBe("Start again");
  });

  it("adds a stop once, marks the tour started, and keeps the same object when nothing changes", () => {
    const a = withSeen(undefined, "write");
    expect(a).toEqual({ seen: ["write"], started: true });
    expect(withSeen(a, "write")).toBe(a);
    expect(withSeen(a, "attach")).toEqual({ seen: ["write", "attach"], started: true });
    // seen but never marked started (an old save): mark it
    expect(withSeen({ seen: ["write"] }, "write")).toEqual({ seen: ["write"], started: true });
  });

  it("gives each chapter its first stop and how much is seen", () => {
    const c = chapterProgress({ seen: ["write", "attach", "your-turn"] });
    expect(c.map((x) => [x.name, x.first, x.seen, x.total])).toEqual([
      ["Talk", 0, 2, 5],
      ["Hands-off", 5, 1, 4],
      ["Tools", 9, 0, 5],
      ["Memory and teams", 14, 0, 5],
      ["Make it yours", 19, 0, 6],
    ]);
  });

  it("writes the card's eyebrow", () => {
    expect(eyebrow(0)).toBe("Chapter 1 of 5 · Talk · 1 of 5");
    expect(eyebrow(5)).toBe("Chapter 2 of 5 · Hands-off · 1 of 4");
    expect(eyebrow(24)).toBe("Chapter 5 of 5 · Make it yours · 6 of 6");
  });
});

describe("what a stop says", () => {
  const write = STOPS.find((s) => s.id === "write")!;
  const pins = STOPS.find((s) => s.id === "pins")!;
  const computers = STOPS.find((s) => s.id === "computers")!;

  it("uses the fallback line when it points at a stand-in", () => {
    expect(stopBody(pins, { fallback: true, phone: false })).toBe(pins.fallbackBody);
    expect(stopBody(pins, { fallback: false, phone: false })).toBe(pins.body);
  });

  it("says press and hold on phones, and leaves out what phones don't show", () => {
    expect(stopBody(write, { fallback: false, phone: true })).toContain("Press and hold a message");
    expect(stopBody(write, { fallback: false, phone: false })).toContain("Right-click a message");
    expect(stopBody(computers, { fallback: false, phone: true })).not.toContain("dot");
  });
});

describe("the flight", () => {
  it("curves from start to end", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 400, y: 0 };
    const c = curveControl(a, b);
    expect(curvePoint(a, c, b, 0)).toEqual(a);
    expect(curvePoint(a, c, b, 1)).toEqual(b);
    expect(curvePoint(a, c, b, 0.5).y).not.toBe(0);
  });

  it("takes longer the further it goes, between 0.6 and 1.25 s", () => {
    expect(flightMs({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(600);
    expect(flightMs({ x: 0, y: 0 }, { x: 5000, y: 0 })).toBe(1250);
    expect(flightMs({ x: 0, y: 0 }, { x: 700, y: 0 })).toBeGreaterThan(600);
  });
});

describe("where the bubble and card go", () => {
  it("sits on the stop's side when there's room, else the roomiest side, inside the window", () => {
    const mid = { left: 600, top: 400, width: 200, height: 40 };
    expect(bubbleSpot(mid, "right", 46, view).side).toBe("right");
    expect(bubbleSpot(mid, "top", 46, view).side).toBe("top");
    // flush against the right edge: no room on the right
    const edge = { left: 1300, top: 400, width: 140, height: 40 };
    const s = bubbleSpot(edge, "right", 46, view);
    expect(s.side).not.toBe("right");
    expect(s.x).toBeLessThanOrEqual(view.w - 23);
    // a target filling the window still keeps the bubble on screen
    const all = bubbleSpot({ left: 0, top: 0, width: 1440, height: 900 }, "left", 46, view);
    expect(all.x).toBeGreaterThanOrEqual(23);
    expect(all.y).toBeGreaterThanOrEqual(23);
  });

  it("never puts the card on the target on desktop", () => {
    const target = { left: 300, top: 820, width: 800, height: 60 };
    const bubble = bubbleSpot(target, "top", 46, view);
    const c = cardSpot(bubble, target, { w: 316, h: 150 }, 46, view);
    const overlaps = c.left < target.left + target.width && c.left + 316 > target.left && c.top < target.top + target.height && c.top + 150 > target.top;
    expect(overlaps).toBe(false);
    expect(c.docked).toBeNull();
  });

  it("docks the card on phones: at the bottom, or the top when the target is low", () => {
    const phone = { w: 390, h: 844 };
    const high = { left: 10, top: 40, width: 370, height: 40 };
    const low = { left: 10, top: 780, width: 370, height: 50 };
    expect(cardSpot(bubbleSpot(high, "right", 46, phone), high, { w: 366, h: 150 }, 46, phone).docked).toBe("bottom");
    expect(cardSpot(bubbleSpot(low, "top", 46, phone), low, { w: 366, h: 150 }, 46, phone).docked).toBe("top");
  });
});
