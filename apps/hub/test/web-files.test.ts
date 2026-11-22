import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import type { FastifyInstance } from "fastify";
import { buildHub } from "../src/app.ts";

// The web build leaves a .br and a .gz beside each file (apps/web/vite.config.ts). The hub sends the
// one a browser accepts, the plain file to anything else, and the same bytes come out either way.

let dir: string;
let app: FastifyInstance;
const script = `console.log(${JSON.stringify("wisp ".repeat(800))});\n`;
const page = `<!doctype html><title>Wisp</title>${"<p>hello</p>".repeat(200)}`;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "wisp-web-files-"));
  const web = path.join(dir, "web");
  await fs.mkdir(path.join(web, "assets"), { recursive: true });
  for (const [file, text] of [["assets/index-abc123.js", script], ["index.html", page]] as const) {
    await fs.writeFile(path.join(web, file), text);
    await fs.writeFile(path.join(web, `${file}.br`), zlib.brotliCompressSync(text));
    await fs.writeFile(path.join(web, `${file}.gz`), zlib.gzipSync(text));
  }
  // a build from before the copies were written: only the plain file
  await fs.writeFile(path.join(web, "assets/old-def456.js"), script);
  app = (await buildHub({ dataDir: path.join(dir, "data"), webDir: web, setupCode: false })).app;
});

afterAll(async () => {
  await app.close();
  await fs.rm(dir, { recursive: true, force: true });
});

const get = (url: string, accept?: string) => app.inject({ method: "GET", url, headers: accept ? { "accept-encoding": accept } : {} });

describe("the web app's files", () => {
  it("sends the brotli copy to a browser that takes it, then gzip, then the file as it is", async () => {
    const br = await get("/assets/index-abc123.js", "gzip, deflate, br");
    expect(br.statusCode).toBe(200);
    expect(br.headers["content-encoding"]).toBe("br");
    expect(br.rawPayload.length).toBeLessThan(script.length / 4);
    expect(zlib.brotliDecompressSync(br.rawPayload).toString()).toBe(script);

    const gz = await get("/assets/index-abc123.js", "gzip");
    expect(gz.headers["content-encoding"]).toBe("gzip");
    expect(zlib.gunzipSync(gz.rawPayload).toString()).toBe(script);

    const plain = await get("/assets/index-abc123.js");
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.payload).toBe(script);
  });

  it("keeps the type and the caching it had: hashed files for good, the page checked every time", async () => {
    for (const accept of ["br", undefined]) {
      const asset = await get("/assets/index-abc123.js", accept);
      expect(asset.headers["content-type"]).toMatch(/javascript/);
      expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
      const shell = await get("/", accept);
      expect(shell.headers["content-type"]).toMatch(/text\/html/);
      expect(shell.headers["cache-control"]).toBe("no-cache");
    }
  });

  it("serves any page address with the app, compressed too, and never a missing script", async () => {
    const deep = await get("/some/page", "br");
    expect(deep.statusCode).toBe(200);
    expect(deep.headers["content-encoding"]).toBe("br");
    expect(zlib.brotliDecompressSync(deep.rawPayload).toString()).toBe(page);
    expect((await get("/assets/gone-000.js", "br")).statusCode).toBe(404);
  });

  it("sends a file that has no copies as it is", async () => {
    const res = await get("/assets/old-def456.js", "gzip, deflate, br");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.payload).toBe(script);
  });
});
