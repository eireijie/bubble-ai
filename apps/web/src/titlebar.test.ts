import { describe, expect, it, vi } from "vitest";
vi.mock("./store.ts", () => ({ useStore: () => null }));
vi.mock("./features.ts", () => ({ useFeature: () => false }));
const { hexColor } = await import("./desktop.ts");

describe("hexColor (Windows title bar buttons follow the page's colours)", () => {
  it("turns computed colours into hex", () => {
    expect(hexColor("rgb(18, 17, 22)")).toBe("#121116");
    expect(hexColor("rgba(255, 255, 255, 1)")).toBe("#ffffff");
  });
  it("skips colours the title bar can't use", () => {
    expect(hexColor("rgba(0, 0, 0, 0)")).toBeNull();
    expect(hexColor("transparent")).toBeNull();
  });
});
