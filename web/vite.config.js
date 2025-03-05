import process from "process";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import AutoImport from "unplugin-auto-import/dist/vite";
import dynamicComponentsPlugin from "./vite-plugin-dynamic-components";

let tangram_service = process.env.TANGRAM_SERVICE || "127.0.0.1:18000";
let channel_service = process.env.CHANNEL_SERVICE || "127.0.0.1:2025";

export default defineConfig({
  envDir: "..",
  server: {
    proxy: {
      // string shorthand: http://localhost:5173/foo -> http://localhost:4567/foo
      // with options: http://localhost:5173/api/bar -> http://jsonplaceholder.typicode.com/bar
      "/data": `http://${tangram_service}`,
      // "^/plugins.*": {
      //   target: `https://${tangram_service}/plugins.*`,
      //   changeOrigin: true,
      // },
      "^/flight/.*": {
        target: `https://${tangram_service}/flight/.*`,
        changeOrigin: true,
      },
      // Proxying websockets or socket.io: ws://localhost:5173/socket.io -> ws://localhost:5174/socket.io
      // Exercise caution using `rewriteWsOrigin` as it can leave the proxying open to CSRF attacks.
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
