// Types for bridge.mjs, for Wisp's own tests (the bridge itself runs as plain JavaScript in its image).
import type http from "node:http";

export interface BwItem {
  id: string;
  name?: string;
  type: number;
  folderId?: string | null;
  collectionIds?: string[];
  deletedDate?: string | null;
  login?: { username?: string | null; password?: string | null; totp?: string | null; uris?: { uri: string }[] };
}
export interface BwLike {
  unlock(creds: { email?: string; clientId?: string; clientSecret?: string; password: string }): Promise<string>;
  logout(): Promise<void>;
  sync(session: string): Promise<void>;
  items(session: string): Promise<BwItem[]>;
  folders(session: string): Promise<{ id: string; name: string }[]>;
  collections(session: string): Promise<{ id: string; name: string }[]>;
  item(session: string, id: string): Promise<BwItem>;
  totp(session: string, id: string): Promise<string>;
}
export function siteOf(url: string): string | null;
export class BridgeError extends Error {
  constructor(message: string, status?: number);
  status: number;
}
export class BwCli implements BwLike {
  constructor(opts: { bin?: string; appDir: string; server: string });
  unlock(creds: { email?: string; clientId?: string; clientSecret?: string; password: string }): Promise<string>;
  logout(): Promise<void>;
  sync(session: string): Promise<void>;
  items(session: string): Promise<BwItem[]>;
  folders(session: string): Promise<{ id: string; name: string }[]>;
  collections(session: string): Promise<{ id: string; name: string }[]>;
  item(session: string, id: string): Promise<BwItem>;
  totp(session: string, id: string): Promise<string>;
}
export class Bridge {
  constructor(opts: { bw: BwLike; dataDir: string; now?: () => number });
  start(): Promise<void>;
  status(): { state: "not_connected" | "locked" | "ready"; account: string | null; lockOnRestart: boolean; problem: string | null };
  connectCode(): { code: string; expiresAt: string };
  connect(body: unknown): Promise<{ account: string; count: number; agentsFound: boolean }>;
  forget(): Promise<void>;
  list(fresh?: boolean): Promise<{ id: string; title: string; site: string; username: string; hasOtp: boolean }[]>;
  ticket(body: unknown): Promise<{ ticket: string; expiresAt: string }>;
  redeem(body: unknown): Promise<{ username: string; password: string; otp?: string }>;
}
export function createServer(bridge: Bridge, opts: { hubToken: string | undefined; redeemToken: string | undefined; log?: (line: string) => void }): http.Server;
