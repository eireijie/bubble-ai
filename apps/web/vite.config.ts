import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * After a build, write a brotli and a gzip copy beside every text file in dist. The hub sends the
 * copy a browser accepts (apps/hub/src/app.ts, preCompressed), so a phone or a browser reaching Bubble AI
 * from outside downloads about a quarter of the bytes. Nothing changes for `vite dev`.
 */
function precompress(): Plugin {
  let outDir = "";
  return {
    name: "wisp-precompress",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
      if (!fs.existsSync(outDir)) return;
      for (const file of walk(outDir)) {
        if (!/\.(js|css|html|svg|json|webmanifest|txt)$/.test(file)) continue;
        const raw = fs.readFileSync(file);
        // tiny files don't get smaller in any way that matters
        if (raw.length < 1024) continue;
        fs.writeFileSync(`${file}.br`, zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }));
        fs.writeFileSync(`${file}.gz`, zlib.gzipSync(raw, { level: 9 }));
      }
    },
  };
}

const hub = process.env.BUBBLE_HUB ?? process.env.WISP_HUB ?? process.env.WARREN_HUB ?? "http://localhost:4747";

export default defineConfig({
  plugins: [react(), tailwindcss(), precompress()],
  // noVNC (live view of computers) uses top-level await
  build: {
    target: "es2022",
    rollupOptions: {
      output: {
        // React changes far less often than Bubble AI does: in a file of its own, a browser that has it keeps it across updates
        manualChunks: (id) => (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id) ? "react" : undefined),
      },
    },
  },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
  server: {
    port: 5173,
    proxy: { "/api": hub, "^/m/[A-Za-z0-9_-]+$": hub, "/ws": { target: hub.replace(/^http/, "ws"), ws: true } },
  },
});
