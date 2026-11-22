import { token, type Env } from "../../_relay.ts";

/** A hub trades a code or refresh token for tokens (see ../../_relay.ts). */
export const onRequestPost = ({ request, env }: { request: Request; env: Env }) => token(request, env);
