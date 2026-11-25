import { describe, expect, it } from "vitest";
import { linkPreviews, titleFromUrl } from "./linkPreview.ts";

describe("link cards", () => {
  it("builds a title and domain from the link, and shows pictures on top", () => {
    const p = linkPreviews("see https://www.example.com/blog/how-we-ship-fast. and https://cdn.example.org/a/cat.png too");
    expect(p).toEqual([
      { url: "https://www.example.com/blog/how-we-ship-fast", domain: "example.com", title: "How we ship fast" },
      { url: "https://cdn.example.org/a/cat.png", domain: "cdn.example.org", title: "Cat", image: "https://cdn.example.org/a/cat.png" },
    ]);
  });
  it("leaves out GitHub PRs and issues (they have their own card), repeats, local links, and stops at two", () => {
    expect(linkPreviews("https://github.com/a/b/pull/3 http://localhost:5861/x https://a.com https://a.com https://b.com https://c.com").map((p) => p.domain)).toEqual(["a.com", "b.com"]);
  });
  it("falls back to the site's name", () => {
    expect(titleFromUrl(new URL("https://news.site.com/12345"))).toBe("News.site.com");
  });
});
