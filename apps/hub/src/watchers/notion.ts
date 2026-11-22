import { getJson, line, pick, WatchError, type Watcher } from "./types.ts";

/** A page's or database's title, from whichever property holds it. */
export function notionTitle(r: any): string {
  const parts = r.object === "database" ? r.title : Object.values(r.properties ?? {}).find((p: any) => p?.type === "title")?.["title" as never];
  return (Array.isArray(parts) ? parts.map((t: any) => t.plain_text ?? "").join("") : "").trim() || "Untitled";
}

export const notion: Watcher = {
  service: "notion",
  name: "Notion",
  catalogIds: ["notion"],
  needs: [["NOTION_TOKEN"]],
  watches: "pages and databases shared with the integration: new ones and edits",
  howToConnect:
    "Use the Notion connector's integration token (ntn_…). Make one at notion.so/profile/integrations → New integration, copy the token, then on each page or teamspace to watch: ••• → Connections → add the integration.",
  everyMinutes: 5,
  minMinutes: 2,
  async poll(ctx) {
    const token = pick(ctx.creds, ["NOTION_TOKEN"]);
    if (!token) throw new WatchError("Notion needs an integration token.", true);
    const r = await getJson(ctx, "https://api.notion.com/v1/search", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "notion-version": "2022-06-28", "content-type": "application/json" },
      body: JSON.stringify({ sort: { direction: "descending", timestamp: "last_edited_time" }, page_size: 50 }),
      app: "Notion",
    });
    const results = (r.results ?? []) as any[];
    const latest = results.map((x) => x.last_edited_time as string).sort().at(-1);
    // the cursor is the newest edit time seen, plus the pages seen at that time: Notion rounds edit times to the
    // minute, so that minute comes back again, and what was already seen in it isn't news (a cursor from before
    // this had no ids; its repeats are dropped when recorded)
    const [at, ids = ""] = (ctx.cursor ?? "").split("|");
    const seen = new Set(ids.split(",").filter(Boolean));
    const stamp = (t: string, also: Iterable<string> = []) => `${t}|${[...new Set([...also, ...results.filter((x) => x.last_edited_time === t).map((x) => x.id as string)])].join(",")}`;
    if (!ctx.cursor) return { cursor: latest ? stamp(latest) : ctx.now.toISOString(), events: [] };
    const fresh = results.filter((x) => (x.last_edited_time > at || (x.last_edited_time === at && !seen.has(x.id))) && !x.archived && !x.in_trash);
    return {
      cursor: latest && latest > at ? stamp(latest) : stamp(at, seen),
      events: fresh.map((x) => ({
        kind: x.created_time >= at ? "created" : "edited",
        itemId: x.id,
        title: line(notionTitle(x), 120) ?? "Untitled",
        url: x.url ?? null,
        actor: x.last_edited_by?.id ?? null,
        preview: x.object === "database" ? "a database" : null,
        happenedAt: x.last_edited_time,
      })),
    };
  },
};
