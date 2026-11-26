import { beforeEach, describe, expect, it, vi } from "vitest";

// The mark's motion must never run at rest: one-offs only, paused while the page is hidden, and with
// reduced motion nothing that moves (canvas "Bubble AI mark motion", 2026-11-25).
const world = vi.hoisted(() => ({ reduced: false, hidden: false, onVisibility: [] as (() => void)[] }));
vi.mock("../src/theme.ts", () => ({ motionReduced: () => world.reduced }));

class FakeAnimation {
  playState = "running";
  private done!: () => void;
  finished = new Promise<void>((r) => (this.done = r));
  iterations = Infinity;
  effect = { getComputedTiming: () => ({ currentIteration: 2 }), updateTiming: (t: { iterations: number }) => (this.iterations = t.iterations) };
  cancel = vi.fn(() => (this.playState = "idle"));
  pause = vi.fn(() => (this.playState = "paused"));
  play = vi.fn(() => (this.playState = "running"));
  addEventListener() {}
  finish() {
    this.playState = "finished";
    this.done();
  }
}
const started: FakeAnimation[] = [];
const el = () => ({ animate: vi.fn(() => (started.push(new FakeAnimation()), started.at(-1)!)), style: {} as Record<string, string>, dataset: {} as Record<string, string> });

vi.stubGlobal("document", {
  get hidden() {
    return world.hidden;
  },
  addEventListener: (type: string, fn: () => void) => type === "visibilitychange" && world.onVisibility.push(fn),
});

const { animate, jolly, liveAnimations, hopSpin, working } = await import("../src/components/markMotion.ts");
const mark = () => {
  const parts = { mv: el(), rot: el(), sq: el(), body: el(), rim: el(), eyes: el(), es: [el(), el()] };
  return { el: el(), ...parts, size: 16 } as never;
};

beforeEach(() => {
  started.length = 0;
  world.reduced = false;
  world.hidden = false;
});

describe("the Bubble AI mark's motion", () => {
  it("forgets an animation once it ends, so nothing is left running", async () => {
    const before = liveAnimations();
    animate(el() as never, [], { duration: 100 });
    expect(liveAnimations()).toBe(before + 1);
    started[0].finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(liveAnimations()).toBe(before);
  });

  it("pauses everything it started while the page is hidden, and picks up again when it shows", () => {
    animate(el() as never, [], { duration: 1000 });
    world.hidden = true;
    world.onVisibility.forEach((f) => f());
    expect(started[0].pause).toHaveBeenCalled();
    world.hidden = false;
    world.onVisibility.forEach((f) => f());
    expect(started[0].play).toHaveBeenCalled();
  });

  it("starts paused when the page is already hidden", () => {
    world.hidden = true;
    animate(el() as never, [], { duration: 1000 });
    expect(started[0].pause).toHaveBeenCalled();
  });

  it("spins and hops on an event, and does nothing that moves with reduced motion", () => {
    jolly(mark());
    expect(started.length).toBeGreaterThan(0);
    started.length = 0;
    world.reduced = true;
    jolly(mark());
    hopSpin(mark());
    expect(started).toHaveLength(0);
  });

  it("the working loop ends on its current turn when it's told to stop, rather than running on", () => {
    const loops = (working(mark()), [...started]);
    expect(loops).toHaveLength(4);
    started.length = 0;
    const w = working(mark());
    void w.stop();
    for (const a of started) expect(a.iterations === 3 || a.playState === "idle").toBe(true);
  });
});
