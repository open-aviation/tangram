import process from "process";
import path from "path";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/dist/vite";
import dynamicComponentsPlugin from "./dynamic-components";


let tangram_service = process.env.TANGRAM_SERVICE || "127.0.0.1:18000";
let channel_service = process.env.CHANNEL_SERVICE || "127.0.0.1:2025";

export default defineConfig({
  envDir: "..",
  resolve: {
    alias: {
      '@store': path.resolve(__dirname, './src/store'),
    }
  },
  server: {
    proxy: {
      "/data": `http://${tangram_service}`,
      "^/flight/.*": {
        target: `https://${tangram_service}/flight/.*`,
        changeOrigin: true,
      },
      // for channel service
      "/token": `http://${channel_service}`,
      "/websocket": {
        target: `ws://${channel_service}`,
        ws: true,
        rewriteWsOrigin: true,
      },
    },
  },
  plugins: [
    vue(),
    AutoImport({ imports: ["vue", "vue-router"] }), // vue、vue-router imported automatically
    dynamicComponentsPlugin({
      envPath: "../.env",
      fallbackDir: "/src/components/",
      availablePlugins: [
        "time",
        // "sensors",
      ],
    }),
  ],
});
