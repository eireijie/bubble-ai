import { callback } from "../_relay.ts";

/** GitHub, Slack and Google send the browser here after signing in (see ../_relay.ts). */
export const onRequestGet = ({ request }: { request: Request }) => callback(request);
