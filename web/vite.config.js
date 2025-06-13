import process from "process";
import path from "path";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/dist/vite";

// This will load automatically components defined as plugins
import dynamicComponentsPlugin from "./dynamic-components";

// Useful for loading WASM libraries
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

let tangram_service = process.env.TANGRAM_SERVICE || "127.0.0.1:2346";
let channel_service = process.env.CHANNEL_SERVICE || "127.0.0.1:2347";
let jet1090_service = process.env.JET1090_URL || "127.0.0.1:8080";

// Get the address of the host of the container (this usually works)
let host_address = process.env.HOST_URL || "host.containers.internal";

export default defineConfig({
  envDir: "..",
  resolve: {
    alias: {
      // eslint-disable-next-line no-undef
      "@store": path.resolve(__dirname, "./src/store"),
    },
  },
  server: {
    proxy: {
      "/tangram": {
        target: `http://${tangram_service}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tangram/, ""),
      },
      // for channel service
      "/token": `http://${channel_service}`,
      "/websocket": {
        target: `ws://${channel_service}`,
        ws: true,
        rewriteWsOrigin: true,
      },
      "/sensors": {
        target: `${jet1090_service}/sensors`,
        changeOrigin: true,
        secure: false,
        /*
         * This snippet is useful to debug why a target is not properly redirected
          configure: (proxy, _options) => {
            proxy.on("error", (err, _req, _res) => {
              console.log("proxy error", err);
            });
            proxy.on("proxyReq", (proxyReq, req, _res) => {
              console.log("Sending Request to the Target:", req.method, req.url);
            });
            proxy.on("proxyRes", (proxyRes, req, _res) => {
              console.log("Received Response from the Target:", proxyRes.statusCode, req.url);
            });
          },
        */
      },
    },
  },
  plugins: [
    // Useful for loading WASM libraries
    wasm(),
    topLevelAwait(),
    vue(),
    AutoImport({ imports: ["vue", "vue-router"] }), // vue、vue-router imported automatically
    dynamicComponentsPlugin({
      envPath: "../.env",
      fallbackDir: "/src/plugins/",
      availablePlugins: [
        "airportSearch",
        "systemInfo",
        "sensorsInfo",
        "cityPair",
        //"windField",
        //"sigmetInfo",
      ],
    }),
  ],
});
