import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { discoverAvailable, discoverPart, factsFromNotes, projectNameFromDir } from "../src/discover.ts";

describe("look around this computer", () => {
  it("only on a Mac or PC", () => {
    expect(discoverAvailable("darwin")).toBe(true);
    expect(discoverAvailable("win32")).toBe(true);
    expect(discoverAvailable("linux")).toBe(false);
  });

  it("keeps short rules from instruction files, never secrets, code or paths", () => {
    const md = [
      "# Me",
      "Some prose that is not a bullet.",
      "- Keep answers short, no fluff.",
      "- Run tests before opening a PR",
      "- api key: sk-ant-abcdefghijklmnopqrstuv",
      "- Card 4111 1111 1111 1111",
      "- Use `npm run x` in /Users/sam/app",
      "- ok",
    ].join("\n");
    expect(factsFromNotes(md, "CLAUDE.md").map((f) => f.text)).toEqual(["Keep answers short, no fluff", "Run tests before opening a PR"]);
  });

  it("names projects from Claude Code's folders, skipping worktrees and temp", () => {
    expect(projectNameFromDir("-Users-sam-code-shop")).toBe("shop");
    expect(projectNameFromDir("-Users-sam-kodi--claude-worktrees-x-y")).toBeNull();
    expect(projectNameFromDir("-private-tmp-abc")).toBeNull();
    expect(projectNameFromDir("-Users-sam-Downloads-769e37")).toBeNull();
    expect(projectNameFromDir("-Users-sam-Downloads-542756")).toBeNull();
  });

  it("reads notes and recent projects from a home folder", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "wisp-discover-"));
    await fs.mkdir(path.join(home, ".claude/projects/-Users-sam-code-shop"), { recursive: true });
    // generic folder names say nothing about the work
    await fs.mkdir(path.join(home, ".claude/projects/-Users-sam-files"), { recursive: true });
    await fs.mkdir(path.join(home, ".claude/projects/-Users-sam-code-shop-src"), { recursive: true });
    await fs.writeFile(path.join(home, ".claude/CLAUDE.md"), "- Prefer plain words over jargon\n");
    const notes = await discoverPart("notes", home);
    expect(notes).toEqual({ found: "1 file", facts: [{ group: "Likes", text: "Prefer plain words over jargon", src: "CLAUDE.md" }] });
    const projects = await discoverPart("projects", home);
    expect(projects.facts.map((f) => f.text)).toEqual(["shop"]);
    await fs.rm(home, { recursive: true, force: true });
  });
});
