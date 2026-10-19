import fs from "fs";
import path from "path";

import { defineConfig } from "vite";

import type { Plugin } from "vite";

/**
 * Serves `examples/shape-pack` over HTTP, unbundled, so the "Load Shape Pack"
 * button exercises the real runtime path: fetch a script the editor has never
 * seen, evaluate it in a worker sandbox, draw with it — no rebuild.
 */
const serveExampleShapePack = (): Plugin => ({
  name: "serve-example-shape-pack",
  configureServer(server) {
    server.middlewares.use(
      "/shape-packs/network-shapes.pack.js",
      (_request, response) => {
        response.setHeader("content-type", "text/javascript");
        response.end(
          fs.readFileSync(
            path.resolve(__dirname, "../shape-pack/network-shapes.pack.js"),
          ),
        );
      },
    );
  },
});

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: 3001,
    // open the browser
    open: true,
  },
  publicDir: "public",
  plugins: [serveExampleShapePack()],
  optimizeDeps: {
    esbuildOptions: {
      // Bumping to 2022 due to "Arbitrary module namespace identifier names" not being
      // supported in Vite's default browser target https://github.com/vitejs/vite/issues/13556
      target: "es2022",
      treeShaking: true,
    },
  },
});
