import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AppTile } from "./MarketParts.tsx";

// the shared UI file pulls in the theme, which reads the browser window as it loads
vi.mock("./ui.tsx", () => ({ Modal: () => null, cx: (...parts: unknown[]) => parts.filter(Boolean).join(" ") }));

/**
 * Desktop 0.0.13 showed empty white squares where app logos belong: the tile turned white as soon as
 * it had an address to try, and the image was lazy, so a logo that was slow, held back by a busy
 * hub, or never asked for left a blank square. What a tile draws before any logo has loaded is
 * what these check.
 */
describe("AppTile", () => {
  it("shows the line icon, not an empty white square, until a logo has loaded", () => {
    const html = renderToStaticMarkup(<AppTile name="GitHub" />);
    // the line icon is there
    expect(html).toContain("<svg");
    // and the white logo square isn't, yet
    expect(html).not.toContain("bg-white");
    // the logo is being fetched, out of sight
    expect(html).toMatch(/<img[^>]*src="\/api\/logo\?for=GitHub"/);
    expect(html).toMatch(/<img[^>]*display:\s*none/);
  });

  it("asks for the logo right away: a lazy image never loads on a page the window isn't drawing", () => {
    expect(renderToStaticMarkup(<AppTile name="Slack" />)).not.toContain('loading="lazy"');
  });

  it("tries the registry's own icon first, then the brand's logo from the hub", () => {
    const html = renderToStaticMarkup(<AppTile name="Notion" entry={{ id: "com.notion/mcp", name: "Notion", brand: "notion", icon: "https://example.com/notion.png" }} />);
    expect(html).toContain('src="https://example.com/notion.png"');
    expect(html).not.toContain("bg-white");
  });

  it("draws only the icon it was given when there is one", () => {
    const html = renderToStaticMarkup(<AppTile name="Files" icon={<i data-own-icon />} />);
    expect(html).toContain("data-own-icon");
    expect(html).not.toContain("<img");
  });
});
