import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.ts";
import { useAccessStore, type AccessInfo } from "./access.ts";

vi.mock("./api.ts", () => ({ api: vi.fn() }));

/**
 * The hub's address is asked for every few seconds while a page shows it. An answer that says the
 * same as the last one must not count as news: every page reading it would render again on each
 * tick, and the screen never comes to rest.
 */
const answer = (state: AccessInfo["tailscale"]["state"]): AccessInfo => ({ publicUrl: null, lan: ["192.168.1.20"], tailscale: { state, dnsName: null, serving: false, funnel: false }, download: "", hubPlatform: "darwin" }) as AccessInfo;

beforeEach(() => {
  vi.mocked(api).mockReset();
  useAccessStore.setState({ info: null, failed: false });
});

describe("access polling", () => {
  it("the same answer again tells nobody; a different one does", async () => {
    // a new object every time, as each fetch gives
    vi.mocked(api).mockImplementation(async () => answer("stopped"));
    await useAccessStore.getState().refresh();
    const first = useAccessStore.getState().info;
    expect(first?.tailscale.state).toBe("stopped");

    let told = 0;
    const stop = useAccessStore.subscribe(() => told++);
    await useAccessStore.getState().refresh();
    await useAccessStore.getState().refresh();
    expect(told).toBe(0);
    expect(useAccessStore.getState().info).toBe(first);

    vi.mocked(api).mockImplementation(async () => answer("running"));
    await useAccessStore.getState().refresh();
    expect(told).toBe(1);
    expect(useAccessStore.getState().info?.tailscale.state).toBe("running");
    stop();
  });

  it("a hub that stops answering is said once, and its return is noticed", async () => {
    vi.mocked(api).mockImplementation(async () => answer("running"));
    await useAccessStore.getState().refresh();
    let told = 0;
    const stop = useAccessStore.subscribe(() => told++);
    vi.mocked(api).mockRejectedValue(new Error("down"));
    await useAccessStore.getState().refresh();
    await useAccessStore.getState().refresh();
    expect(told).toBe(1);
    expect(useAccessStore.getState().failed).toBe(true);

    vi.mocked(api).mockImplementation(async () => answer("running"));
    await useAccessStore.getState().refresh();
    expect(told).toBe(2);
    expect(useAccessStore.getState().failed).toBe(false);
    stop();
  });
});
