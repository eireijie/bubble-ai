// The desktop app's own Bubble AI carries Git on Windows (apps/desktop/scripts/bundle-bubble-ai.mjs),
// where it usually isn't installed and the hub can't start without it: the vault is a git repository.
// It goes on PATH after the person's own Git, so one they installed still wins.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  const cmd = fileURLToPath(new URL("../git/cmd", import.meta.url));
  if (fs.existsSync(path.join(cmd, "git.exe"))) {
    const dirs = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
    if (!dirs.some((dir) => path.resolve(dir).toLowerCase() === cmd.toLowerCase())) process.env.PATH = [...dirs, cmd].join(path.delimiter);
  }
}
