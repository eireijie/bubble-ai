import { apps, type Env } from "../../_relay.ts";

/** Which of Bubble AI's sign-in apps are set up, so hubs offer Sign in only where it works. */
export const onRequestGet = ({ env }: { env: Env }) => new Response(JSON.stringify(apps(env)), { headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });
