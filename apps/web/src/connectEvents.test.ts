import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectEvents } from "./api.ts";

/**
 * The live connection is opened in an effect and let go in its cleanup. A socket's "close" arrives
 * some time after close() is called, so a connection that was let go must say "disconnected" at
 * once and then stay silent: its late close (or a late event) must not reach the app after the
 * next connection is already up, or the app sits "offline" while it is connected.
 */

class FakeSocket {
  static all: FakeSocket[] = [];
  static CLOSED = 3;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  /** like a browser: the close event comes later, when the test says so */
  close() {
    this.readyState = 2;
  }
  ready() {
    this.readyState = 1;
    this.onopen?.();
    this.onmessage?.({ data: JSON.stringify({ type: "ready" }) });
  }
  closed() {
    this.readyState = 3;
    this.onclose?.();
  }
}

beforeEach(() => {
  FakeSocket.all = [];
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("location", { protocol: "http:", host: "wisp.test" });
  vi.stubGlobal("localStorage", { getItem: () => "token", setItem: () => {}, removeItem: () => {} });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The socket opens a tick after connectEvents is called. */
const opened = () => Promise.resolve();

describe("connectEvents", () => {
  it("a connection that was let go says so once, then stays silent", async () => {
    const status: boolean[] = [];
    const events: unknown[] = [];
    const stop = connectEvents((e) => events.push(e), (c) => status.push(c));
    await opened();
    const first = FakeSocket.all[0];
    first.ready();
    expect(status).toEqual([true]);

    stop();
    expect(status).toEqual([true, false]);

    // the next connection (a remount) comes up before the first one's close arrives
    const later: boolean[] = [];
    const stopSecond = connectEvents(() => {}, (c) => later.push(c));
    await opened();
    FakeSocket.all[1].ready();
    first.onmessage?.({ data: JSON.stringify({ type: "channels_changed" }) });
    first.closed();
    vi.runOnlyPendingTimers();

    expect(status).toEqual([true, false]);
    expect(events).toEqual([]);
    expect(later).toEqual([true]);
    // and it does not come back by itself
    expect(FakeSocket.all).toHaveLength(2);
    stopSecond();
  });

  it("run, undone and run again at once (React's development check) opens one socket, not two", async () => {
    const status: boolean[] = [];
    connectEvents(() => {}, (c) => status.push(c))();
    const stop = connectEvents(() => {}, (c) => status.push(c));
    await opened();
    expect(FakeSocket.all).toHaveLength(1);
    FakeSocket.all[0].ready();
    expect(status).toEqual([false, true]);
    stop();
  });

  it("a connection that drops says so and tries again", async () => {
    const status: boolean[] = [];
    const stop = connectEvents(() => {}, (c) => status.push(c));
    await opened();
    FakeSocket.all[0].ready();
    FakeSocket.all[0].closed();
    expect(status).toEqual([true, false]);
    vi.advanceTimersByTime(500);
    expect(FakeSocket.all).toHaveLength(2);
    FakeSocket.all[1].ready();
    expect(status).toEqual([true, false, true]);
    stop();
  });
});
