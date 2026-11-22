import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AddRow, AppTile, fewWords, matchWords, queryWords, rowsShown, sectionWord } from "./MarketParts.tsx";

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

  it("follows the same rule at a row's 36 px and a page's 56 px", () => {
    for (const size of [36, 56]) {
      const html = renderToStaticMarkup(<AppTile name="Gmail" size={size} />);
      expect(html).toContain("<svg");
      expect(html).not.toContain("bg-white");
      expect(html).toContain(`width:${size}px`);
    }
  });
});

describe("a row on the Add page", () => {
  it("is a tile, the name, a few muted words and one thing at the right; the name opens its page", () => {
    const html = renderToStaticMarkup(<AddRow tile={<i data-tile />} name="GitHub" words="Developer" action={<button>Add</button>} onOpen={() => {}} />);
    expect(html).toMatch(/<button[^>]*>.*data-tile.*GitHub.*Developer.*<\/button><button>Add<\/button>/);
  });

  it("keeps a status (a check, Sign in again) inside what opens the page", () => {
    const html = renderToStaticMarkup(<AddRow tile={<i />} name="Gmail" status={<b>Sign in again</b>} onOpen={() => {}} />);
    expect(html).toMatch(/<button[^>]*>.*Gmail.*Sign in again.*<\/button><\/div>$/);
  });

  it("cuts a line to at most four words, without the punctuation left hanging", () => {
    expect(fewWords("Issues, pull requests, code search and repos, through GitHub's own MCP server.")).toBe("Issues, pull requests, code");
    expect(fewWords("Email.")).toBe("Email");
    expect(fewWords("  Read   channels and threads, post messages", 3)).toBe("Read channels and");
    expect(fewWords(null)).toBe("");
  });
});

describe("searching the Add page", () => {
  it("shows one whole section when the word names it, as the old tabs did", () => {
    expect(sectionWord("apps")).toBe("apps");
    expect(sectionWord(" Skills ")).toBe("skills");
    expect(sectionWord("mod")).toBe("mods");
    expect(sectionWord("installed")).toBe("added");
    expect(sectionWord("devices")).toBe("found");
    expect(sectionWord("github")).toBeNull();
    expect(sectionWord("skills for email")).toBeNull();
  });

  it("matches a category or a maker as the chips did, and every word typed", () => {
    const github = ["GitHub", "Issues, pull requests, code search and repos.", "Developer", "Wisp"];
    expect(matchWords(queryWords("developer"), github)).toBe(true);
    expect(matchWords(queryWords("Anthropic"), ["PDF", "Read and fill in PDFs", "Anthropic"])).toBe(true);
    expect(matchWords(queryWords("pull developer"), github)).toBe(true);
    expect(matchWords(queryWords("pull finance"), github)).toBe(false);
    expect(matchWords(queryWords(""), github)).toBe(true);
    expect(matchWords(queryWords("x"), [null, undefined])).toBe(false);
  });

  it("shows a few rows of a section until Show all, and more while searching", () => {
    expect(rowsShown(40, false, false)).toBe(5);
    expect(rowsShown(3, false, false)).toBe(3);
    expect(rowsShown(40, false, true)).toBe(12);
    expect(rowsShown(40, true, false)).toBe(40);
  });
});
