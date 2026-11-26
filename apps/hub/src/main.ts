import os from "node:os";
import { migrateHomes, migrateDataDir, defaultHubDataDir } from "../../node/src/migrate-home.ts";
import { envVar } from "@bubble-ai/core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RESTART_CODE, underKeeper, watchForUpdates } from "@bubble-ai/update";
import { advertiseWisp } from "./discovery.ts";
import { buildHub } from "./app.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const home = migrateHomes({ home: os.homedir(), log: console.log });
const dataDir = path.resolve(migrateDataDir(envVar("DATA_DIR") ?? envVar("DEFAULT_DATA_DIR") ?? defaultHubDataDir(home.dir, undefined, console.log), console.log));
const webDir = path.resolve(envVar("WEB_DIR") ?? path.join(here, "../../web/dist"));
const port = Number(process.env.PORT ?? 4747);
const host = process.env.HOST ?? "0.0.0.0";

const { app, hub, setupCode } = await buildHub({ dataDir, webDir, logger: true });
let stopDiscovery: () => void | Promise<void> = () => {};
app.addHook("onListen", async () => {
  const address = app.server.address();
  const listeningPort = address && typeof address === "object" ? address.port : port;
  stopDiscovery = advertiseWisp(dataDir, listeningPort, () => hub.store.firstWorkspace()?.name, (error) => app.log.warn({ error }, "Bubble AI discovery is unavailable"));
});
app.addHook("preClose", async () => { await stopDiscovery(); });
await app.listen({ port, host });
app.log.info(`Bubble AI on http://localhost:${port} (data: ${dataDir})`);
if (setupCode.code) app.log.info(`Set up Bubble AI at http://localhost:${port}/#/setup/${setupCode.code} (setup code ${setupCode.code}, also in ${path.join(dataDir, "setup-code")})`);

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => app.close().then(() => process.exit(0)));

// an update (from Settings, a device sharing this folder, or `bubble-ai update`) restarts the hub
const kept = underKeeper();
watchForUpdates(() => {
  if (!kept) return app.log.warn("Bubble AI was updated; restart the hub to use the new version");
  app.log.info("Bubble AI was updated; restarting");
  app.close().then(() => process.exit(RESTART_CODE));
});
