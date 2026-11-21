import { describe, expect, it, vi } from "vitest";

// No DOM in this test environment; the remote-image rewrite happens before sanitizing, so pass-through is enough.
vi.mock("dompurify", () => ({ default: { sanitize: (h: string) => h, addHook: () => {} } }));

import { isRemoteImage, renderMarkdown } from "./markdown.ts";

describe("markdown remote images", () => {
  it("renders a remote image as a link that opens safely in a new tab", () => {
    const html = renderMarkdown("![a cat](https://tracker.example.com/pixel.png?u=1)");
    expect(html).not.toContain("<img");
    expect(html).toContain('href="https://tracker.example.com/pixel.png?u=1"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("Image: a cat");
  });

  it("falls back to the host when there is no alt text, including protocol-relative urls", () => {
    expect(renderMarkdown("![](http://evil.test/x.gif)")).toContain("Image: evil.test");
    expect(renderMarkdown("![](//evil.test/x.gif)")).not.toContain("<img");
  });

  it("keeps same-origin, data and blob images inline", () => {
    expect(renderMarkdown("![x](/api/files/abc)")).toContain("<img");
    expect(renderMarkdown("![x](data:image/png;base64,AAAA)")).toContain("<img");
    expect(renderMarkdown("![x](blob:http://localhost/1234)")).toContain("<img");
  });

  it("classifies addresses", () => {
    expect(isRemoteImage("https://a.example/x.png")).toBe(true);
    expect(isRemoteImage("HTTP://a.example/x.png")).toBe(true);
    expect(isRemoteImage("/x.png")).toBe(false);
    expect(isRemoteImage("data:image/gif;base64,R0lG")).toBe(false);
  });
});
