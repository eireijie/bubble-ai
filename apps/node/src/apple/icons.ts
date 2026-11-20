import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppleApp } from "@wisp/core";
import { exec } from "../computers/driver.ts";

/**
 * The Mac's own app icons, in color: each app's .icns from its bundle, made a 256 px PNG with
 * `sips`, cropped to the squircle (macOS draws icons with transparent padding) and shrunk to 180 px.
 * Not NSWorkspace's icons: with tinted icons turned on those come out gray.
 */
const APPS: Record<AppleApp, string> = {
  messages: "/System/Applications/Messages.app",
  contacts: "/System/Applications/Contacts.app",
  calendar: "/System/Applications/Calendar.app",
  reminders: "/System/Applications/Reminders.app",
  location: "/System/Applications/FindMy.app",
};

let cached: Partial<Record<AppleApp, string>> | null = null;

/** The .icns a bundle names in its Info.plist (CFBundleIconFile, with or without the extension). */
export function iconFileName(plist: string): string | null {
  const name = plist.match(/<key>CFBundleIconFile<\/key>\s*<string>([^<]+)<\/string>/)?.[1]?.trim();
  if (!name) return null;
  return name.endsWith(".icns") ? name : `${name}.icns`;
}

async function plistXml(file: string): Promise<string> {
  // system Info.plists are often binary: plutil turns them into XML on stdout
  const r = await exec("/usr/bin/plutil", ["-convert", "xml1", "-o", "-", file], { timeoutMs: 10_000 });
  return r.code === 0 ? r.stdout.toString("utf8") : "";
}

async function sips(args: string[]) {
  const r = await exec("/usr/bin/sips", args, { timeoutMs: 20_000 });
  if (r.code !== 0) throw new Error(r.stderr.trim() || "sips failed");
}

/** app → base64 PNG (180×180); apps this Mac doesn't have are left out. */
export async function appIcons(): Promise<Partial<Record<AppleApp, string>>> {
  if (cached) return cached;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wisp-icons-"));
  const out: Partial<Record<AppleApp, string>> = {};
  try {
    for (const [app, bundle] of Object.entries(APPS) as [AppleApp, string][]) {
      try {
        const res = path.join(bundle, "Contents", "Resources");
        const named = iconFileName(await plistXml(path.join(bundle, "Contents", "Info.plist")));
        const icns = [named, "AppIcon.icns"].map((n) => n && path.join(res, n)).find((f) => f && fs.existsSync(f));
        if (!icns) continue;
        const big = path.join(dir, `${app}-256.png`);
        const crop = path.join(dir, `${app}-204.png`);
        const small = path.join(dir, `${app}.png`);
        await sips(["-s", "format", "png", "-z", "256", "256", icns, "--out", big]);
        await sips(["-c", "204", "204", big, "--out", crop]);
        await sips(["-z", "180", "180", crop, "--out", small]);
        out[app] = fs.readFileSync(small).toString("base64");
      } catch {
        // one missing icon doesn't stop the rest
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (Object.keys(out).length) cached = out;
  return out;
}
