import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Problem } from "../src/components/ui.tsx";
import { ApiError, errorDetails } from "../src/api.ts";

vi.mock("../src/theme.ts", () => ({ motionReduced: () => false }));

describe("a problem with a tool's output behind it", () => {
  it("says it plainly and folds the raw log under Details", () => {
    const html = renderToStaticMarkup(createElement(Problem, { text: "Couldn't reach npm from Mac.", details: "npm error code ENOTFOUND" }));
    expect(html).toContain("Couldn&#x27;t reach npm from Mac.");
    expect(html).toMatch(/<details[^>]*><summary[^>]*>Details<\/summary><pre[^>]*>npm error code ENOTFOUND<\/pre><\/details>/);
    expect(renderToStaticMarkup(createElement(Problem, { text: "Mac is paused" }))).not.toContain("Details");
  });

  it("keeps the hub's details on the error", () => {
    expect(errorDetails(new ApiError("Codex didn't install.", 422, "npm error boom"))).toBe("npm error boom");
    expect(errorDetails(new Error("x"))).toBeNull();
  });
});
