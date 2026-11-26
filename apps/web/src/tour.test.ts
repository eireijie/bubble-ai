import { describe, expect, it } from "vitest";
import { CHAPTERS, STOPS, TOTAL, bubbleSpot, cardSpot, cleanSeen, curveControl, curvePoint, flightMs, resumeIndex, resumeLabel, seenCount, stopBody, stopTitle, stopsFor, withSeen } from "./tour.ts";

const view = { w: 1440, h: 900 };

describe("Show me around stops", () => {
  it("is four stops, each one done for real", () => {
    expect(TOTAL).toBe(4);
    expect(CHAPTERS).toEqual(["Show me around"]);
    expect(STOPS.map((s) => [s.id, s.doIt])).toEqual([
      ["write", "send"],
      ["slash", "slash"],
      ["your-turn", "yourturn"],
      ["new", "click"],
    ]);
    expect(STOPS.every((s) => s.targets.length > 0 && s.title.length <= 24 && s.body.length <= 60)).toBe(true);
  });

  it("puts the agent's name in the first stop", () => {
    expect(stopTitle(STOPS[0], "Juno")).toBe("Say hi to Juno");
    expect(stopTitle(STOPS[0], "")).toBe("Say hi to your agent");
  });

  it("leaves guests the stops they can open", () => {
    const g = stopsFor(true);
    expect(g.map((s) => s.id)).toEqual(["write", "slash", "your-turn"]);
    expect(stopsFor(false)).toBe(STOPS);
  });

  it("counts only stops that still exist, once each", () => {
    expect(cleanSeen(["write", "write", "gone", "attach"])).toEqual(["write"]);
    expect(seenCount({ seen: ["write", "slash", "gone"] })).toBe(2);
    expect(seenCount(undefined)).toBe(0);
  });

  it("resumes at the first stop not seen, and starts over when all are", () => {
    expect(resumeIndex(undefined)).toBe(0);
    expect(resumeIndex({ seen: ["write", "slash"] })).toBe(2);
    expect(resumeIndex({ seen: ["slash"] })).toBe(0);
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
    expect(withSeen(a, "slash")).toEqual({ seen: ["write", "slash"], started: true });
  });
});

describe("what a stop says", () => {
  it("says press and hold on phones", () => {
    expect(stopBody({ ...STOPS[0], body: "Right-click it." }, { fallback: false, phone: true })).toBe("Press and hold it.");
    expect(stopBody(STOPS[0], { fallback: false, phone: false })).toBe(STOPS[0].body);
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
